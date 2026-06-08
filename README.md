# FairLine — Risk-Managed Liquidity Vault for DeepBook Predict

> Sui Overflow 2026 · DeepBook Track · testnet

**🌐 [Live site](https://fairline-vault.netlify.app) · 🎬 [Demo video](https://youtu.be/dJPlnTcuF5g) · 🔎 [Verify on-chain](https://suiscan.xyz/testnet/object/0x6f50a5439ef6df079f5807c93ac5bf14aa14f39841448395eb7ac8e40287d71e)**

FairLine is a **tranched, risk-managed liquidity vault** for [DeepBook Predict](https://docs.sui.io/onchain-finance/deepbook-predict/) on Sui. You deposit dUSDC and become **the house** of a prediction market — earning its structural **house edge** — while a machine-learning volatility model gates exposure defensively (not to gamble with it). Pick your risk: **senior** (protected, capped yield) or **junior** (first-loss, leveraged). FairLine runs on two DeepBook venues at once — the Predict prediction market **and** a live maker on DeepBook's core orderbook (CLOB) — governed by one risk brain. Every decision and transaction is on-chain and verifiable.

## The one-line pitch

> "GLP for prediction markets" — but tranched, risk-gated, provably-fair-priced, capacity-capped, with a predictor rebate flywheel, and it provides liquidity directly to DeepBook's orderbook.

📄 See [`SUBMISSION.md`](./SUBMISSION.md) for the full narrative, including the honest player → house pivot.

---

## What FairLine is, why you'd use it, and how it compares

**What it is.** Prediction markets need someone to take the other side of every trade — *the house*. That role earns a structural edge (the spread + average trader losses) but normally only sophisticated desks can play it. FairLine packages it into a one-click vault: deposit dUSDC, receive a share token priced at the vault's live NAV, withdraw any time. An ML/volatility model acts as a **defensive risk gate** — a live **🟢 Green / 🟡 Amber / 🔴 Red** posture that pulls exposure back exactly when a big move would hurt the house.

**Why you'd use it**
- **Real, structural yield** — the spread losing traders pay, compounding into your share price; NAV is computed from the on-chain PLP redemption rate (anyone can recompute it), with one bounded, timestamped operator mark today and a mainnet path that reads it on-chain.
- **You choose your risk** — **Senior (FLP-S)**: principal-protected by junior's buffer, steady ≤8% APR. **Junior (FLP-J)**: first-loss but takes the leveraged upside.
- **Honest by design** — provably-fair entry/exit pricing (freshly-marked NAV), an on-chain **capacity cap** that closes the door before deposits dilute yield, and a **rebate flywheel** that shares edge with traders to grow volume. Testnet, unaudited — and it says so.

**How it compares**

| | Generic yield vaults (Yearn/Beefy) | "Be the house" LP vaults (GMX **GLP**, Jupiter **JLP**) | Tranching protocols (BarnBridge, Idle) | **FairLine** |
|---|---|---|---|---|
| Source of yield | aggregated farm yield | perp-trader losses | lending yield | **prediction-market house edge + CLOB spread** |
| Risk choice (tranches) | ❌ | ❌ single class | ✅ | ✅ senior / junior |
| ML risk-gated exposure | ❌ | ❌ | ❌ | ✅ Green/Amber/Red |
| Provably-fair pricing | ❌ | partial | ❌ | ✅ live drift-checked NAV |
| Capacity-capped (anti-dilution) | ❌ | ❌ | ❌ | ✅ on-chain |
| Two-sided rebate flywheel | ❌ | ❌ | ❌ | ✅ |
| Direct DeepBook orderbook | — | — | — | ✅ live CLOB maker |

The individual ideas exist in DeFi; **the combination — over a prediction-market house, on Sui, with a live DeepBook CLOB maker — doesn't exist anywhere else.**

**"Why not just use DeepBook's own market maker?"** Because it solves a different problem. DeepBook's MM provides *liquidity* — it makes sure a market has quotes from minute one (infrastructure). FairLine is the structured-product layer one step up: *who gets to be the house, and on what risk terms.* It turns house P&L into something a normal person can hold — a risk-tranched, capacity-gated, fair-NAV-priced share — without running a bot or stomaching uncapped downside. The tell that FairLine is a product, not a market maker: it **caps capacity and refuses deposits** when they'd dilute depositor yield. A market maker always wants more capital; FairLine optimizes the depositor's return, not its AUM.

### The six features

1. **🟢🟡🔴 Risk-state posture** — one ML/volatility gate, surfaced live; governs every venue.
2. **⚖️ Provably-fair pricing** — deposits/withdrawals price at a freshly-marked NAV; live drift between on-chain and fair price is shown and corrected.
3. **🏦 Senior / junior tranches** — capped profit-share waterfall (senior priority ≤8% APR, junior first-loss + leveraged tail), with `marked_at` events on-chain.
4. **📊 Capacity cap** — on-chain `VAULT_CAPACITY` rejects deposits past productive capacity, so the house edge isn't diluted.
5. **🔁 House flywheel** — a slice of the edge funds pro-rata rebates to predictors trading the markets FairLine backs (edge → rebates → volume → edge).
6. **📖 Direct DeepBook CLOB maker** — the same risk gate runs a posture-gated, inventory-skewed maker placing **real limit orders on DeepBook's core orderbook** (whitelisted DEEP/SUI pool).

---

## What it does

Each 15-minute cycle, the autonomous watcher:

1. **Reads** live BTC Predict market state from `predict-server.testnet.mystenlabs.com`.
2. **Sizes LP exposure** — a target ~70% of capital in PLP, scaled by an ML/volatility risk gate (the house's only real risk is a large directional move).
3. **Supplies liquidity** toward target on-chain via `predict::supply` (sourced atomically from the PredictManager balance).
4. **Runs a small capped directional sleeve** — experimental ML-driven bets (≤15 dUSDC/position, ≤45/cycle), only in calm regimes with high model confidence. Its full P&L is reported honestly.
5. **Shows** everything on a one-screen dashboard: live LP position, redemption-rate accrual, the LP risk gate, and an honest split between LP income and the experimental sleeve.

---

## Why liquidity provision — the verifiable edge

DeepBook Predict's vault is the counterparty (the house) to every binary-option trader. It charges a spread, so net trader losses accrue to PLP holders. This is measurable on-chain:

| Fact | Value (testnet, live) | Source |
|---|---|---|
| PLP redemption rate | **1.003154** dUSDC/PLP | `Predict` object on-chain |
| House edge realized to date | **+0.315%** | (rate − 1) |
| Vault reserves | ~1,011,000 dUSDC | vault balance |
| Vault open liability | **0.087% of reserves** | `total_mtm` / reserves |
| House spread | 2% base (scales with utilization) | `pricing_config` |

The open liability being ~0.09% of reserves is *why* FairLine uses **sticky liquidity** (it scales position size by risk rather than force-exiting) — a data-driven design choice, not an assumption.

**The honest counterpoint:** FairLine began as a *directional* ML vault. Live on testnet it lost money (41.3% win rate vs ~51.5% break-even, −749 dUSDC) — the 2% spread is wider than a 63%-accurate directional model's edge. Those losses flowed into the PLP pool. So we re-weighted from the losing player to the winning house, and repurposed the ML model as a defensive risk gate. The directional strategy survives as a small, capped, transparent research sleeve.

---

## Tranched multi-user vault (on-chain)

FairLine has its own Move contract — a **tranched, NAV-based share vault** published to testnet. Anyone deposits dUSDC into the **senior** or **junior** tranche and receives FLP-S / FLP-J share tokens priced at the vault's net asset value; withdrawals burn shares for a pro-rata claim. The operator runs the LP strategy on the pooled capital (`deploy` → PLP, `mark`/`settle` NAV back), so depositors earn the house edge without running anything. On `mark`/`settle` a **capped profit-share waterfall** splits P&L: senior takes profit up to its target (≤8% APR), junior gets the rest and absorbs losses first.

```
deposit_senior  / deposit_junior  (user)   dUSDC → FLP-S / FLP-J at NAV
withdraw_senior / withdraw_junior (user)   FLP-S / FLP-J → dUSDC, pro-rata
deploy (operator)   move idle reserve into PLP (the house)
mark / settle       report/realize deployed value → runs the senior/junior waterfall, stamps marked_at
```

Verified live on testnet: senior deposit ([`2m2UvMWE…`](https://suiscan.xyz/testnet/tx/2m2UvMWEUNk6PksXpz6vHdFAqjYT53hxXtmq4scoNynE)) · junior deposit ([`9wdQYzuv…`](https://suiscan.xyz/testnet/tx/9wdQYzuvPQAy3eYf2WJXxq77xsv9AHkCTmbcMRH93gBu)) · junior withdraw ([`Gd3zGDBx…`](https://suiscan.xyz/testnet/tx/Gd3zGDBxiackZhdhLFRC2idTtpJQHhxKfHgBTt8gxYpd)) · flywheel rebates to 22 predictors ([`FjTaze5q…`](https://suiscan.xyz/testnet/tx/FjTaze5qYkY81q4zHKUBuFt9a2M8yGTi27YCesdnRWRo)) · live DeepBook CLOB order ([`8Wrs564E…`](https://suiscan.xyz/testnet/tx/8Wrs564ExgE6B344iiSfhTwp6cKNeu4vPtYVTNbtw5dH)). NAV = idle reserve + deployed value (verifiable from the on-chain PLP rate).

> **Security & status:** testnet, single-operator, **unaudited** (we never claim otherwise). The contract passed an internal security review. The entire trust surface is *one value* — the operator's mark on deployed capital (`new_deployed` on `mark`/`settle`): the reserve is trustless, `settle` can't claim back more than was actually returned (`EDeployTooLarge`), and every mark is timestamped on-chain (`marked_at`) so freshness is provable. The mainnet fix derives that mark directly from the on-chain PLP redemption rate, removing the operator from the loop — sequenced *after* mainnet because Predict's object layout is pinned to a testnet branch and will change at launch. The vault itself imports no Predict code (strategy-agnostic; Predict is plugged in off-chain), so it survives a mainnet Predict re-deploy untouched. See [`ROADMAP.md`](./ROADMAP.md) for the hardening + mainnet path. DeepBook Predict is testnet-only today, so mainnet is upstream-blocked.

## Stack

- **Sui SDK** `@mysten/sui` — PTB construction, transaction execution, devInspect previews
- **DeepBook Predict** — PLP liquidity supply/withdraw, binary positions, ranges (testnet)
- **ML risk gate** — logistic regression (12 features, 5-fold CV), retrained on settled oracles
- **hermes3** (local Ollama) — sizing + natural-language reasoning for the directional sleeve
- **TypeScript** throughout; **Express** dashboard; **pm2** for autonomous operation

---

## Quick start

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
# Fill in WALLET_PRIVATE_KEY and MANAGER_ID (see setup below)

# 3. Read a live BTC market
npm run market

# 4. Create a PredictManager on testnet (one-time)
npm run setup

# 5. Run one allocation cycle (SIM mode — devInspect only, no funds moved)
npm run cycle

# 6. Launch dashboard
npm run dashboard          # → http://localhost:3002

# 7. Supply liquidity manually (validates via devInspect first)
npm run lp-supply -- 200            # dry-run
npm run lp-supply -- 200 --execute  # live
```

**Autonomous operation** — `npm run watcher` (or via pm2) runs the LP engine + sleeve every 60s. Set `LIVE_MODE=true` in `.env` to execute on testnet (request dUSDC via the [Mysten Labs Tally form](https://docs.sui.io/onchain-finance/deepbook-predict/contract-information)).

**Representative live transactions (Sui testnet):**
- LP supply: [`6RCL69MDBKb9YhFmcPDmPVNf3THrZf3XaxmVrKmDT4Xz`](https://suiexplorer.com/txblock/6RCL69MDBKb9YhFmcPDmPVNf3THrZf3XaxmVrKmDT4Xz?network=testnet)
- LP supply: [`CznuJcDuA8dGL7p4FeizQTmBJdr5PjFWH2dircR8YiAw`](https://suiexplorer.com/txblock/CznuJcDuA8dGL7p4FeizQTmBJdr5PjFWH2dircR8YiAw?network=testnet)
- Directional mint (sleeve): [`4MWHyy5eQr4zetWiJ1i9ExrVL7UEUCoqEBjcu333EC6a`](https://suiexplorer.com/txblock/4MWHyy5eQr4zetWiJ1i9ExrVL7UEUCoqEBjcu333EC6a?network=testnet)

---

## How the LP risk gate works

```
exposure factor  = base(vol) × ml_adjust(conviction)
   base:   vol < 15%  → 1.0   (calm — full exposure)
           15–30%     → 0.6   (elevated — partial)
           ≥ 30%      → 0.0   (extreme — stop adding)
   ml_adjust = 1 − 0.3 × |prob_up − 0.5|×2   (strong conviction trims up to 30%)

LP target = 70% of total capital × exposure factor   (hard cap 5,000 dUSDC)
```

Sticky: the engine only **adds** toward target (never force-exits), sourcing from the wallet first, then the Manager. A directional position is opened only when vol < 15% **and** ML confidence is high, hard-capped per position and per cycle.

---

## ML model

A logistic regression predicts settlement direction (UP/DOWN) from 12 features: realized volatility, price trend, momentum, range, basis (forward−spot), time-of-day, day-of-week, and interaction terms.

- **CV accuracy: ~63%** (5-fold, vs 50% random baseline)
- Retrained automatically as new oracles settle (3,400+ to date) via `watcher.ts`
- Weights exported to `scripts/model_weights.json`, loaded at inference in `src/ml-model.ts`
- Used as a **defensive risk signal** for LP exposure; directional betting is the small capped sleeve only

```bash
npm run collect    # fetch settled oracles → scripts/training_data.csv
npm run train      # train logistic regression → scripts/model_weights.json
npm run retrain    # incremental collect + retrain
```

---

## Project structure

```
src/
├── config.ts          # Contract addresses, scaling, LP + sizing policy
├── indexer.ts         # predict-server API (retry-hardened)
├── features.ts        # Market features from price history
├── ml-model.ts        # Trained logistic-regression inference (risk signal)
├── model.ts           # hermes3 sizing + reasoning for the directional sleeve
├── transactions.ts    # PTB builders (supply, supply-from-manager, mint, redeem, preview)
├── coins.ts           # dUSDC / PLP coin utilities
├── wallet.ts          # Sign, execute, devInspect
├── cycle.ts           # LP engine (primary) + directional sleeve (secondary)
├── watcher.ts         # Autonomous 60s loop
├── vault.ts           # Tranched vault PTB builders (senior/junior) + state reads
├── vault-strategy.ts  # Operator: deploy vault reserve → PLP, mark NAV
├── posture.ts         # 🟢🟡🔴 risk-state posture (shared risk brain)
├── fairness.ts        # Provably-fair pricing — live NAV drift + mark-to-fair
├── rewards.ts         # House flywheel — fund pool + distribute predictor rebates
├── deepbook.ts        # Direct DeepBook v3 CLOB PTBs (raw, no SDK)
├── deepbook-mm.ts     # Posture-gated orderbook maker (DEEP/SUI)
├── sim-users.ts       # 50-synthetic-depositor simulation across both tranches
├── lp-supply.ts       # Manual LP supply (devInspect-then-execute)
├── simulate.ts        # Backtest engine
└── dashboard.ts       # Express dashboard (port 3002) + all feature endpoints
contracts/fairline_vault/sources/
├── vault.move         # Tranched NAV share vault + waterfall + capacity cap
├── flp_s.move         # Senior share token (FLP-S)
├── flp_j.move         # Junior share token (FLP-J)
└── rewards.move       # House-flywheel reward pool (+ 6 unit tests across the package)
```

---

## Contract addresses (predict-testnet-4-16)

| Object | ID |
|---|---|
| Predict Package | `0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138` |
| Predict (shared) | `0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a` |
| Registry | `0x43af14fed5480c20ff77e2263d5f794c35b9fab7e2212903127062f4fe2a6e64` |
| dUSDC | `0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC` |
| PLP | `0xf5ea2b...::plp::PLP` |
| **FairLine package** (types) | `0x8c5c7e1205468970100265c17a8c9a80fe43d67bfed0230cb807f1f75e7029e4` |
| **FairLine package** (latest, for calls) | `0x686d8d1609d259b751dca545f99d5e186fd3d7e7f59cdd3838e79ecdf457c7bd` |
| **FairLine Vault\<dUSDC\>** (shared) | `0x6f50a5439ef6df079f5807c93ac5bf14aa14f39841448395eb7ac8e40287d71e` |
| **FLP-S / FLP-J share tokens** | `<pkg>::flp_s::FLP_S` · `<pkg>::flp_j::FLP_J` |
| **Reward pool** (flywheel) | `0x18e4b06c83aa7a4f2fde24989bdbbc94c5ebbfc78d9416fb10eafad2f0b3e5ee` |
| **DeepBook v3 package** | `0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c` |
| **DeepBook DEEP/SUI pool** (CLOB maker) | `0x48c95963e9eac37a316b7ae04a0deb761bcdcc2b67912374d6036e7f0e9bae9f` |

> Note: the vault package was published then upgraded twice (capacity cap, then the rewards module). Move **types** (Vault, FLP-S/J) are identified by the original publish id; **function calls** target the latest id. The old single-tranche vault (`0xfe5abfde…` / `0x71a3…`) remains on-chain, unwired.

---

## Hackathon

- **Track:** DeepBook (Sui Overflow 2026)
- **Deadline:** June 21, 2026
- **Protocol branch:** `predict-testnet-4-16`
