# FairLine — Demo Video Script (~4:45, target ≤5:00)

Narration is written for AI TTS (~150 wpm). On-screen cues tell you what to show
on the dashboard (`http://localhost:3002`) and Sui explorer. Honest framing
throughout — testnet, unaudited.

---

### Scene 1 — Hook & problem (0:00–0:35)
**ON SCREEN:** Dashboard top — FairLine logo, live BTC market, metrics bar.
**NARRATION:**
> "DeepBook Predict is a new on-chain market on Sui — Bitcoin options that settle every fifteen minutes. Like every options market, there are two sides: the traders who bet on direction, and the house that takes the other side and earns the spread. FairLine is built for the durable side of that trade — an autonomous, risk-managed liquidity vault that earns the house edge, with every decision verifiable on-chain."

### Scene 2 — The honest pivot (0:35–1:20)
**ON SCREEN:** Scroll to the "Directional Sleeve (Experimental)" card, then the LP card.
**NARRATION:**
> "We didn't start here. FairLine began as a machine-learning bot betting on direction. In backtest it looked great. Live on testnet, it lost money — a forty-one percent win rate against a fifty-one-and-a-half percent break-even. The two-percent spread was wider than the model's edge. So we asked: where did that money go? On-chain, the answer is exact — it went to the liquidity pool. The house. So we flipped sides — from the losing player to the house — and repurposed the model as a defensive risk signal instead of a betting engine."

### Scene 3 — The LP engine (1:20–2:20)
**ON SCREEN:** LP card — PLP position (~3,000 dUSDC), redemption rate, house edge +0.3%, exposure factor; then the Engine Activity table.
**NARRATION:**
> "Here's the live engine. FairLine supplies liquidity to the Predict pool and earns the spread — the redemption rate climbs as the house wins. The machine-learning and volatility signals don't place bets anymore; they gate exposure. When a big directional move is likely, FairLine scales its liquidity down. It's sticky by design — it sizes position by risk instead of churning in and out, because the pool's open liability is under a tenth of a percent of reserves."

### Scene 4 — The multi-user vault (2:20–3:25)
**ON SCREEN:** FairLine Vault card — TVL, share price, FLP supply. Then briefly the Sui explorer showing the deposit + withdraw tx digests.
**NARRATION:**
> "FairLine isn't just a bot — it's a product. We deployed our own Move contract: a multi-user vault. Anyone deposits dUSDC and receives FLP share tokens priced at net asset value. The vault deploys that capital into the pool to earn the house edge, and depositors can withdraw their pro-rata share at any time. This is live on testnet with two real depositors — a deposit, the capital flowing into the pool, and a withdrawal — all on-chain, all verifiable."

### Scene 5 — Transparency (3:25–4:05)
**ON SCREEN:** House Edge Accrual chart; the honest LP-vs-sleeve split; cycles log.
**NARRATION:**
> "Every cycle decision and every transaction is logged on-chain. The dashboard shows the house edge accruing over time, the vault's total value, and an honest split between the liquidity strategy and the small, capped experimental sleeve. We don't ask you to trust a number — you can verify all of it on Sui. And we're clear about what this is: testnet, unaudited, with a documented path to hardening."

### Scene 6 — Vision & close (4:05–4:45)
**ON SCREEN:** ROADMAP.md or the vault card; end on the FairLine logo.
**NARRATION:**
> "The roadmap is honest: on-chain net-asset-value, deploy caps, a third-party audit, and mainnet once DeepBook Predict ships there. The vault framework is strategy-agnostic — today it's risk-gated liquidity provision; tomorrow it can host others. FairLine turns a hard, losing game into a transparent, multi-user product on the winning side of the trade. Be the house — verifiably. Thanks for watching."

---

**Word count ≈ 520 (~3:30 of speech) — leaves ~1:15 for on-screen pauses and demo actions.**
