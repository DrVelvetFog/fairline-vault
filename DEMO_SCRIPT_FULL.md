# FairLine — Full Demo Shooting Script

*Target length: ~3:00. Demo-first judging — show real, working, on-chain.*

Two footage sources, stitched in edit:
- **Laptop (Part A)** — terminal + dashboard "behind the scenes."
- **Phone (Part B)** — the live dApp through your Slush wallet.

---

## 0. Pre-flight checklist (do before recording)

**Laptop**
- [ ] `pm2 status` → `fairline-dashboard` + `fairline-watcher` online. Dashboard at **http://localhost:3002**.
- [ ] Operator wallet has **SUI** (≥0.5) and the DeepBook **BalanceManager** is funded — check: `npx tsx src/deepbook-mm.ts status`.
- [ ] Terminal: big font (18pt+), dark theme, wide window, `clear` between scenes.
- [ ] Browser tabs ready: dashboard (`localhost:3002`), Suiscan vault object, Suiscan DeepBook order tx.
- [ ] Note the **current posture** (`npx tsx src/posture.ts`). 🟢/🟡 → the DeepBook maker will *place* orders on camera; 🔴 → it will *cancel all* (also a great gate demo — just narrate accordingly).

**Phone**
- [ ] Slush wallet installed, set to **Testnet**, holding some **dUSDC** (to deposit) + a little **SUI** (gas).
- [ ] Open **fairline-vault.netlify.app/app** in the phone browser, logged out (so the connect flow is on camera).
- [ ] Screen-record at high quality; silence notifications.

---

## PART A — Behind the scenes (laptop)  ≈ 0:00–1:45

### Scene 1 · Hook (0:00–0:12)
- **SCREEN:** Dashboard top — TVL, the posture banner, the feature cards.
- **SAY:** *"This is FairLine — it lets anyone be the house of a prediction market. Deposit dUSDC, earn the structural house edge, and the risk is managed for you. Everything you'll see is live on Sui testnet and verifiable on-chain."*

### Scene 2 · One risk brain (0:12–0:30)
- **DO:** `npx tsx src/posture.ts`
- **SCREEN:** the 🟢/🟡/🔴 posture print.
- **SAY:** *"At the core is one risk brain — an ML and volatility gate that reads the market as Green, Amber, or Red. Green: full exposure. Amber: pull back. Red: sit flat. This same signal governs every part of the system."*

### Scene 3 · Tranches + capacity (0:30–0:52)
- **SCREEN:** Dashboard → **FairLine Vault (TRANCHED)** card + the **capacity meter**.
- **SAY:** *"The vault is tranched. Senior is principal-protected and earns a steady capped yield. Junior takes the first loss but the leveraged upside — pick your risk. And it's capacity-capped: when more deposits would dilute the yield, the vault closes the door on-chain — the opposite of TVL-maxxing."*

### Scene 4 · Provably-fair pricing (0:52–1:10)
- **DO:** `npx tsx src/fairness.ts`
- **SCREEN:** fair vs on-chain share price + the drift / FRESH badge.
- **SAY:** *"Every deposit and withdrawal prices at a freshly-marked NAV — recomputed independently from the on-chain rate. We show the live drift between what the contract would charge and the honest price, so no one ever enters or exits at a stale, unfair price."*

### Scene 5 · House flywheel (1:10–1:28)
- **DO:** `npx tsx src/rewards.ts status`
- **SCREEN:** pool balance, lifetime rebated, payout count, predictors.
- **SAY:** *"FairLine is two-sided. It routes a slice of its edge back to the predictors trading the markets it backs — real rebates, paid pro-rata to on-chain volume. More rebates, more volume, more edge. We've already paid twenty-two real traders."*

### Scene 6 · Direct DeepBook orderbook (1:28–1:45)
- **DO:** `npx tsx src/deepbook-mm.ts quote`
- **SCREEN:** the maker reading posture + mid, then **placing/cancelling real limit orders** (🟢/🟡 → BID/ASK printed; 🔴 → "cancelled all, sitting flat").
- **SAY:** *"And the same risk brain runs a market maker directly on DeepBook's core orderbook — resting real limit orders on the DEEP/SUI book, gated by the exact same posture. One brain, two venues: the prediction market and the orderbook."*

### Scene 7 · Don't trust — verify (1:45–1:55)
- **SCREEN:** Suiscan — the vault object, then the DeepBook order tx (`8Wrs564E…`).
- **SAY:** *"None of this is a mockup. Here's the tranched vault, and here's a live limit order resting on DeepBook's orderbook — open them yourself."*

---

## PART B — The product, on your phone (Slush)  ≈ 1:55–2:45

> Transition card / voiceover: *"And here's what a real user does."*

### Scene 8 · Connect (1:55–2:08)
- **DO (phone):** open the app → tap **Connect Wallet** → choose **Slush** → approve.
- **SCREEN:** wallet connects; the live vault stats + your position card appear.
- **SAY:** *"This is the live dApp. I connect my Slush wallet — no script, just a normal user on a phone."*

### Scene 9 · Deposit into a tranche (2:08–2:28)
- **DO (phone):** Deposit card → toggle **Senior** → enter an amount → **Deposit** → approve in Slush.
- **SCREEN:** status → "✓ Deposited … FLP-S," then the position + TVL update.
- **SAY:** *"I deposit dUSDC into the senior tranche — protected, steady yield — and receive FLP-S shares priced at the vault's live NAV. Or I could pick junior for leverage."*

### Scene 10 · Withdraw — funds aren't trapped (2:28–2:42)
- **DO (phone):** Withdraw card → **Senior** → **MAX** (or part) → **Withdraw** → approve.
- **SCREEN:** status → "✓ Withdrew … → dUSDC"; balance returns.
- **SAY:** *"And I withdraw any time — burn the shares, get my dUSDC back, pro-rata. Funds are never trapped."*

---

## Close (2:42–3:00)
- **SCREEN:** back to the landing page Features section (the six cards) or the dashboard.
- **SAY:** *"Tranches, provably-fair pricing, a capacity cap, a predictor flywheel, a risk gate, and a live DeepBook orderbook maker. It's GLP for prediction markets — but structured, honest, and verifiable. FairLine. Be the house."*
- **SCREEN (end card):** `fairline-vault.netlify.app` · `github.com/DrVelvetFog/fairline-vault` · "Sui Overflow 2026 · DeepBook track · testnet · unaudited"

---

## Editing / stitch plan

1. Record Part A as one continuous laptop screen-capture (or per-scene clips); keep each command's output on screen ~3–5s.
2. Record Part B as one phone screen-capture; the deposit/withdraw approvals are the hero moments — let the Slush sheet show.
3. In edit: Part A → transition card → Part B → close. Trim dead air; speed up any >4s waits 1.5–2×.
4. Voiceover the script over both (recorded separately is fine). Captions help judges skimming on mute.
5. Keep total **≤ 3:00**. If tight, the two safest trims: shorten Scene 5 (flywheel) and merge Scenes 3+4 visually on the dashboard.

## If the posture is 🔴 RED while filming
That's a *feature*, not a problem — in Scene 6 the maker will cancel all orders and sit flat. Narrate: *"Right now the gate is Red — markets are volatile — so the maker pulls all its orders off the book automatically. That's the risk brain protecting capital in real time."* (You can still show the pre-placed resting order on Suiscan in Scene 7.)

---

## Anticipated judge Q&A (have these ready)

These are the two questions most likely to decide whether a judge files FairLine as a *product* or a *wrapper*. Answer the first on the right terms and you win the room; name the second before they find it and you bank trust for everything else.

### Q1 · "Why not just use DeepBook's own market maker?"
*(DeepBook is shipping an internal MM so new Predict markets quote from minute one — expect this question.)*

**Full answer (~50–60s):**
> "Fair question — and the answer is that we're not competing with DeepBook's market maker, we're built on top of it. DeepBook's MM solves a *liquidity* problem: it makes sure a new Predict market has quotes from minute one. That's infrastructure. FairLine solves a different problem one layer up — *who gets to be the house, and on what risk terms.*
>
> Being the house in a prediction market earns the spread. But today that's only available to people who can run a bot and stomach uncapped downside. FairLine turns that house P&L into something a normal person can hold: you deposit, and you own a risk-tranched slice of the edge. Senior is principal-protected by a junior first-loss buffer; junior takes more risk for more yield. The waterfall that splits profit and loss between them is enforced on-chain.
>
> And here's the tell that we're a product, not a market maker: **we cap capacity and refuse deposits when more capital would dilute depositor yield.** A market maker always wants more capital. We sometimes turn it away — because we optimize the depositor's return, not our AUM. DeepBook's MM gives a market liquidity. FairLine gives a person a managed, risk-tranched share of the house."

**15-second version (if rushed):**
> "DeepBook's market maker decides whether a market has quotes. FairLine decides whether *you* — someone who can't run a bot — get to earn the spread those quotes capture, and at what risk tier. We're not a market maker; we're the structured-product layer that turns house P&L into a retail-ownable, risk-tranched asset. The proof: we cap capacity and refuse deposits when they'd dilute yield. A market maker never does that."

> **Delivery:** pause before the capacity-cap line and land it hard — it's the one claim a judge can't refute, and it flips the burden onto them to argue a market maker would ever refuse capital.

### Q2 · "Your NAV is operator-reported — isn't that a trust hole?"

**Full answer (~45–55s):**
> "One honest limitation, and we want to name it before you find it. A depositor's value is net asset value — reserve plus deployed capital. The reserve is real on-chain balance, fully trustless. The one soft number is the *mark* on capital that's currently deployed into the strategy: today the operator reports it. It's not unbounded trust — settlement can't claim back more than was actually returned to the vault, and every mark is timestamped on-chain, so anyone can verify how fresh it is. The mainnet fix is to derive that mark directly from DeepBook Predict's on-chain PLP redemption rate instead of an operator. We've deliberately *not* done that yet, because Predict's package layout is pinned to a testnet branch and will change at mainnet — wiring our NAV tightly to it now would just guarantee a rewrite. So it's sequenced: ship decoupled on testnet, pull NAV on-chain once mainnet Predict is frozen."

> **Why this wins:** the trust surface is literally *one `u64`* (`new_deployed` on `mark`/`settle`) — saying that precisely is far stronger than "operator-reported NAV," and the "before you find it" framing makes judges trust the rest of your claims more. The vault contract itself imports no Predict code (strategy-agnostic, Predict plugged in off-chain), so it survives a mainnet Predict re-deploy untouched — say that if pushed on mainnet risk.
