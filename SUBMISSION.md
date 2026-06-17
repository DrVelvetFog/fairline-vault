# FairLine — Submission Narrative

*Sui Overflow 2026 · DeepBook track · testnet*

> A tranched, risk-managed liquidity vault that lets anyone **be the house** of
> DeepBook's on-chain prediction markets — and provides liquidity directly to
> DeepBook's core orderbook. One ML/volatility risk brain governs both venues.
> Every decision and every transaction is on-chain and verifiable.

🌐 **[fairline-vault.netlify.app](https://fairline-vault.netlify.app)** · 🎬 **[Demo](https://youtu.be/ASc9A0AcXi8)** · 🔎 **[Vault on-chain](https://suiscan.xyz/testnet/object/0x6f50a5439ef6df079f5807c93ac5bf14aa14f39841448395eb7ac8e40287d71e)**

---

## The problem (real-world application)

DeepBook's Predict markets are a new on-chain primitive: BTC binary options that
settle every 15 minutes. Like every options market there are two roles — the
**traders** who take directional bets, and the **house** (the liquidity pool)
that takes the other side and earns the spread.

Two real problems follow:

1. **These markets need liquidity to function**, and providing it well requires
   automation, risk management, and capital discipline most participants lack.
2. **Directional trading these markets is a losing game for almost everyone** —
   the spread is a structural edge for the house, against the trader.

FairLine is infrastructure for the *profitable, durable* side of that trade,
packaged so anyone can join in one click — with the risk professionally managed
and the results fully verifiable on-chain.

## The honest journey — why we provide liquidity instead of betting

We did not start here, and the pivot is the most important thing we learned.

FairLine began as an ML-driven **directional** vault. In backtest it looked
strong. **Live on testnet it lost money**: a 41.3% win rate against ~51.5%
break-even, −830 dUSDC realized. The model was ~63% accurate at *direction* on
cross-validation, yet still lost — the 2% spread is wider than the edge.

That result is the thesis, not a footnote. We asked *where did the money go?* —
on-chain, the answer is exact: into the **house**. So we re-weighted FairLine
from the losing player to the winning house, and repurposed the ML signal
**defensively** — a strong predicted move is exactly when the house carries the
most directional risk, so we scale exposure down. A losing alpha model becomes a
useful risk model.

## What FairLine is now — a structured product, not just a bot

FairLine grew from a single LP vault into a full on-chain structured product.
Six features, each built and verified live:

1. **🟢🟡🔴 Risk-state posture** — one ML/volatility gate (logistic model, 12
   features, 5-fold CV + realized-vol regime), surfaced as a live Green/Amber/Red
   signal that governs *every* venue's exposure.
2. **⚖️ Provably-fair pricing** — deposits and withdrawals price at a
   *freshly-marked* NAV, recomputed independently from the on-chain PLP rate. The
   live drift between the price the contract would charge and the honest one is
   shown and correctable on-chain — you never enter or exit at a stale price.
3. **🏦 Senior / junior tranches** — our Move vault splits into FLP-S and FLP-J. A
   capped profit-share waterfall gives **senior** principal protection + a capped
   yield (≤8% APR); **junior** absorbs losses first and takes the leveraged
   upside. Structured credit applied to a prediction-market house — pick your risk.
4. **📊 Capacity cap** — the house edge is capacity-constrained, so an on-chain
   `VAULT_CAPACITY` **rejects deposits past productive capacity** rather than
   silently diluting everyone's yield. A vault that closes the door when adding
   money would hurt you.
5. **🔁 House flywheel** — FairLine routes a slice of its edge into a rebate pool
   and pays predictors pro-rata to their real on-chain trading volume. More
   rebates → more volume → more edge → more rebates. (Live: 22 real predictors
   paid in one PTB.)
6. **📖 Direct DeepBook CLOB maker** — the same risk gate runs a posture-gated,
   inventory-skewed **market maker placing real limit orders on DeepBook's core
   orderbook** (the whitelisted DEEP/SUI pool). *One risk brain, two venues:* the
   prediction market and the orderbook.

Depositors interact through a real **wallet-connect dApp** (Slush), not a script:
deposit dUSDC into a tranche → receive FLP-S/FLP-J → withdraw pro-rata, any time.

## Our own Move contracts (live on testnet)

A tranched, NAV-based share vault (`fairline_vault`) — `vault.move` +
`flp_s.move` / `flp_j.move` (tranche tokens) + `rewards.move` (flywheel pool),
**11 passing unit tests** across the package, three clean package upgrades
(capacity, rewards, then security hardening — an emergency **pause** and a 15%
**reserve floor** on deploys so depositors always keep withdrawal liquidity and
no single deploy can drain the vault). Composes atomically with Predict (one PTB:
`vault.deploy` → `predict.supply`). Mark/settle run the senior/junior waterfall
and stamp `marked_at` so freshness is provable on-chain.

## What makes it unique

| | Generic vaults (Yearn) | "Be the house" LP vaults (GMX **GLP**, Jupiter **JLP**) | Tranching protocols (BarnBridge, Idle) | **FairLine** |
|---|---|---|---|---|
| Yield source | aggregated farm yield | perp-trader losses | lending yield | **prediction-market edge + CLOB spread** |
| Tranches | ❌ | ❌ single class | ✅ | ✅ |
| ML risk gate | ❌ | ❌ | ❌ | ✅ |
| Provably-fair pricing | ❌ | partial | ❌ | ✅ |
| Capacity cap | ❌ | ❌ | ❌ | ✅ |
| Rebate flywheel | ❌ | ❌ | ❌ | ✅ |
| Direct DeepBook orderbook | — | — | — | ✅ |

**"GLP for prediction markets — but tranched, risk-gated, provably-fair-priced,
capacity-capped, with a predictor rebate flywheel, and a live DeepBook CLOB
maker."** The individual ideas exist in DeFi; the combination, over this
underlying, on Sui, does not exist anywhere else.

**"Why not just use DeepBook's own market maker?"** Different layer, not a
competitor. DeepBook's MM provides *liquidity* — quotes from minute one
(infrastructure). FairLine is the structured-product layer above it: *who gets to
be the house, and on what risk terms.* It turns house P&L into something a normal
person can hold — a risk-tranched, capacity-gated, fair-priced share — without
running a bot or taking uncapped downside. The tell that FairLine is a product,
not a maker: it **caps capacity and refuses deposits** when they'd dilute yield. A
market maker always wants more capital; FairLine optimizes the depositor's return.

**And against the analytics/tooling entries this track attracts:** terminals,
vol-surface viewers and arb bots make this market smarter *for professionals* —
FairLine packages the house edge so everyone else can *hold* it. An options
ecosystem needs both layers. We are the product layer, not the tooling layer:
the structural edge those tools surface is exactly what FairLine's depositors
already earn, on-chain, today.

## Meaningful DeepBook integration (the track, directly)

- **Predict liquidity** — atomic PTBs for `supply`, withdraw→supply straight from
  the PredictManager, and `get_trade_amounts` devInspect pricing previews against
  the live Predict protocol.
- **Core orderbook (CLOB)** — FairLine places, cancels, and manages **real limit
  orders on DeepBook v3's order book** via raw PTBs (`pool::place_limit_order`,
  `cancel_all_orders`, `mid_price`), through a DeepBook BalanceManager, on the
  whitelisted DEEP/SUI pool. This is direct, verifiable liquidity provision on
  DeepBook's central limit order book — the heart of the track.

## Verified live on-chain

| Step | Transaction |
|---|---|
| Senior deposit → FLP-S | [`2m2UvMWE…`](https://suiscan.xyz/testnet/tx/2m2UvMWEUNk6PksXpz6vHdFAqjYT53hxXtmq4scoNynE) |
| Junior deposit → FLP-J | [`9wdQYzuv…`](https://suiscan.xyz/testnet/tx/9wdQYzuvPQAy3eYf2WJXxq77xsv9AHkCTmbcMRH93gBu) |
| Junior withdraw (funds not trapped) | [`Gd3zGDBx…`](https://suiscan.xyz/testnet/tx/Gd3zGDBxiackZhdhLFRC2idTtpJQHhxKfHgBTt8gxYpd) |
| Flywheel — rebates to 22 predictors | [`FjTaze5q…`](https://suiscan.xyz/testnet/tx/FjTaze5qYkY81q4zHKUBuFt9a2M8yGTi27YCesdnRWRo) |
| **Live DeepBook CLOB limit order** | [`8Wrs564E…`](https://suiscan.xyz/testnet/tx/8Wrs564ExgE6B344iiSfhTwp6cKNeu4vPtYVTNbtw5dH) |

Plus a 52-depositor simulation across both tranches, taking the vault to a real
multi-user TVL. NAV's deployed-mark is *computed* from the on-chain PLP redemption
rate — so anyone can recompute it — though today it's submitted by the operator
(`new_deployed`) rather than read on-chain by the contract. That last step is the
one documented trust assumption; it's bounded (`settle` can't claim more than was
returned) and timestamped on-chain (`marked_at`). We tighten it further with a
**redemption-anchored settle** (proven on testnet): one PTB redeems the deployed
PLP through `predict::withdraw` and settles the *chain-enforced* proceeds, so each
checkpoint realizes NAV to real reserve the operator can't inflate — only the small
between-checkpoint drift stays asserted. (A fully on-chain NAV *read* in Move isn't
possible against the current Predict build — it exposes no PLP-value view — so we
realize the value trustlessly rather than assert it.)

## Transparency as a product

DeFi is full of unverifiable performance claims. FairLine logs **every** cycle
decision and transaction digest; the dashboard surfaces the live posture, fair vs
on-chain price, tranche split, capacity, the flywheel pool, and the DeepBook
maker's resting orders. The claim is not "trust us, we win" — it's "verify us
on-chain." We say testnet and unaudited, plainly.

## Long-term vision

The risk brain is swappable and already governs two venues, and the vault
framework can host other strategies. The two venues have **different mainnet
paths**: DeepBook's core orderbook is *already live on mainnet*, so the CLOB-maker
sleeve can ship there after hardening + audit, independent of anything upstream —
whereas the Predict-house sleeve is **upstream-gated** (DeepBook Predict is
testnet-only today; the package does not exist on mainnet — verified on-chain, not
faked). So the mainnet path is partial-ready, not blocked. Next: make the
redemption-anchored settle the canonical mark path, depositor-funded CLOB
market-making (once a dUSDC↔DeepBook market exists), and senior coverage enforced
on-chain.

---

### How this maps to the judging criteria

- **Real-World Application (50%):** solves a real need (liquidity for nascent
  on-chain markets) on the durable side of the trade, as a structured product
  ordinary users can actually hold (senior = safe, junior = leveraged) — value
  verifiable on-chain, not asserted.
- **Technical Implementation (20%):** **direct DeepBook CLOB integration** (raw
  PTBs, BalanceManager, live orders) *and* Predict liquidity; four Move modules
  with a profit-share waterfall, capacity cap, and rewards; an ML risk engine;
  reliable autonomous operation; two clean package upgrades.
- **Product & UX (20%):** wallet-connect tranche dApp on mobile, a live dashboard
  showing all six features, honest reporting, one-click flows.
- **Presentation & Vision (10%):** a clear, honest story — player → house →
  structured product — with a credible path beyond the hackathon.
