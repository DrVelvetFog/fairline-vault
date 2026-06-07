# FairLine — App Walkthrough Script (video 2 of 2: phone / Slush wallet)

*A real user using the app on a phone, with a voiceover. **Target ~1:50.** Record
portrait (vertical) on your phone, screen-recording the browser at
`fairline-vault.netlify.app`.*

> Companion: **DEMO_SCRIPT.md** (the laptop/system video). A single stitched cut
> is in **DEMO_SCRIPT_FULL.md**.

**Before recording:** Slush wallet on **Testnet** holding some **dUSDC** (to
deposit) + a little **SUI** (gas). App open at `/` (landing), logged out.

Pace to these beats; loose timing is fine (narration syncs to scenes, not the clock).

| # | On screen (do this) | Narration |
|---|---|---|
| 1 | Landing page — scroll past the tranche / DeepBook feature cards | "This is FairLine — be the house of DeepBook's prediction markets, with the risk managed for you. Let's use it." |
| 2 | Tap **Launch app** | "One tap opens the app — right in the phone's browser, no install." |
| 3 | App loads; rest on the **Tranches** + TVL/capacity stats | "Before you deposit, everything's live from the chain: total value locked, how full the vault is against its capacity cap, and the two tranches." |
| 4 | Point to **Senior** vs **Junior** rows | "You choose your risk. Senior is principal-protected with a steady, capped yield. Junior takes the first loss but the leveraged upside." |
| 5 | Tap **Connect Wallet** → choose **Slush** → approve | "Connect a Sui wallet — I'm using Slush — and approve." |
| 6 | **Your Position** card appears | "Now you see your position — your tranche shares, their value, and your profit or loss, computed from your own on-chain deposits." |
| 7 | Deposit card → toggle **Senior** → small amount → **Deposit** → approve in Slush | "To join, pick a tranche — I'll take Senior for protected yield — enter an amount, deposit, and approve in the wallet…" |
| 8 | Show ✓ confirmation + tap the tx link | "…and you've minted FLP-S shares, priced at the vault's live net asset value. There's the transaction, on-chain." |
| 9 | Withdraw card → **Senior** → MAX → **Withdraw** → approve | "Withdraw any time — burn your shares for a pro-rata claim. Approve…" |
| 10 | Show ✓ + the returned dUSDC | "…and your dUSDC is back in your wallet. No lock-ups, no middleman." |
| 11 | End on the app / logo | "Pick your risk, earn the house edge, withdraw whenever — and verify every number yourself. That's FairLine." |

**Narration ≈ 200 words (~1:25 of speech)** — the rest is wallet-approval pauses.

---

### Workflow when you've recorded it
1. Save the screen recording to your Mac (AirDrop or cable) — e.g. `demo/screen-app.mov`. Tell me the path.
2. I'll generate the voiceover, stitch it onto your **portrait** video (output vertical 1080×1920 so it isn't letterboxed), and add captions if you want.

### Two videos / one submission link
DeepHub's "Demo Video" field takes **one** link. When both are ready:
- **Combine** into one cut (system ~2:45, then app ~1:50 ≈ **4:35**, under the 5-min cap) — I can concatenate with ffmpeg. *(Recommended — one cohesive story; matches DEMO_SCRIPT_FULL.md.)*
- Or submit the app walkthrough and link the system video from the README/site.
