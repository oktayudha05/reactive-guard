# Reactive Guard — Autonomous On-Chain Stop-Loss Vault (Reactive Omni 2.0)

Built for the **Reactive Omni Buildathon** (DoraHacks — Track: **Set It and Forget It**).

**Reactive Guard** eliminates off-chain keeper bots and manual price watching. A user deposits ETH into `StopLossVaultCallback` on Ethereum Sepolia with a stop-loss threshold — **one transaction on the origin chain, nothing else**. A Reactive Omni 2.0 contract on Reactive Lasna automatically indexes the new position from its `PositionOpened` log, monitors `PriceUpdated` logs from `PriceOracleOrigin`, and dispatches an authenticated `SYSTEM.requestCallbackV_1_0` callback to return the user's ETH the instant the stop-loss threshold is breached.

## Architecture (Reactive Omni 2.0)

```text
Ethereum Sepolia (11155111)                       Reactive Lasna Omni 2.0 (5318007)
───────────────────────────                       ─────────────────────────────────
1. User calls vault.openPosition(asset, $2000)
   └─ emits PositionOpened ─────────────────────▶ SYSTEM (0x8888...8888) triggers react()
                                                  └─ ReactiveStopLossGuard indexes order #0

2. Oracle calls origin.updatePrice(asset, $1850)
   └─ emits PriceUpdated ───────────────────────▶ SYSTEM (0x8888...8888) triggers react()
                                                  └─ detects $1850 <= $2000
                                                  └─ calls SYSTEM.requestCallbackV_1_0(...)
                                                                │
3. Omni Callback Proxy (0xAa14...23b4) ◀────────────────────────┘
   └─ calls vault.executeStopLoss(guard, 0, $1850)
      ├─ verifies onlyServiceProvider & onlyCallbackSender
      └─ automatically refunds 0.001 ETH to position owner & emits StopLossExecuted
```

## Live Deployed Contracts

| Contract | Network | Address | Explorer |
| :--- | :--- | :--- | :--- |
| **`PriceOracleOrigin`** | Ethereum Sepolia (`11155111`) | `0xD75B30bCeAD9ea862FEBB6dB6e9eaDBA258Cb115` | [Sepolia Etherscan](https://sepolia.etherscan.io/address/0xD75B30bCeAD9ea862FEBB6dB6e9eaDBA258Cb115) |
| **`StopLossVaultCallback`** | Ethereum Sepolia (`11155111`) | `0x7e1aCA6A7a24E60e01A9E90ADFD48165FfC4F63E` | [Sepolia Etherscan](https://sepolia.etherscan.io/address/0x7e1aCA6A7a24E60e01A9E90ADFD48165FfC4F63E) |
| **`ReactiveStopLossGuard`** | Reactive Lasna Omni (`5318007`) | `0xD75B30bCeAD9ea862FEBB6dB6e9eaDBA258Cb115` | [Lasna Reactscan](https://lasna.reactscan.net/address/0xD75B30bCeAD9ea862FEBB6dB6e9eaDBA258Cb115) |
| *Omni System Contract* | Reactive Lasna Omni (`5318007`) | `0x8888888888888888888888888888888888888888` | Reactive Omni 2.0 `SYSTEM` |
| *Omni Callback Proxy* | Ethereum Sepolia (`11155111`) | `0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4` | Reactive Omni 2.0 Sepolia Proxy |

## Verified End-to-End On-Chain Proof (Full Reactive Loop)

Every step below executed live on-chain on November 27, 2026:

1. **Deploy `ReactiveStopLossGuard` (Lasna):** [`0xe16efded...f8051a`](https://lasna.reactscan.net/tx/0xe16efded79de9e3dd82c4e54375efc9327288030d341ebbf1a27e5fdb3f8051a)
2. **Deploy `StopLossVaultCallback` (Sepolia):** [`0x0ce620b0...a2eb070`](https://sepolia.etherscan.io/tx/0x0ce620b05bbab6f85e00ba7bdad02e9f7a7b163159e3a21bd037c751da2eb070)
3. **Wire Vault & Subscribe to `PositionOpened` / `PositionCancelled` (Lasna):** [`0xab3b82e5...f51c95b`](https://lasna.reactscan.net/tx/0xab3b82e5437d9b81d0788bb8ea448f4176c95a6dcc60efbab532f5899f51c95b)
4. **Origin Tx 1 — User Opens Protected Position #0 (`0.001 ETH`, stop-loss `$2000`) on Sepolia:** [`0x02ec741b...5042f15`](https://sepolia.etherscan.io/tx/0x02ec741b99819cd7a1b8e0a93c348a8a5c9cf954678b6a29ad5a5241c5042f15)
5. **Reactive Tx 1 — Lasna Omni Automatically Indexes Position #0 (`block 9344762`):** [`0xa938281c...0d15bed2`](https://lasna.reactscan.net/tx/0xa938281cec5fd107a065bed8b0e42d9b5cb289bb8288620899026c720d15bed2)
6. **Origin Tx 2 — Price Drops to `$1850` (`<= $2000`) on Sepolia:** [`0xf046d518...2a9bc12`](https://sepolia.etherscan.io/tx/0xf046d518e428f41fa6df0e91403186c5d4b0f14f03e3259329db930632a9bc12)
7. **Reactive Tx 2 — Lasna Omni Detects Breach & Requests Callback (`block 9344773`):** [`0x5452a096...398a136558`](https://lasna.reactscan.net/tx/0x5452a09684c8139cbac7a381dc787a3263c2cee3d90245148477d8398a136558)
8. **Destination Callback Tx — Automated `StopLossExecuted` Payout on Sepolia:** [`0xb6404bef...bae2db8`](https://sepolia.etherscan.io/tx/0xb6404bef4cac6f41cdf8aa9b52e737bcdcd84b33ac545b98862fb72edbae2db8)

Full structured output is saved in [`deployment.json`](./deployment.json).

## Key Design Highlights

- **True "Set It and Forget It" UX:** Users only ever sign `openPosition` (or `cancelPosition`) on Sepolia. Reactive Guard automatically tracks position creation and cancellation via `SYSTEM.subscribe` without requiring users to hold `REACT` or touch Lasna.
- **Native Reactive Omni 2.0 Integration:** Built directly against `reactive-lib-omni` (`SYSTEM = 0x8888...8888`, `onlySystem`, `SYSTEM.requestCallbackV_1_0`, and destination-side `onlyServiceProvider` + `onlyCallbackSender` authentication).
- **Minimal, Zero-Bloat Toolchain:** Pure Solidity `^0.8.28` + `solc` + `ethers` v6 (`npm test` compiles and verifies all ABIs, event topic0 hashes, and callback selectors; `npm run deploy` runs the entire cross-chain deploy & E2E verification loop).

## Quickstart

```bash
npm install
npm test          # Compile contracts and verify ABIs / topic0 / callback selectors
npm run deploy    # Deploy & run full E2E Sepolia <-> Reactive Lasna stop-loss test
```
