# FairLine — Security

Testnet, unaudited. This document is the honest threat model, the hardening
that's shipped, and the operator runbook. FairLine's whole posture is *verify,
don't trust* — that includes being plain about what is and isn't protected yet.

## Trust model (what a user is trusting)

- **On-chain & trustless:** every cash movement (deposit, withdraw, deploy,
  redemption) is a real transaction; share math, the senior/junior waterfall,
  the capacity cap, the emergency pause, and the 15% reserve floor are enforced
  in Move. Reserve held in the vault is non-custodial — only `withdraw_*` (which
  anyone can call for their own shares) can remove it, and rounding always favors
  the protocol.
- **The documented trust assumption:** while capital is *deployed*, it leaves the
  vault into the operator's account to be supplied to DeepBook Predict (Predict's
  interface can't yet be called from inside our Move package — see "C1" below), and
  the operator reports the deployed value via `mark`/`settle`. A malicious or
  key-compromised operator could mis-mark NAV or deploy-and-stall. This is bounded
  (see hardening) and disclosed; the full fix is gated on Predict reaching mainnet.

## Hardening shipped (package `0xe3623bf5…`, 3rd upgrade)

- **Emergency pause** (`set_paused`, AdminCap) — halts deposits and deploys during
  an incident. **Withdrawals are never pausable**, so depositors can always exit.
- **15% reserve floor** — a deploy must leave ≥15% of NAV idle in reserve. This
  guarantees withdrawal liquidity *and* means no single deploy (including from a
  compromised key) can drain the vault to zero.
- **Redemption-anchored settle** — the operator can realize NAV by redeeming the
  deployed PLP through Predict and settling the *chain-enforced* proceeds in one
  PTB, so NAV checkpoints to real reserve the operator cannot inflate.
- **No reentrancy / overflow** surface (Move resource model; capacity-bounded math).
- **Secrets** — no keys in git or history; `.env`, the faucet key, and sim wallets
  are gitignored. Keys live only in environment variables.

## C1 — deployed-capital custody (known residual)

The strongest fix is for the vault to hold its own PLP (call `predict::supply`/
`withdraw` from inside Move). This is **blocked upstream**: DeepBook Predict ships
no linkable on-chain address in its public source, so it can't be added as a Move
dependency without brittle vendoring — and it must be rebuilt for mainnet anyway,
since Predict is testnet-only today. **Plan:** implement full vault-held-PLP custody
at the Predict-mainnet milestone. Until then, the residual is bounded by the pause,
the reserve floor, redemption-anchored settle, and operator-key hardening below.

## H2 — mark-timing (bounded residual)

Tranche P&L is allocated only on `mark`/`settle`, so between marks the share price
is slightly stale and a depositor could in theory time a mark (enter before a
profit mark, or exit before a loss mark). The textbook fix — re-pricing to fresh
NAV on every deposit/withdraw — **is not implementable on-chain here:** the
contract can't compute current NAV (it can't read Predict's deployed value, the
same upstream gap as C1), and a `Clock` parameter can't be added to the existing
`deposit_*` signatures without breaking Sui upgrade compatibility. It is mitigated
to the point of being economically negligible, and fully resolves with C1:
- The keeper marks every **~10 min** (each engine cycle, when material), so the
  stale window is small; on a ~0.3%/day house edge the capturable drift per window
  is ~0.002%.
- The **redemption-anchored settle** grounds NAV in a real on-chain redemption,
  neutralizing the asymmetric "exit before a loss mark" case.
- Full mark-on-interaction lands with the C1 vault-held-PLP rework at Predict
  mainnet, where the contract can realize NAV atomically inside deposit/withdraw.

## Operator key-hardening runbook (H1 — do before any real value)

Today a single hot Ed25519 key (`WALLET_PRIVATE_KEY`) holds the `AdminCap`,
`UpgradeCap`, and `RewardAdminCap` and signs all automation. Compromise = full
control. Tiered fix, highest-impact first:

1. **Move the `UpgradeCap` to cold/multisig storage.** Upgrades are rare and the
   single most dangerous capability (they can replace contract logic). Create a
   Sui multisig and transfer it off the hot key:
   ```
   sui keytool multisig-address --pks <k1> <k2> <k3> --weights 1 1 1 --threshold 2
   sui client transfer --to <MULTISIG_ADDR> --object-id 0xcd81bb09e6846b9b2ae153a3e01e8e58c2fbb08649656589c7b6f08fa4a733cd
   ```
   (UpgradeCap `0xcd81bb09…`). Future upgrades are then 2-of-3 signed.
2. **Hold the `AdminCap` on a hardware-backed or multisig key for high-impact
   actions** (`set_paused`, large deploys). For day-to-day automation, run a
   **separate low-privilege keeper** key with only the powers it needs; the
   cleanest version requires splitting the cap (a contract change — deferred with
   C1). Interim: keep the AdminCap key out of any dev disk — env var only, on the
   server, rotated regularly.
3. **Rotate the current hot key** (`0x43a5…`) once the caps are moved, since it
   has been on a developer machine.
4. **Monitoring + tripwire:** alert on any `Deployed`/`Marked`/`Settled` event
   that moves more than a threshold, and wire a one-command `set_paused(true)`
   so an incident can be halted in seconds.

Caps & objects: AdminCap `0xc0e47b07…` · UpgradeCap `0xcd81bb09…` ·
RewardAdminCap `0xf6463bb2…` · operator `0x43a5…`.

## Reporting

Found something? This is a solo testnet project — open an issue on the repo, or
contact the maintainer. No bounty program yet (testnet, no funds at risk).
