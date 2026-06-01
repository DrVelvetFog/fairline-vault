# FairLine — ML-Driven Vault for DeepBook Predict

> Sui Overflow 2026 · DeepBook Track

FairLine is a capital allocation vault for [DeepBook Predict](https://docs.sui.io/onchain-finance/deepbook-predict/) on Sui testnet. Each 15-minute expiry cycle, a local ML model (hermes3 via Ollama) reads live BTC binary option market state, decides how to allocate capital across positions and PLP liquidity supply, and executes that allocation on-chain. A dashboard shows the allocation, the model's reasoning, and backtested simulation results.

## The one-line pitch

> PLP yield + directional alpha, managed by a model, with visible risk.

---

## What it does

1. **Reads** live BTC Predict market state from `predict-server.testnet.mystenlabs.com`
2. **Allocates** — hermes3 (local Ollama) outputs a capital allocation each cycle: which strikes, how much to mint, how much to supply as PLP
3. **Executes** — places that allocation on Sui testnet via `predict::mint`, `predict::mint_range`, `predict::supply`
4. **Simulates** — backtests 500 real settled BTC oracles to produce P&L, drawdown, and win rate vs. naïve baselines
5. **Shows** — one-screen dashboard: live market, model reasoning, equity curve, simulation metrics

---

## Simulation results (500 oracles · May 24–June 1 · testnet)

| Strategy | Win Rate | Total Return | Max Drawdown | Sharpe |
|---|---|---|---|---|
| **FairLine** | **60.6%** | **+137.4%** | **9.1%** | **33.97** |
| Always UP | 49.0% | -68.6% | 85.2% | -10.28 |
| PLP Only | — | +171.6% | ~0% | — |

- Starting capital: 100 dUSDC (simulated)
- Position size: 5 dUSDC max payout per cycle
- Ask price: 51.5% ATM (from live `get_trade_amounts` devInspect)
- Data: real on-chain settlement prices, rolling 15-min BTC oracles

---

## Stack

- **Sui SDK** `@mysten/sui` — PTB construction, transaction execution, devInspect
- **hermes3** (local Ollama) — allocation brain, structured JSON output
- **DeepBook Predict** — binary positions, ranges, PLP vault (testnet)
- **TypeScript** throughout — features, model, transactions, simulation, dashboard
- **Express** — single-screen dashboard (port 3002)

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

# 5. Run one allocation cycle (SIM mode — no dUSDC needed)
npm run cycle

# 6. Backtest 500 oracles
npm run simulate

# 7. Launch dashboard
npm run dashboard
# → http://localhost:3002
```

**Live execution** — set `LIVE_MODE=true` in `.env` and ensure dUSDC is in your wallet (request via the [Mysten Labs Tally form](https://docs.sui.io/onchain-finance/deepbook-predict/contract-information)).

**Live execution confirmed on Sui testnet:**
- Deposit + Mint: [`4MWHyy5eQr4zetWiJ1i9ExrVL7UEUCoqEBjcu333EC6a`](https://suiexplorer.com/txblock/4MWHyy5eQr4zetWiJ1i9ExrVL7UEUCoqEBjcu333EC6a?network=testnet)
- Redeem: [`CPgpMmBzMQaubWBSFm1SZqzDfiyoL4MM7Li9t8MmY3f7`](https://suiexplorer.com/txblock/CPgpMmBzMQaubWBSFm1SZqzDfiyoL4MM7Li9t8MmY3f7?network=testnet)

**Train / retrain the ML model:**
```bash
npm run collect    # fetch all settled oracles → scripts/training_data.csv
npm run train      # train logistic regression → scripts/model_weights.json
npm run retrain    # incremental collect + retrain in one command
```

---

## Project structure

```
src/
├── config.ts         # All contract addresses and scaling constants
├── indexer.ts        # predict-server API (oracles, prices, managers)
├── features.ts       # Market features from price history (vol, trend, basis)
├── model.ts          # hermes3 allocation brain via Ollama
├── transactions.ts   # PTB builders (deposit+mint, supply, redeem, preview)
├── coins.ts          # dUSDC coin merge/split utilities
├── wallet.ts         # Sign, execute, inspect transactions
├── cycle.ts          # Main vault cycle loop (SIM + LIVE modes)
├── simulate.ts       # 500-oracle backtest engine
├── dashboard.ts      # Express dashboard (port 3002)
├── first-trade.ts    # First live trade script (validates PTB then executes)
└── redeem.ts         # Redeem settled positions
logs/
├── cycles.jsonl      # Cycle-by-cycle allocation log
├── cycle-history.json
└── simulation.json   # Full backtest results with equity curves
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

---

## ML model

A logistic regression trained on **3,133 settled BTC oracle outcomes** predicts settlement direction (UP/DOWN) from 12 features: realized volatility, price trend, momentum, range, basis (forward−spot), time-of-day, day-of-week, and interaction terms.

- **CV accuracy: 63.2%** (5-fold, vs 50% random baseline — +13.2pp edge)
- Trained on **5,467 settled oracle outcomes** — grows automatically as new oracles settle
- Gradient boosting also tested (similar accuracy) — LR selected for simplicity of TypeScript export
- Model retrained automatically every 50 new oracle settlements via `watcher.ts`
- Weights exported to `scripts/model_weights.json` and loaded at inference time in `src/ml-model.ts`

## Allocation model

The allocation brain is two-layer: the ML model provides the directional signal, hermes3 (via Ollama) decides sizing and generates the natural-language reasoning displayed on the dashboard.

The hermes3 prompt receives each cycle:
- BTC spot price, forward, time to expiry
- Realized volatility and price trend from the last 20 oracle price events
- Current manager balance and realized P&L
- Last 5 cycle outcomes

It outputs a structured JSON allocation decision:
```json
{
  "reasoning": "BTC trending up with low vol — UP position near ATM",
  "supply_usdc": 0,
  "positions": [
    { "type": "up", "strike": 71000, "quantity_usdc": 5.0 }
  ],
  "confidence": "high",
  "skip": false
}
```

Safety rails: max 70% of balance deployed per cycle, min 3 min to expiry to enter, skip if vol > 15%.

---

## Hackathon

- **Track:** DeepBook (Sui Overflow 2026)
- **Deadline:** June 21, 2026
- **Protocol branch:** `predict-testnet-4-16`
