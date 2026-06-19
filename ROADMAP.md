# FairLine — Roadmap

Where FairLine is today and the honest path to a production, multi-user vault.

## Today (Sui Overflow 2026, testnet)
- **LP-primary strategy** — earns the DeepBook Predict house edge; ML/vol signal gates exposure defensively. Live and autonomous.
- **Multi-user share vault** (our own Move contract, published to testnet): deposit dUSDC → FLP shares at NAV → pro-rata withdraw. Real on-chain TVL.
- **Transparency** — every decision/transaction on-chain; dashboard surfaces TVL, share price, house-edge accrual, and an honest LP-vs-experimental-sleeve split.
- **Status:** testnet, single-operator, **unaudited**, small capital.

## Known limitations (from internal security review)
1. **Operator trust.** The `AdminCap` reports the deployed NAV (`mark`/`settle`), so a malicious operator could mis-mark NAV within bounds. A 15% reserve floor is enforced on-chain (a single deploy cannot drain the vault) and an emergency pause is in place, but mark integrity is *inherent to an operator-run, operator-reported-NAV vault.*
2. **Operator-reported NAV.** `deployed` is derived from the on-chain PLP redemption rate (independently verifiable), but it is written by the operator rather than read trustlessly on-chain. **Mitigated** by the redemption-anchored settle (hardening #1, shipped): each checkpoint realizes NAV to chain-enforced reserve, so only the small between-checkpoint drift is operator-asserted.
3. **No timelock** on the `AdminCap` yet. (An emergency pause and a 15% reserve-floor deploy cap are shipped — see Near-term hardening #2.)

## Near-term hardening (pre-mainnet, in priority order)
1. **Trustless NAV — redemption-anchored settle (SHIPPED on testnet).** The original plan was to *read* PLP value trustlessly inside Move via a cross-package call into Predict. We verified that is **not possible against the current Predict build**: Predict exposes the value getters (`vault::balance/vault_value/total_mtm`) but no accessor returns its inner `&vault::Vault`, there is no PLP-supply accessor, and there is no `plp_value(amount)` view — so a Move `mark` cannot compute redemption value on-chain (an upstream interface gap, not a design choice). Instead we *realize* the value trustlessly: `predict::withdraw` redeems `Coin<PLP> → Coin<dUSDC>` with a **chain-enforced** amount, so a single atomic PTB `withdraw → vault::settle(returned, new_deployed=0)` makes NAV 100% real reserve — the operator never holds the coin and cannot inflate it. This downgrades the trust surface from "operator asserts the entire deployed NAV" to "operator asserts only the small unrealized drift between checkpoints," already bounded on-chain by `settle`'s `new_deployed ≤ deployed + returned`. *Proven on testnet* (`src/vault.ts::buildRedemptionAnchoredSettle`, harness `scripts/anchored-settle.ts`): a full anchor took `deployed → 0`, redeemed 1597.94 PLP for a chain-enforced 1600.88 dUSDC, and the waterfall booked the −1.20 stale-mark correction to junior with senior fully protected (tx `AkwStMFmow3KWYRMocqTTeeUCMXUoByuPv8aQLNPAVQh` — `predict::Withdrawn.amount` == `vault::Settled.returned`). Predict's withdrawal rate-limiter (`available_withdrawal`) is effectively unlimited on testnet; size redemptions to it on mainnet. Next: run the anchor on a periodic checkpoint cadence and make it the canonical mark path (the lot-based `mark` becomes the between-checkpoint estimate only).
2. **Emergency pause + 15% reserve floor (SHIPPED on testnet).** `set_paused` (AdminCap) halts deposits and deploys while withdrawals stay open, and every deploy must leave ≥15% of NAV idle as withdrawal liquidity — no single deploy can drain the vault. *Still TODO:* an AdminCap **timelock** and tighter per-deploy caps.
3. **Third-party security audit** (we will never self-label "audited").
4. **Permissionless keeper** so deploy/settle isn't operator-gated.
5. **Withdrawal queue** for when reserve is fully deployed (currently withdrawals are limited to idle reserve).

## Mainnet path
FairLine's two venues have **different** mainnet readiness:

- **CLOB-maker sleeve — mainnet-capable today.** DeepBook's core orderbook is already live on Sui mainnet, so the posture-gated maker can deploy there after the hardening above + a third-party audit, independent of anything upstream.
- **Predict-house sleeve — upstream-gated.** DeepBook Predict is **testnet-only** today (the package does not exist on Sui mainnet — verified on-chain). The house sleeve cannot run on mainnet until Mysten ships Predict there.

So the mainnet path is *partial-ready, not blocked*. Sequence: complete the hardening above → third-party audit → ship the CLOB-maker sleeve to mainnet under conservative caps → add the Predict-house sleeve when Predict reaches mainnet.

## Beyond
- **Pluggable strategy brain** — the vault framework can host strategies other than LP/Predict.
- **Multiple markets** — extend beyond BTC binaries as DeepBook Predict adds markets.
- **Strategy marketplace** — let others deploy risk-gated strategies into transparent, on-chain vaults.
