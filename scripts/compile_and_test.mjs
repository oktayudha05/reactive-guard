#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import solc from 'solc';
import { ethers } from 'ethers';

const ROOT = path.resolve(import.meta.dirname, '..');
const CONTRACTS_DIR = path.join(ROOT, 'contracts');
const ARTIFACTS_DIR = path.join(ROOT, 'artifacts');

function collectSources(dir, base = 'contracts') {
  const out = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = `${base}/${entry.name}`;
    if (entry.isDirectory()) {
      Object.assign(out, collectSources(full, rel));
    } else if (entry.name.endsWith('.sol')) {
      out[rel] = { content: fs.readFileSync(full, 'utf8') };
    }
  }
  return out;
}

const input = {
  language: 'Solidity',
  sources: collectSources(CONTRACTS_DIR),
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } }
  }
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors || []).filter(e => e.severity === 'error');
if (errors.length) {
  console.error(errors.map(e => e.formattedMessage).join('\n'));
  process.exit(1);
}

fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
const compiled = {};
for (const [file, contracts] of Object.entries(output.contracts)) {
  for (const [name, artifact] of Object.entries(contracts)) {
    if (!artifact.evm?.bytecode?.object) continue;
    compiled[name] = { abi: artifact.abi, bytecode: '0x' + artifact.evm.bytecode.object };
    fs.writeFileSync(path.join(ARTIFACTS_DIR, `${name}.json`), JSON.stringify(compiled[name], null, 2));
  }
}

// Verify expected contracts & ABI / topic0 / payload encoding invariants
for (const reqName of ['PriceOracleOrigin', 'StopLossVaultCallback', 'ReactiveStopLossGuard']) {
  assert.ok(compiled[reqName]?.abi?.length > 0, `Missing ABI for ${reqName}`);
  assert.ok(compiled[reqName]?.bytecode?.length > 10, `Missing bytecode for ${reqName}`);
}

const originIface = new ethers.Interface(compiled.PriceOracleOrigin.abi);
const cbIface = new ethers.Interface(compiled.StopLossVaultCallback.abi);
const guardIface = new ethers.Interface(compiled.ReactiveStopLossGuard.abi);

const expectedTopic0 = ethers.id('PriceUpdated(address,uint256,uint256)');
assert.equal(originIface.getEvent('PriceUpdated').topicHash, expectedTopic0, 'PriceUpdated topic0 mismatch');
assert.equal(cbIface.getEvent('PositionOpened').topicHash, ethers.id('PositionOpened(uint256,address,address,uint256,uint256)'), 'PositionOpened topic0 mismatch');
assert.equal(cbIface.getEvent('PositionCancelled').topicHash, ethers.id('PositionCancelled(uint256,address,uint256)'), 'PositionCancelled topic0 mismatch');

const encodedPayload = cbIface.encodeFunctionData('executeStopLoss', [ethers.ZeroAddress, 0n, 1800n * 10n ** 8n]);
assert.equal(encodedPayload.slice(0, 10), ethers.id('executeStopLoss(address,uint256,uint256)').slice(0, 10), 'Callback selector mismatch');

// Verify guard logic functions exist on ABI
assert.ok(guardIface.getFunction('react'), 'Missing react');
assert.ok(cbIface.getFunction('openPosition'), 'Missing openPosition');
assert.ok(cbIface.getFunction('cancelPosition'), 'Missing cancelPosition');

console.log(JSON.stringify({
  ok: true,
  compiledContracts: Object.keys(compiled),
  priceUpdatedTopic0: expectedTopic0,
  callbackSelector: encodedPayload.slice(0, 10)
}, null, 2));
