# FairLine — System Demo Script (video 1 of 2: laptop / behind the scenes)

*Target ~2:45 (≤3:00). Narration written for AI TTS (~150 wpm). On-screen cues
show the dashboard (`http://localhost:3002`), terminal, and Sui explorer. Honest
framing throughout — testnet, unaudited.*

> Companion: **DEMO_SCRIPT_APP.md** (the phone/Slush walkthrough). A single
> stitched cut is in **DEMO_SCRIPT_FULL.md**.

---

### Scene 1 — Hook & problem (0:00–0:25)
**ON SCREEN:** Dashboard top — logo, live BTC market, the posture banner, the metrics bar.
**NARRATION:**
> "DeepBook Predict is a new on-chain market on Sui — Bitcoin options that settle every fifteen minutes. Like every options market, there are two sides: the traders who bet, and the house that takes the other side and earns the spread. FairLine lets anyone be the house — and it's a full structured product, live and verifiable on-chain."

### Scene 2 — The honest pivot (0:25–0:55)
**ON SCREEN:** Landing page "The pivot" section, or the directional-sleeve card.
**NARRATION:**
> "We didn't start here. FairLine began as a machine-learning bot betting on direction. Live on testnet, it lost money — a forty-one percent win rate against a fifty-one-and-a-half percent break-even. The two-percent spread was wider than the model's edge. So we asked where that money went. On-chain, the answer is exact — it went to the house. So we flipped sides, and turned the losing model into a defensive risk signal."

### Scene 3 — One risk brain (0:55–1:15)
**ON SCREEN:** Run `npx tsx src/posture.ts` → the 🟢/🟡/🔴 print; then the dashboard posture banner.
**NARRATION:**
> "At the core is one risk brain — an ML and volatility gate that reads the market as Green, Amber, or Red. Green: full exposure. Amber: pull back. Red: sit flat. This same signal governs every part of the system you're about to see."

### Scene 4 — Tranches & capacity (1:15–1:40)
**ON SCREEN:** Dashboard — the TRANCHED vault card (senior/junior) + the capacity meter.
**NARRATION:**
> "The vault is tranched. Senior is principal-protected and earns a steady, capped yield. Junior takes the first loss but the leveraged upside — you pick your risk. And it's capacity-capped on-chain: when more deposits would dilute the yield, the vault closes the door. The opposite of chasing TVL for its own sake."

### Scene 5 — Fair pricing & the flywheel (1:40–2:05)
**ON SCREEN:** Run `npx tsx src/fairness.ts` (fair vs on-chain price, drift), then `npx tsx src/rewards.ts status` (pool, rebates, predictors).
**NARRATION:**
> "Every deposit and withdrawal prices at a freshly-marked, honest NAV — we show the live drift, so no one transacts at a stale price. And FairLine is two-sided: it routes a slice of its edge back to the predictors trading the markets it backs — real rebates, paid pro-rata to on-chain volume. We've already paid twenty-two traders."

### Scene 6 — Direct DeepBook orderbook (2:05–2:30)
**ON SCREEN:** Run `npx tsx src/deepbook-mm.ts quote` → the maker reading posture + mid, then placing/cancelling real limit orders; cut to Suiscan showing a resting order on the DEEP/SUI book.
**NARRATION:**
> "And the same risk brain runs a market maker directly on DeepBook's core orderbook — resting real limit orders on the DEEP-SUI book, gated by the exact same posture. One brain, two venues: the prediction market and the orderbook. This is live, on-chain liquidity on DeepBook itself."

### Scene 7 — Transparency, verify & close (2:30–2:45)
**ON SCREEN:** Suiscan — the tranched vault object and the DeepBook order tx; end on the FairLine logo.
**NARRATION:**
> "None of this is a mockup — open the vault and the orders on Sui yourself. Tranches, fair pricing, a capacity cap, a predictor flywheel, a risk gate, and a live DeepBook maker. It's GLP for prediction markets — but structured, honest, and verifiable. FairLine. Be the house."

---

**Narration ≈ 420 words (~2:50 of speech, including demo pauses). Trim Scene 2 first if you need to tighten.**
