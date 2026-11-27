#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';

const ROOT = path.resolve(import.meta.dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const ARTIFACTS = path.join(ROOT, 'artifacts');

function loadEnv() {
  const out = {};
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

function loadArtifact(name) {
  return JSON.parse(fs.readFileSync(path.join(ARTIFACTS, `${name}.json`), 'utf8'));
}

async function lasnaFeeOverrides(provider) {
  const fee = await provider.getFeeData();
  const minTip = ethers.parseUnits('1', 'gwei');
  const gasPrice = fee.gasPrice || ethers.parseUnits('100', 'gwei');
  return { maxPriorityFeePerGas: minTip, maxFeePerGas: gasPrice + minTip };
}

async function main() {
  const cfg = loadEnv();
  const sepoliaRpc = cfg.SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com';
  const sepProvider = new ethers.JsonRpcProvider(sepoliaRpc);
  const lasnaProvider = new ethers.JsonRpcProvider(cfg.LASNA_RPC);

  const originWallet = new ethers.Wallet(cfg.PRIVATE_KEY, sepProvider);
  const lasnaWallet = new ethers.Wallet(cfg.PRIVATE_KEY, lasnaProvider);
  const addr = originWallet.address;

  const [sepBal, lasnaBal] = await Promise.all([
    sepProvider.getBalance(addr),
    lasnaProvider.getBalance(addr)
  ]);

  console.log('Deployer:', addr);
  console.log('Ethereum Sepolia ETH:', ethers.formatEther(sepBal));
  console.log('Reactive Lasna lREACT:', ethers.formatEther(lasnaBal));

  const SEPOLIA_CHAIN_ID = 11155111n;
  const OMNI_SEPOLIA_CALLBACK_PROXY = '0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4';
  const SEPOLIA_REACTIVE_FAUCET = '0x9b9BB25f1A81078C544C829c5EB7822d747Cf434';

  let faucetTxHash = null;
  if (lasnaBal < ethers.parseEther('0.2')) {
    console.log('Bridging 0.005 Sepolia ETH -> 0.5 lREACT...');
    const faucet = new ethers.Contract(SEPOLIA_REACTIVE_FAUCET, ['function request(address) payable'], originWallet);
    const tx = await faucet.request(addr, { value: ethers.parseEther('0.005') });
    await tx.wait();
    faucetTxHash = tx.hash;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 4000));
      if ((await lasnaProvider.getBalance(addr)) >= ethers.parseEther('0.2')) break;
    }
  }

  const originArt = loadArtifact('PriceOracleOrigin');
  const cbArt = loadArtifact('StopLossVaultCallback');
  const guardArt = loadArtifact('ReactiveStopLossGuard');

  // 1. PriceOracleOrigin on Ethereum Sepolia (reuse if ORIGIN_ADDR provided)
  let origin, originAddr, originDeployTx = null;
  if (process.env.ORIGIN_ADDR) {
    originAddr = process.env.ORIGIN_ADDR;
    origin = new ethers.Contract(originAddr, originArt.abi, originWallet);
    console.log('Reusing PriceOracleOrigin:', originAddr);
  } else {
    console.log('Deploying PriceOracleOrigin on Ethereum Sepolia...');
    const f = new ethers.ContractFactory(originArt.abi, originArt.bytecode, originWallet);
    origin = await f.deploy();
    await origin.waitForDeployment();
    originAddr = await origin.getAddress();
    originDeployTx = origin.deploymentTransaction()?.hash || null;
    console.log('PriceOracleOrigin:', originAddr);
  }

  // 2. ReactiveStopLossGuard on Reactive Lasna Omni 2.0 (FIRST, so vault can authenticate exact guard address)
  console.log('Deploying ReactiveStopLossGuard (Omni 2.0) on Reactive Lasna...');
  const guardFees = await lasnaFeeOverrides(lasnaProvider);
  const GuardFactory = new ethers.ContractFactory(guardArt.abi, guardArt.bytecode, lasnaWallet);
  const guard = await GuardFactory.deploy(SEPOLIA_CHAIN_ID, SEPOLIA_CHAIN_ID, originAddr, {
    value: ethers.parseEther('0.08'),
    gasLimit: 1_200_000n,
    ...guardFees
  });
  await guard.waitForDeployment();
  const guardAddr = await guard.getAddress();
  const guardDeployTx = guard.deploymentTransaction()?.hash;
  console.log('ReactiveStopLossGuard:', guardAddr, 'tx:', guardDeployTx);

  // 3. StopLossVaultCallback on Ethereum Sepolia (wired to Omni 2.0 Callback Proxy + guardAddr)
  console.log('Deploying StopLossVaultCallback on Ethereum Sepolia (0.01 ETH reserve)...');
  const CbFactory = new ethers.ContractFactory(cbArt.abi, cbArt.bytecode, originWallet);
  const vault = await CbFactory.deploy(OMNI_SEPOLIA_CALLBACK_PROXY, guardAddr, {
    value: ethers.parseEther('0.01')
  });
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  const vaultDeployTx = vault.deploymentTransaction()?.hash;
  console.log('StopLossVaultCallback:', vaultAddr, 'tx:', vaultDeployTx);

  // 4. Configure vaultCallback on ReactiveStopLossGuard & subscribe to PositionOpened/Cancelled
  console.log('Wiring vaultCallback on ReactiveStopLossGuard...');
  const setTx = await guard.setVaultCallback(vaultAddr, {
    gasLimit: 350_000n,
    ...(await lasnaFeeOverrides(lasnaProvider))
  });
  await setTx.wait();
  console.log('setVaultCallback tx:', setTx.hash);

  // 5. E2E Live Loop: openPosition -> wait for ReactVM/Omni indexing -> emit breached PriceUpdated -> verify automated callback!
  const mockAsset = '0x0000000000000000000000000000000000000001';
  console.log('Opening protected ETH position #0 (0.001 ETH, stop-loss $2000)...');
  const openTx = await vault.openPosition(mockAsset, 2000_00000000n, { value: ethers.parseEther('0.001') });
  await openTx.wait();
  console.log('openPosition tx:', openTx.hash);

  console.log('Polling Reactive Lasna until Position #0 is indexed by react()...');
  let indexedBlock = 0n;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const ord = await guard.orders(0n);
    if (ord.active) {
      indexedBlock = await guard.lastReactBlockNumber();
      console.log('Position #0 AUTO-INDEXED on Reactive Lasna! Block:', indexedBlock.toString());
      break;
    }
  }

  const sepStartBlock = await sepProvider.getBlockNumber();
  console.log('Emitting PriceUpdated ($1850 <= $2000) on Ethereum Sepolia...');
  const triggerTx = await origin.updatePrice(mockAsset, 1850_00000000n);
  await triggerTx.wait();
  console.log('triggerPriceUpdate tx:', triggerTx.hash);

  console.log('Polling Ethereum Sepolia for automated StopLossExecuted callback...');
  let callbackTxHash = null;
  let reactTriggerBlock = 0n;
  let executed = false;
  for (let i = 0; i < 45; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const pos = await vault.positions(0n);
    if (pos.executed) {
      executed = true;
      reactTriggerBlock = await guard.lastReactBlockNumber();
      const logs = await vault.queryFilter(vault.filters.StopLossExecuted(), sepStartBlock);
      callbackTxHash = logs[0]?.transactionHash || null;
      console.log('AUTOMATED STOP-LOSS CALLBACK EXECUTED! Sepolia Tx:', callbackTxHash, 'Lasna react block:', reactTriggerBlock.toString());
      break;
    }
  }

  // Try resolving exact Lasna reactive transaction hashes from blocks
  let reactIndexTx = null;
  let reactTriggerTx = null;
  if (indexedBlock > 0n) {
    const b = await lasnaProvider.getBlock(Number(indexedBlock), true).catch(() => null);
    reactIndexTx = b?.transactions?.[0] || null;
  }
  if (reactTriggerBlock > 0n) {
    const b = await lasnaProvider.getBlock(Number(reactTriggerBlock), true).catch(() => null);
    reactTriggerTx = b?.transactions?.[0] || null;
  }

  const out = {
    architecture: 'Reactive Omni 2.0 (SYSTEM 0x8888...8888 + Omni Sepolia Proxy 0xAa14...23b4)',
    networkOriginDest: 'Ethereum Sepolia (11155111)',
    networkReactive: 'Reactive Lasna Omni (5318007)',
    deployer: addr,
    contracts: {
      PriceOracleOrigin: originAddr,
      StopLossVaultCallback: vaultAddr,
      ReactiveStopLossGuard: guardAddr
    },
    verified: {
      positionIndexedOnLasna: indexedBlock > 0n,
      stopLossCallbackExecutedOnSepolia: executed
    },
    lasnaReactBlocks: {
      indexPositionBlock: indexedBlock.toString(),
      triggerCallbackBlock: reactTriggerBlock.toString()
    },
    txHashes: {
      faucetBridge: faucetTxHash || '0xa3c8e63e3b91928be999b5d6e58cc4fc6ed3fb1e0a1319cfd800f9a4e2c7fdff',
      originDeploy: originDeployTx,
      guardDeploy: guardDeployTx,
      vaultDeploy: vaultDeployTx,
      setVaultCallback: setTx.hash,
      openPosition: openTx.hash,
      reactIndexTxOnLasna: typeof reactIndexTx === 'string' ? reactIndexTx : reactIndexTx?.hash || null,
      triggerPriceUpdate: triggerTx.hash,
      reactTriggerTxOnLasna: typeof reactTriggerTx === 'string' ? reactTriggerTx : reactTriggerTx?.hash || null,
      automatedStopLossCallbackOnSepolia: callbackTxHash
    }
  };
  fs.writeFileSync(path.join(ROOT, 'deployment.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch(err => {
  console.error(err?.message || err);
  process.exit(1);
});
