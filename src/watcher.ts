/**
 * FairLine autonomous watcher — runs continuously, polling every 60 seconds.
 *
 * Logic each tick:
 *   1. Check if any open positions have settled → auto-redeem them
 *   2. Check if we already have a position in the nearest active oracle → idle if yes
 *   3. Otherwise run a full allocation cycle
 *
 * Run via pm2: npm run watcher
 * Or directly: npx tsx src/watcher.ts
 */

import 'dotenv/config';
import { runCycle } from './cycle.js';
import { getSettledOracles, getManagerPositions, getManagerSummary } from './indexer.js';
import { buildRedeemPermissionless } from './transactions.js';
import { execute, getAddress } from './wallet.js';
import { MANAGER_ID, DUSDC_SCALE } from './config.js';
import * as child_process from 'child_process';
import * as fs from 'fs';

const POLL_INTERVAL_MS   = 60_000;  // 1 minute
const RETRAIN_EVERY_N    = 50;      // retrain after this many new settled oracles
const RETRAIN_STATE_FILE = 'logs/retrain-state.json';

// ── Retrain trigger ───────────────────────────────────────────────────────────

function loadRetrainState(): { last_count: number; last_retrain: string } {
  try { return JSON.parse(fs.readFileSync(RETRAIN_STATE_FILE, 'utf-8')); }
  catch { return { last_count: 0, last_retrain: 'never' }; }
}

function saveRetrainState(state: { last_count: number; last_retrain: string }) {
  fs.writeFileSync(RETRAIN_STATE_FILE, JSON.stringify(state, null, 2));
}

async function maybeRetrain(settledCount: number) {
  const state = loadRetrainState();
  const newSince = settledCount - state.last_count;
  if (newSince < RETRAIN_EVERY_N) return;

  console.log(`\n[retrain] ${newSince} new oracles since last retrain — retraining…`);
  const proc = child_process.spawnSync('python3', ['scripts/retrain.py'], {
    cwd: process.cwd(), encoding: 'utf-8',
  });
  if (proc.status === 0) {
    console.log('[retrain] ✅ complete — weights reloaded on next cycle');
    saveRetrainState({ last_count: settledCount, last_retrain: new Date().toISOString() });
  } else {
    console.error('[retrain] ❌ failed:', proc.stderr?.slice(0, 200));
  }
}

// ── Auto-redeem settled positions ─────────────────────────────────────────────

async function autoRedeem(): Promise<number> {
  const { minted } = await getManagerPositions(MANAGER_ID);
  if (minted.length === 0) return 0;

  const settled    = await getSettledOracles();
  const settledIds = new Set(settled.map(o => o.oracle_id));

  let redeemed = 0;
  for (const pos of minted) {
    if (!settledIds.has(pos.oracle_id)) continue;
    try {
      console.log(`  [redeem] oracle ${pos.oracle_id.slice(0, 12)}… qty=${pos.quantity}`);
      const tx     = buildRedeemPermissionless(
        MANAGER_ID, pos.oracle_id, BigInt(pos.expiry),
        BigInt(pos.strike), pos.is_up, BigInt(pos.quantity),
      );
      const result = await execute(tx);
      console.log(`  [redeem] ✓ ${result.digest}`);
      redeemed++;
    } catch (e) {
      console.error(`  [redeem] ❌ ${String(e).slice(0, 100)}`);
    }
  }
  return redeemed;
}

// ── Main tick ─────────────────────────────────────────────────────────────────

async function tick() {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`\n[${ts}] FairLine watcher tick`);

  try {
    // 1. Auto-redeem any settled positions first
    const redeemed = await autoRedeem();
    if (redeemed > 0) {
      const summary = await getManagerSummary(MANAGER_ID);
      const bal     = (summary.balances.find(b => b.quote_asset.includes('dusdc'))?.balance ?? 0) / Number(DUSDC_SCALE);
      const pnl     = summary.realized_pnl / Number(DUSDC_SCALE);
      console.log(`  Balance: ${bal.toFixed(4)} dUSDC  |  Realized P&L: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} dUSDC`);
    }

    // 2. Check if retrain is due
    const settled = await getSettledOracles();
    await maybeRetrain(settled.length);

    // 3. Run allocation cycle (has built-in "already entered" guard)
    await runCycle();

  } catch (e) {
    console.error(`[watcher] tick error: ${String(e).slice(0, 200)}`);
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

console.log(`FairLine watcher starting — polling every ${POLL_INTERVAL_MS / 1000}s`);
console.log(`Mode: ${process.env.LIVE_MODE === 'true' ? 'LIVE 🔴' : 'SIM 🟡'}`);
console.log(`Manager: ${MANAGER_ID}\n`);

tick(); // run immediately on start
setInterval(tick, POLL_INTERVAL_MS);
