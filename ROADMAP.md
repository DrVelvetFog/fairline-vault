# FairLine — Roadmap

Where FairLine is today and the honest path to a production, multi-user vault.

## Today (Sui Overflow 2026, testnet)
- **LP-primary strategy** — earns the DeepBook Predict house edge; ML/vol signal gates exposure defensively. Live and autonomous.
- **Multi-user share vault** (our own Move contract, published to testnet): deposit dUSDC → FLP shares at NAV → pro-rata withdraw. Real on-chain TVL.
- **Transparency** — every decision/transaction on-chain; dashboard surfaces TVL, share price, house-edge accrual, and an honest LP-vs-experimental-sleeve split.
- **Status:** testnet, single-operator, **unaudited**, small capital.

## Known limitations (from internal security review)
1. **Operator trust.** The `AdminCap` can deploy 100% of reserve and reports the deployed NAV (`mark`/`settle`). A malicious operator could mis-mark NAV or deploy-and-stall. *Inherent to an operator-run, operator-reported-NAV vault.*
2. **Operator-reported NAV.** `deployed` is derived from the on-chain PLP redemption rate (independently verifiable), but it is written by the operator rather than read trustlessly on-chain.
3. **No pause / no deploy caps / no timelock** yet.

## Near-term hardening (pre-mainnet, in priority order)
1. **On-chain NAV.** Have the vault read PLP value *trustlessly* inside Move (cross-package call into Predict) instead of an operator `mark` — removes the largest trust surface.
2. **Deploy caps + timelock** on the `AdminCap`; **pause** switch.
3. **Third-party security audit** (we will never self-label "audited").
4. **Permissionless keeper** so deploy/settle isn't operator-gated.
5. **Withdrawal queue** for when reserve is fully deployed (currently withdrawals are limited to idle reserve).

## Mainnet path
**Blocked upstream:** DeepBook Predict is **testnet-only** today (the package does not exist on Sui mainnet — verified on-chain). FairLine cannot run on mainnet until Mysten ships Predict there.

When Predict reaches mainnet, the sequence is: complete the hardening above → third-party audit → deploy the vault + strategy to mainnet → open multi-user deposits with conservative caps.

## Beyond
- **Pluggable strategy brain** — the vault framework can host strategies other than LP/Predict.
- **Multiple markets** — extend beyond BTC binaries as DeepBook Predict adds markets.
- **Strategy marketplace** — let others deploy risk-gated strategies into transparent, on-chain vaults.
