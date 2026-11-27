# DoraHacks Submission — Reactive Guard

Copy-paste fields for the **Reactive Omni Buildathon** (`https://dorahacks.io/hackathon/reactive-omni-buildathon`).

---

## Project Name
**Reactive Guard**

## Track
**Set It and Forget It**

## Tagline (Short Description)
Autonomous on-chain stop-loss vault built on Reactive Omni 2.0 — one Sepolia deposit transaction, zero off-chain keeper bots, automatic cross-chain ETH refund on price breach.

## Live Demo URL
`https://oktayudha05.github.io/reactive-guard/`

## GitHub Repository URL
`https://github.com/oktayudha05/reactive-guard`

## Demo Video File (Ready to Upload to YouTube/Loom/DoraHacks)
- Local file: `demo/reactive-guard-demo.mp4` (59s, 1920x1080 H.264 `yuv420p`, 3.0 MB)
- GitHub raw link: `https://github.com/oktayudha05/reactive-guard/raw/main/demo/reactive-guard-demo.mp4`

---

## Full Project Description (DoraHacks BUIDL Markdown)

### Problem
On-chain stop-loss and liquidation-protection systems typically rely on centralized off-chain keeper bots, cron servers, or paid automation relays. If a bot goes offline, runs out of gas, or suffers RPC lag during high volatility, user collateral is left unprotected.

### Solution: Reactive Guard (Reactive Omni 2.0)
**Reactive Guard** is a trustless, event-driven stop-loss vault powered natively by **Reactive Omni 2.0** (`SYSTEM = 0x8888888888888888888888888888888888888888`).

Users interact **only once** on Ethereum Sepolia:
1. Call `StopLossVaultCallback.openPosition(asset, stopLossPrice)` with ETH collateral.
2. Walk away ("set it and forget it"). No Lasna wallet, no `REACT` gas management, and no off-chain daemon required.

Behind the scenes, `ReactiveStopLossGuard` on Reactive Lasna Omni 2.0:
- Automatically indexes every new `PositionOpened` (and removes `PositionCancelled`) event via `SYSTEM.subscribe`.
- Listens to `PriceUpdated` events emitted by `PriceOracleOrigin` on Sepolia.
- Immediately detects when `newPrice <= stopLossPrice`, marks the order inactive to prevent duplicate callbacks, and calls `SYSTEM.requestCallbackV_1_0` targeting Ethereum Sepolia.
- The official Reactive Omni 2.0 Callback Proxy (`0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4`) delivers `executeStopLoss(guard, positionId, triggerPrice)` to `StopLossVaultCallback`, which verifies both `onlyServiceProvider` and `onlyCallbackSender`, then automatically refunds the ETH collateral to the position owner.

### Security & Verification
- **Strict Reactive Omni 2.0 Auth:** `onlySystem` on `react()`, `onlyServiceProvider` (Omni Callback Proxy) + `onlyCallbackSender` (authorized `ReactiveStopLossGuard`) on destination callbacks.
- **Reentrancy & Idempotency:** Order deactivated on Lasna before callback dispatch; `position.active` and `position.executed` updated before ETH payout on Sepolia.
- **Live Browser Verification:** The [Live Demo](https://oktayudha05.github.io/reactive-guard/) queries Ethereum Sepolia and Reactive Lasna RPCs directly from the browser (`eth_call`, zero backend) to prove live contract state.

### Deployed Contracts
| Contract | Network | Address |
| :--- | :--- | :--- |
| `PriceOracleOrigin` | Ethereum Sepolia (`11155111`) | `0xD75B30bCeAD9ea862FEBB6dB6e9eaDBA258Cb115` |
| `StopLossVaultCallback` | Ethereum Sepolia (`11155111`) | `0x7e1aCA6A7a24E60e01A9E90ADFD48165FfC4F63E` |
| `ReactiveStopLossGuard` | Reactive Lasna Omni (`5318007`) | `0xD75B30bCeAD9ea862FEBB6dB6e9eaDBA258Cb115` |
| Omni `SYSTEM` Contract | Reactive Lasna Omni (`5318007`) | `0x8888888888888888888888888888888888888888` |
| Omni Callback Proxy | Ethereum Sepolia (`11155111`) | `0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4` |

### Verified End-to-End On-Chain Transaction Proofs (Nov 27, 2026)
1. **Deploy `ReactiveStopLossGuard` (Lasna):** https://lasna.reactscan.net/tx/0xe16efded79de9e3dd82c4e54375efc9327288030d341ebbf1a27e5fdb3f8051a
2. **Deploy `StopLossVaultCallback` (Sepolia):** https://sepolia.etherscan.io/tx/0x0ce620b05bbab6f85e00ba7bdad02e9f7a7b163159e3a21bd037c751da2eb070
3. **Wire Vault & Subscribe on Lasna (`setVaultCallback`):** https://lasna.reactscan.net/tx/0xab3b82e5437d9b81d0788bb8ea448f4176c95a6dcc60efbab532f5899f51c95b
4. **Origin Tx 1 — `openPosition` #0 (`0.001 ETH`, stop-loss `$2000`) on Sepolia:** https://sepolia.etherscan.io/tx/0x02ec741b99819cd7a1b8e0a93c348a8a5c9cf954678b6a29ad5a5241c5042f15
5. **React Tx 1 — Lasna Auto-Index (`block 9344762`):** https://lasna.reactscan.net/tx/0xa938281cec5fd107a065bed8b0e42d9b5cb289bb8288620899026c720d15bed2
6. **Origin Tx 2 — `updatePrice` (`$1850 <= $2000`) on Sepolia:** https://sepolia.etherscan.io/tx/0xf046d518e428f41fa6df0e91403186c5d4b0f14f03e3259329db930632a9bc12
7. **React Tx 2 — Breach Detected & `requestCallbackV_1_0` (`block 9344773`):** https://lasna.reactscan.net/tx/0x5452a09684c8139cbac7a381dc787a3263c2cee3d90245148477d8398a136558
8. **Destination Callback — Automated `StopLossExecuted` Refund on Sepolia:** https://sepolia.etherscan.io/tx/0xb6404bef4cac6f41cdf8aa9b52e737bcdcd84b33ac545b98862fb72edbae2db8
