/**
 * DeepBook CLOB market-making sleeve — posture-gated two-sided maker.
 *
 *   npx tsx src/deepbook-mm.ts setup [sui]   # create BalanceManager + deposit SUI
 *   npx tsx src/deepbook-mm.ts quote          # one risk-gated quoting cycle
 *   npx tsx src/deepbook-mm.ts status         # read mid, inventory, open orders
 *
 * The SAME Green/Amber/Red posture that governs the prediction-market house
 * governs the orderbook here: Green = tight spread + full size, Amber = wide +
 * half, Red = cancel all and sit flat. Bids are funded with SUI; as bids fill
 * the maker accrues DEEP inventory and quotes asks too (inventory-skewed).
 */
import 'dotenv/config';
import * as fs from 'fs';
import { getAddress, execute } from './wallet.js';
import { getLivePosture } from './posture.js';
import {
  buildCreateBalanceManager, buildDepositSui, buildPlaceLimitOrder, buildCancelAll,
  readMid, readBmSui, readBmDeep, readOpenOrderCount, loadBM, saveBM, POOL_NAME, MIN_DEEP,
} from './deepbook.js';

// Last-good mid: the DEEP/SUI book is thin, so `pool::mid_price` transiently
// reverts to null whenever one side momentarily empties. Persist the last real
// mid and quote around it rather than skipping the whole cycle (which would also
// drop our resting bid and leave the book dead until someone else repopulates it).
const MID_FILE = 'logs/mm-mid.json';
const MID_STALE_MS = 60 * 60 * 1000;   // ignore a reference older than 1h
const loadLastMid = (): number | null => {
  try { const { mid, ts } = JSON.parse(fs.readFileSync(MID_FILE, 'utf-8')); return Date.now() - ts < MID_STALE_MS ? mid : null; } catch { return null; }
};
const saveLastMid = (mid: number) => { try { fs.mkdirSync('logs', { recursive: true }); fs.writeFileSync(MID_FILE, JSON.stringify({ mid, ts: Date.now() })); } catch {} };

// Per-posture quoting policy (notional must clear the pool's 10-DEEP min order).
const NOTIONAL_SUI: Record<string, number> = { GREEN: 0.40, AMBER: 0.30, RED: 0 }; // SUI per side
const SPREAD: Record<string, number>       = { GREEN: 0.01, AMBER: 0.03, RED: 0 }; // total spread fraction

function bmOrThrow(): string {
  const bm = loadBM();
  if (!bm) throw new Error('No BalanceManager — run: npx tsx src/deepbook-mm.ts setup');
  return bm;
}

async function setup(amountSui: number) {
  const op = getAddress();
  let bm = loadBM();
  if (!bm) {
    console.log('Creating BalanceManager…');
    const r = await execute(buildCreateBalanceManager(), 60_000_000);
    const created = r.objectChanges?.find((c: any) => c.type === 'created' && String(c.objectType).includes('balance_manager::BalanceManager')) as any;
    bm = created?.objectId;
    if (!bm) throw new Error('could not find created BalanceManager');
    saveBM(bm);
    console.log(`  ✓ BalanceManager ${bm}`);
  } else {
    console.log(`Using existing BalanceManager ${bm}`);
  }
  console.log(`Depositing ${amountSui} SUI…`);
  const d = await execute(buildDepositSui(bm, amountSui), 60_000_000);
  console.log(`  ✓ ${d.digest}`);
  await status();
}

async function quote() {
  const op = getAddress();
  const bm = bmOrThrow();
  const [posture, midNow] = await Promise.all([getLivePosture(), readMid(op)]);
  // Quote around the live mid, or fall back to the last-good mid when the thin
  // book momentarily has no mid — so the maker keeps both sides resting instead
  // of going dark on a transient one-sided book.
  const mid = midNow ?? loadLastMid();
  if (mid === null) { console.log(`\n${POOL_NAME}: no mid and no recent reference — book empty both sides, skipping cycle.`); return; }
  if (midNow !== null) saveLastMid(midNow);

  // Cancel stale quotes BEFORE reading balances — funds locked in resting
  // orders return to the manager on cancel, and quoting off the pre-cancel
  // balance makes the maker skip its own re-quote.
  await execute(buildCancelAll(bm), 30_000_000);
  const [sui, deep] = await Promise.all([readBmSui(bm, op), readBmDeep(bm, op)]);
  console.log(`\n${POOL_NAME} mid ${mid.toFixed(8)}${midNow === null ? ' (stale ref)' : ''} SUI/DEEP | posture ${posture.state} | inv: ${sui.toFixed(3)} SUI, ${deep.toFixed(3)} DEEP`);

  if (posture.state === 'RED') { console.log('🔴 RED — cancelled all, sitting flat.'); return; }

  const notional = NOTIONAL_SUI[posture.state];
  const spread = SPREAD[posture.state];
  // Inventory skew: if we already hold DEEP, shade quotes down to mean-revert.
  const deepValSui = deep * mid;
  const skew = Math.max(-0.5, Math.min(0.5, (deepValSui - notional) / (notional * 4))); // ∈ [-0.5,0.5] of half-spread
  const bidPrice = mid * (1 - spread / 2 - skew * spread / 2);
  const askPrice = mid * (1 + spread / 2 - skew * spread / 2);

  const oid = Date.now() % 1_000_000_000;
  // Bid: buy DEEP, locks SUI. Quantity must clear the 10-DEEP pool minimum.
  const bidQty = Math.max(MIN_DEEP, Math.round(notional / bidPrice));
  const lock = bidQty * bidPrice;
  if (sui >= lock) {
    await execute(buildPlaceLimitOrder(bm, true, bidPrice, bidQty, oid), 40_000_000);
    console.log(`  🟢 BID ${bidQty} DEEP @ ${bidPrice.toFixed(8)} (locks ${lock.toFixed(3)} SUI)`);
  } else {
    console.log(`  ⏭  skip bid — need ${lock.toFixed(3)} SUI, manager has ${sui.toFixed(3)}`);
  }
  // Ask: sell DEEP, but always retain a one-order DEEP floor so a single fill
  // never zeroes inventory and forces the maker one-sided (the failure that left
  // the book dead before — ask filled → 0 DEEP → bids only → no mid).
  if (deep >= 2 * MIN_DEEP) {
    const askQty = Math.min(deep - MIN_DEEP, Math.max(MIN_DEEP, Math.round(notional / askPrice)));
    await execute(buildPlaceLimitOrder(bm, false, askPrice, askQty, oid + 1), 40_000_000);
    console.log(`  🟠 ASK ${askQty} DEEP @ ${askPrice.toFixed(8)} (keeps ${MIN_DEEP} DEEP floor)`);
  } else {
    console.log(`  ⏭  no ask — ${deep.toFixed(2)} DEEP inventory (< ${2 * MIN_DEEP} floor; bids must fill first)`);
  }
}

async function status() {
  const op = getAddress();
  const bm = loadBM();
  const [posture, mid] = await Promise.all([getLivePosture().catch(() => null), readMid(op)]);
  console.log('\n━━━ DeepBook CLOB maker ━━━');
  console.log(`Pool        : ${POOL_NAME} (whitelisted, zero fees)`);
  console.log(`Mid price   : ${mid?.toFixed(8) ?? '—'} SUI/DEEP`);
  console.log(`Posture     : ${posture?.state ?? '—'}`);
  if (!bm) { console.log('BalanceManager: none (run setup)'); return; }
  const [sui, deep, orders] = await Promise.all([readBmSui(bm, op), readBmDeep(bm, op), readOpenOrderCount(bm, op)]);
  console.log(`BalanceMgr  : ${bm}`);
  console.log(`  inventory : ${sui.toFixed(4)} SUI · ${deep.toFixed(4)} DEEP`);
  console.log(`  open orders: ${orders}`);
}

const cmd = process.argv[2] ?? 'status';
const arg = Number(process.argv[3]);
const fn = cmd === 'setup' ? () => setup(isNaN(arg) ? 1 : arg) : cmd === 'quote' ? quote : status;
fn().catch(e => { console.error(String(e)); process.exit(1); });
