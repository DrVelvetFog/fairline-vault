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
import { buildRedeemPermissionless, buildWithdrawLiquidity } from './transactions.js';
import { execute, getAddress } from './wallet.js';
import { getDusdcCoins, getPlpCoins } from './coins.js';
import { MANAGER_ID, DUSDC_SCALE } from './config.js';
import * as child_process from 'child_process';
import * as fs from 'fs';

const POLL_INTERVAL_MS      = 60_000;  // 1 minute
const RETRAIN_EVERY_N       = 20;      // retrain after this many new settled oracles (~5 hrs)
const RETRAIN_MIN_HOURS     = 4;       // but never retrain more often than every 4 hours
const RETRAIN_STATE_FILE    = 'logs/retrain-state.json';
const MIN_WALLET_DUSDC      = 1_000;   // pull PLP back if wallet dUSDC drops below this

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

  // Enforce minimum gap between retrains
  if (state.last_retrain !== 'never') {
    const hoursSinceLast = (Date.now() - new Date(state.last_retrain).getTime()) / 3_600_000;
    if (hoursSinceLast < RETRAIN_MIN_HOURS) {
      console.log(`[retrain] skipping — last retrain ${hoursSinceLast.toFixed(1)}h ago (min ${RETRAIN_MIN_HOURS}h)`);
      return;
    }
  }

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
  const { minted, redeemed: redeemedPositions } = await getManagerPositions(MANAGER_ID);
  if (minted.length === 0) return 0;

  // Skip positions already redeemed (stale indexer entries)
  const redeemedIds = new Set(redeemedPositions.map((p: any) => p.oracle_id));
  const settled     = await getSettledOracles();
  const settledIds  = new Set(settled.map(o => o.oracle_id));

  let redeemed = 0;
  for (const pos of minted) {
    // Hard reality gate: a position cannot be settled before its expiry passes.
    // The indexer's settled-status flag is unreliable near the rollover, so we
    // require the on-chain expiry timestamp to have actually elapsed.
    if (pos.expiry >= Date.now()) continue;       // not yet expired
    if (!settledIds.has(pos.oracle_id)) continue; // indexer hasn't marked settled
    if (redeemedIds.has(pos.oracle_id)) continue;  // already claimed
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

// ── Auto-withdraw PLP when wallet dUSDC is low ────────────────────────────────

async function autoPLPWithdraw(): Promise<void> {
  const address = getAddress();

  // Check wallet dUSDC — if we have plenty, nothing to do
  const dusdcBal = await getDusdcCoins(address);
  if (dusdcBal.totalHuman >= MIN_WALLET_DUSDC) return;

  // Check for PLP coins
  const plpCoins = await getPlpCoins(address);
  if (plpCoins.length === 0) return;

  const totalPlp = plpCoins.reduce((s, c) => s + Number(c.balance), 0) / 1e6;
  console.log(`  [plp-withdraw] Wallet dUSDC low (${dusdcBal.totalHuman.toFixed(2)}) — withdrawing ${totalPlp.toFixed(4)} PLP → dUSDC`);

  let withdrawn = 0;
  for (const plp of plpCoins) {
    try {
      const tx     = buildWithdrawLiquidity(plp.coinObjectId, address);
      const result = await execute(tx);
      const plpAmt = (Number(plp.balance) / 1e6).toFixed(4);
      console.log(`  [plp-withdraw] ✓ ${plpAmt} PLP redeemed → ${result.digest}`);
      withdrawn++;
    } catch (e) {
      console.error(`  [plp-withdraw] ❌ ${String(e).slice(0, 120)}`);
    }
  }

  if (withdrawn > 0) {
    const newBal = await getDusdcCoins(address);
    console.log(`  [plp-withdraw] Wallet dUSDC now: ${newBal.totalHuman.toFixed(4)}`);
  }
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

    // 2. Pull PLP back to dUSDC if wallet balance is running low
    await autoPLPWithdraw();

    // 3. Check if retrain is due
    const settled = await getSettledOracles();
    await maybeRetrain(settled.length);

    // 4. Run allocation cycle (has built-in "already entered" guard)
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
