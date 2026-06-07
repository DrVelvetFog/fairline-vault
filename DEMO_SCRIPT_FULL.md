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
