# FairLine — Risk-Managed Liquidity Vault for DeepBook Predict

> Sui Overflow 2026 · DeepBook Track · testnet

FairLine is an autonomous liquidity vault for [DeepBook Predict](https://docs.sui.io/onchain-finance/deepbook-predict/) on Sui. It earns the prediction market's structural **house edge** by providing liquidity (PLP), and uses a machine-learning directional model **defensively** — to gate that liquidity exposure against directional risk, not to gamble with it. Every decision and every transaction is on-chain and verifiable.

## The one-line pitch

> Be the house, not the player — automated, risk-gated liquidity provision for on-chain prediction markets, with fully verifiable results.

📄 See [`SUBMISSION.md`](./SUBMISSION.md) for the full narrative, including the honest player → house pivot.

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

## Multi-user vault (on-chain)

FairLine has its own Move contract — a **NAV-based share vault** published to testnet. Anyone can deposit dUSDC and receive fungible **FLP** share tokens priced at the vault's net asset value; withdrawals burn shares for a pro-rata claim. The operator runs the LP strategy on the pooled capital (`deploy` → PLP, `mark`/`settle` NAV back), so depositors earn the house edge without running anything.

```
deposit (user)      dUSDC → FLP shares at NAV
withdraw (user)     FLP   → dUSDC, pro-rata
deploy (operator)   move idle reserve into PLP (the house)
mark / settle       report/realize deployed value → moves share price
```

Verified live on testnet: deposit (`GGFyppXc…`) → deploy-to-PLP (`7J1oNLrk…`) → NAV mark (`FvtUkRNJ…`). NAV = idle reserve + deployed value (verifiable from the on-chain PLP rate); share price = NAV / FLP supply.

> **Security & status:** testnet, single-operator, **unaudited** (we never claim otherwise). The contract passed an internal security review; the main limitation is operator trust around NAV reporting. See [`ROADMAP.md`](./ROADMAP.md) for the hardening + mainnet path. DeepBook Predict is testnet-only today, so mainnet is upstream-blocked.

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
├── vault.ts           # FairLine Vault PTB builders + state reads
├── vault-strategy.ts  # Operator: deploy vault reserve → PLP, mark NAV
├── lp-supply.ts       # Manual LP supply (devInspect-then-execute)
├── daily-summary.ts   # Hourly P&L summary
├── simulate.ts        # Backtest engine
└── dashboard.ts       # Express dashboard (port 3002)
logs/
├── cycles.jsonl       # Per-cycle log (LP factor, target, action, digests)
└── daily-summary.json # Rolling P&L summary
contracts/fairline_vault/
└── sources/vault.move # Multi-user NAV share vault (Move) + unit tests
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
| **FairLine Vault package** | `0xfe5abfde639a8ea1a208808578f1c7f79f4aa94cf15a77f169cdc8f3d8c0ccfb` |
| **FairLine Vault\<dUSDC\>** (shared) | `0x71a3527114fb4bd65a612bb095ce5bc14e9a043530f22df7f6f8c240af04fb7e` |
| **FLP share token** | `0xfe5abf...::vault::VAULT` |

---

## Hackathon

- **Track:** DeepBook (Sui Overflow 2026)
- **Deadline:** June 21, 2026
- **Protocol branch:** `predict-testnet-4-16`
