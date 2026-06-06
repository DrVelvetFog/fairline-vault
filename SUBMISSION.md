# FairLine — Submission Narrative

*Sui Overflow 2026 · DeepBook track · testnet*

> An autonomous, risk-managed liquidity vault for DeepBook's on-chain prediction
> markets. FairLine earns the market's structural house edge by providing
> liquidity (PLP), and uses a machine-learning directional model **defensively**
> — to gate that liquidity exposure, not to gamble with it. Every decision and
> every trade is on-chain and verifiable.

---

## The problem (real-world application)

DeepBook's Predict markets are a new on-chain primitive: BTC binary options that
settle every 15 minutes. Like every options market, there are two roles — the
**traders** who take directional bets, and the **house** (the liquidity pool,
PLP) that takes the other side and earns the spread.

Two real problems follow:

1. **These markets need liquidity to function**, and providing it well is
   non-trivial — it requires automation, risk management, and capital discipline
   that most participants don't have.
2. **Directional trading these markets is a losing game for almost everyone** —
   the spread is a structural edge for the house, against the trader.

FairLine is infrastructure for the *profitable, durable* side of that trade: an
automated, risk-gated liquidity provider, built so the strategy and its results
are fully transparent on-chain.

## The honest journey — why we provide liquidity instead of betting

We did not start here, and the pivot is the most important thing we learned.

FairLine began as an ML-driven **directional** vault — a model allocating capital
across BTC binaries each cycle. In backtest it looked strong. **Live on testnet,
it lost money**: a 41.3% win rate against a ~51.5% break-even, −749 dUSDC
realized. The model was ~63% accurate at *direction* on cross-validation, yet
still lost — because the 2% spread is wider than the edge.

That result is not buried; it is the thesis. We asked: *where did that money
go?* On-chain, the answer is exact — it flowed into the **PLP pool**, the house.
So we re-weighted FairLine from the (losing) player to the (winning) house. The
same ML signal that couldn't profit *betting* direction is genuinely valuable
used *defensively*: a strong predicted move is precisely when the house carries
the most directional risk, so we scale liquidity exposure down. A losing alpha
model becomes a useful risk model.

## What FairLine does now

- **LP-primary.** Targets ~70% of capital supplied to PLP, earning the vault's
  spread as the house.
- **ML/vol-gated exposure.** A trained logistic model (12 features, 5-fold CV)
  plus realized-volatility regime scale *how much* liquidity we hold. We scale
  position by risk rather than thrashing in and out — justified directly by
  on-chain data (see below).
- **Capped experimental directional sleeve.** Directional trading survives as a
  small, hard-capped (≤15 dUSDC/position, ≤45/cycle) research sleeve, only in
  calm regimes with high model confidence. Its full P&L is reported honestly.
- **Multi-user share vault (our own Move contract, live on testnet).** Anyone
  deposits dUSDC and receives fungible FLP shares priced at NAV; withdraws
  pro-rata — through a real wallet-connect dApp, not a script. The operator runs
  the LP strategy on the pooled capital. This turns FairLine from a single bot
  into a **product with depositors and real TVL** — deposit → deploy to PLP →
  earn the house edge → share price rises. Verified end to end on-chain (deposit
  `GGFyppXc…`, deploy-to-PLP `7J1oNLrk…`, NAV mark `FvtUkRNJ…`).
  - **Who it's for:** anyone who wants prediction-market yield without running a
    bot, holding keys, or sizing risk.
  - **Verifiable NAV:** the FLP share price is the vault's NAV derived from the
    on-chain PLP redemption rate — verifiable by anyone, not operator-set.
    (Fully-trustless on-chain NAV inside Move is on the roadmap.)

## Verifiable on-chain facts (testnet, at time of writing)

| Fact | Value | Source |
|---|---|---|
| PLP redemption rate | **1.003154** dUSDC/PLP | `Predict` object on-chain |
| House edge realized to date | **+0.315%** | (rate − 1) |
| Vault reserves | ~1,011,552 dUSDC | vault balance |
| Vault open liability | **0.087% of reserves** | `total_mtm` / reserves |
| House spread | 2% base (scales with utilization) | `pricing_config` |
| FairLine capital | ~4,253 dUSDC (conserved end-to-end) | manager + wallet + PLP |
| Directional sleeve P&L (honest) | −749 dUSDC, 41.3% win rate | settled positions |

The vault's open liability being ~0.09% of reserves is *why* sticky liquidity
(never force-exiting) is the right design — forced exits would only churn gas.
This is a data-driven risk decision, not an assumption.

Representative live LP supply transactions:
`6LynpESWJTCc557v3FTTg47ok4dNxtjVFeCJvH7jhe6v`,
`CznuJcDuA8dGL7p4FeizQTmBJdr5PjFWH2dircR8YiAw`,
`6RCL69MDBKb9YhFmcPDmPVNf3THrZf3XaxmVrKmDT4Xz`.

## Technical implementation

- **Our own Move contract:** a NAV-based multi-user share vault (`fairline_vault`)
  published to testnet — deposit/withdraw/deploy/settle, fungible FLP shares,
  passing unit tests, internal security review. Composes atomically with Predict
  (one PTB: `vault.deploy` → `predict.supply`).
- **Meaningful Sui/DeepBook integration:** PTBs for `supply`, atomic
  `withdraw`→`supply` straight from the PredictManager, mint-from-Manager-balance,
  and `get_trade_amounts` devInspect pricing previews — all against the live
  Predict protocol.
- **ML retraining flywheel:** continuously retrains on settled oracles
  (3,400+ to date) — a living model, not a static artifact.
- **Reliability:** runs under pm2 (autonomous watcher, dashboard, hourly P&L
  summary); indexer calls retry transient 5xx; jobs are crash-hardened.
- **Safety:** every executing PTB is devInspect-validated first; absolute risk
  caps bound the directional sleeve.

## Transparency as a product

DeFi is full of unverifiable performance claims. FairLine logs **every** cycle
decision (`logs/cycles.jsonl`: LP factor, target, action) and every transaction
digest, and the dashboard surfaces the live PLP position, redemption-rate
accrual, and an honest split between LP income and the experimental sleeve. The
claim is not "trust us, we win" — it's "verify us on-chain."

## Long-term vision

The allocation brain is swappable. Today it's an ML risk-gate over LP; the same
vault framework can host other strategies, scale to mainnet DeepBook markets, and
let others deploy capital into a transparent, risk-managed liquidity layer for
on-chain prediction markets.

---

### How this maps to the judging criteria

- **Real-World Application (50%):** solves a real need (liquidity for nascent
  on-chain markets) on the durable side of the trade; the value proposition is
  verifiable on-chain rather than asserted.
- **Technical Implementation (20%):** deep, live DeepBook/Sui integration; an ML
  risk engine; reliable autonomous operation.
- **Product & UX (20%):** one-screen dashboard, honest live reporting, one-click
  cycle.
- **Presentation & Vision (10%):** a clear, honest story — player → house — with
  a credible path beyond the hackathon.
