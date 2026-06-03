/**
 * Vault cycle — one full allocation cycle end to end.
 *
 * Modes:
 *   SIM  (default) — model decides, PTBs devInspected but NOT submitted
 *   LIVE           — set LIVE_MODE=true in .env to execute on testnet
 *
 * Run once:      npm run cycle
 * Run on a loop: set up a cron or use: watch -n 60 npm run cycle
 */

import 'dotenv/config';
import type { CoinStruct } from '@mysten/sui/client';
import {
  getNearestActiveOracle, getPriceHistory, getLatestPrice, getManagerSummary,
  getManagerPositions, ManagerPosition,
} from './indexer.js';
import { computeFeatures } from './features.js';
import { decide, ping, AllocationDecision, CycleContext } from './model.js';

import { predict as mlPredict, formatPrediction } from './ml-model.js';
import {
  buildDepositAndMint, buildDepositAndMintRange, buildSupply,
  buildMint, buildGetTradeAmounts, buildSupplyFromManager, buildWithdrawLiquidity,
} from './transactions.js';
import { getDusdcCoins, getPlpCoins, formatBalance } from './coins.js';
import { execute, inspect, getAddress } from './wallet.js';
import { MLPrediction } from './ml-model.js';
import {
  MANAGER_ID, DUSDC_SCALE, MAX_PLP_DUSDC,
  HIGH_VOL_THRESHOLD, EXTREME_VOL_THRESHOLD,
  LP_TARGET_PCT, LP_REBALANCE_BAND,
  humanToDusdc, PREDICT_PACKAGE,
} from './config.js';
import * as fs from 'fs';

const LIVE_MODE    = process.env.LIVE_MODE === 'true';
const LOG_PATH     = 'logs/cycles.jsonl';
const HISTORY_FILE = 'logs/cycle-history.json';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CycleLog {
  ts:         string;
  oracle_id:  string;
  expiry:     string;
  spot_usd:   number;
  features:   Record<string, unknown>;
  decision:   AllocationDecision;
  executed:   boolean;
  tx_digests: string[];
  sim_only:   boolean;
  error?:     string;
  lp?: {
    factor:  number;
    target:  number;
    current: number;
    delta:   number;
    action:  string;
  };
}

// ── History ───────────────────────────────────────────────────────────────────

function appendLog(entry: CycleLog) {
  fs.mkdirSync('logs', { recursive: true });
  fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n');
}

function loadHistory(): string {
  try {
    const entries = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8')) as CycleLog[];
    return entries.slice(-5).map(e =>
      `[${e.ts.slice(0, 16)}] spot=$${e.spot_usd} → ` +
      (e.decision.skip ? `SKIP: ${e.decision.skip_reason}` : e.decision.reasoning)
    ).join('\n');
  } catch { return ''; }
}

function saveHistory(entry: CycleLog) {
  let entries: CycleLog[] = [];
  try { entries = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8')); } catch {}
  entries.push(entry);
  if (entries.length > 20) entries = entries.slice(-20);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(entries, null, 2));
}

// ── Execution ─────────────────────────────────────────────────────────────────

/**
 * LP exposure factor in [0,1] — how much of the LP target to actually hold.
 *
 * LP's only real risk is a large directional move (the vault is the house, so it
 * loses when traders win big). So we gate exposure on directional risk:
 *   - calm vol            → full exposure
 *   - elevated vol        → reduced
 *   - extreme vol         → full pullback (exit liquidity from harm's way)
 * and we further trim when the ML model is highly convicted on a direction
 * (a strong predicted move = higher directional risk to the house).
 */
export function computeLpExposureFactor(vol: number, ml: MLPrediction): number {
  let base: number;
  if (vol >= EXTREME_VOL_THRESHOLD)   base = 0.0;   // extreme — pull out entirely
  else if (vol >= HIGH_VOL_THRESHOLD) base = 0.6;   // elevated — partial
  else                                base = 1.0;   // calm — full

  // ML conviction: |prob-0.5|×2 ∈ [0,1]; strong conviction trims up to 30%.
  const conviction = Math.min(1, Math.abs(ml.prob_up - 0.5) * 2);
  const mlAdjust   = 1 - 0.3 * conviction;
  return base * mlAdjust;
}

/** Preview the exact mint cost of a binary position via devInspect (free, no gas). */
async function previewMintCost(
  oracleId: string,
  expiry:   bigint,
  strike:   bigint,
  isUp:     boolean,
  quantity: bigint,
): Promise<bigint | null> {
  try {
    const previewTx = buildGetTradeAmounts(oracleId, expiry, strike, isUp, quantity);
    const preview   = await inspect(previewTx) as any;
    const tradeVals = preview?.results?.[1]?.returnValues ?? [];
    if (tradeVals.length >= 1) {
      return Buffer.from(tradeVals[0][0]).readBigUInt64LE(0);
    }
  } catch (err) {
    console.log(`  [warn] cost preview failed: ${String(err).slice(0, 80)}`);
  }
  return null;
}

async function executeDecision(
  decision:     AllocationDecision,
  oracleId:     string,
  expiry:       bigint,
  managerBalRaw: bigint,
): Promise<string[]> {
  const digests: string[] = [];
  const address = getAddress();
  const { coins, totalRaw } = await getDusdcCoins(address);

  // Mutable ledgers tracked across multiple actions in one cycle.
  let availMgr    = managerBalRaw;  // Manager balance usable to fund mints
  let availWallet = totalRaw;       // wallet dUSDC usable for PLP supply + deposit shortfalls

  // ── Supply PLP (sourced from wallet) ──────────────────────────────────────────
  if (decision.supply_usdc >= 1.0) {
    const wantRaw   = humanToDusdc(decision.supply_usdc);
    const supplyRaw = wantRaw <= availWallet ? wantRaw : availWallet;
    if (supplyRaw < humanToDusdc(1)) {
      console.log(`  ⏭  skip PLP supply — wallet has ${(Number(availWallet) / Number(DUSDC_SCALE)).toFixed(4)} dUSDC, can't fund (needs wallet liquidity)`);
    } else {
      if (supplyRaw < wantRaw) {
        console.log(`  ⚠  capping PLP supply ${decision.supply_usdc} → ${(Number(supplyRaw) / Number(DUSDC_SCALE)).toFixed(4)} dUSDC (wallet-limited)`);
      }
      console.log(`  supply ${(Number(supplyRaw) / Number(DUSDC_SCALE)).toFixed(4)} dUSDC → PLP`);
      const tx = buildSupply(coins, supplyRaw, address);
      if (LIVE_MODE) {
        const r = await execute(tx);
        digests.push(r.digest);
        availWallet -= supplyRaw;
        console.log(`  ✓ supply ${r.digest}`);
      } else {
        await inspect(tx);
        console.log(`  [sim] supply PTB valid`);
      }
    }
  }

  // ── Mint positions ──────────────────────────────────────────────────────────
  for (const pos of decision.positions) {
    const qty = humanToDusdc(pos.quantity_usdc);

    // ── Binary (up/down): fund from Manager balance, deposit only the shortfall ──
    if (pos.type === 'up' || pos.type === 'down') {
      const strike = BigInt(Math.round(pos.strike!)) * 1_000_000_000n;
      const isUp   = pos.type === 'up';

      // Real cost from the protocol; fall back to full qty (max possible cost) if preview fails.
      const cost     = await previewMintCost(oracleId, expiry, strike, isUp, qty) ?? qty;
      const shortfall = cost > availMgr ? cost - availMgr : 0n;
      const costH     = (Number(cost) / Number(DUSDC_SCALE)).toFixed(4);

      if (shortfall > availWallet) {
        console.log(`  ⏭  skip mint ${pos.type.toUpperCase()} — cost ${costH}, manager ${(Number(availMgr) / Number(DUSDC_SCALE)).toFixed(4)} + wallet ${(Number(availWallet) / Number(DUSDC_SCALE)).toFixed(4)} insufficient`);
        continue;
      }

      let tx;
      if (shortfall === 0n) {
        console.log(`  mint ${pos.type.toUpperCase()} strike=$${pos.strike} qty=${pos.quantity_usdc} (cost ${costH}, from manager)`);
        tx = buildMint(MANAGER_ID, oracleId, expiry, strike, isUp, qty);
      } else {
        console.log(`  mint ${pos.type.toUpperCase()} strike=$${pos.strike} qty=${pos.quantity_usdc} (cost ${costH}, deposit ${(Number(shortfall) / Number(DUSDC_SCALE)).toFixed(4)} from wallet)`);
        tx = buildDepositAndMint(MANAGER_ID, coins, shortfall, oracleId, expiry, strike, isUp, qty);
      }

      if (LIVE_MODE) {
        const r = await execute(tx);
        digests.push(r.digest);
        availWallet -= shortfall;
        availMgr     = availMgr + shortfall - cost;  // → max(0, availMgr - cost)
        console.log(`  ✓ mint ${r.digest}`);
      } else {
        await inspect(tx);
        console.log(`  [sim] mint PTB valid`);
      }
    }

    // ── Range: keep deposit-full-qty path (rarely used; conservative + unchanged) ─
    if (pos.type === 'range') {
      const lower  = BigInt(Math.round(pos.lower_strike!))  * 1_000_000_000n;
      const higher = BigInt(Math.round(pos.higher_strike!)) * 1_000_000_000n;
      const depositRaw = qty > availWallet ? availWallet : qty;
      if (depositRaw < qty) {
        console.log(`  ⏭  skip RANGE — wallet ${(Number(availWallet) / Number(DUSDC_SCALE)).toFixed(4)} < qty ${pos.quantity_usdc}`);
        continue;
      }
      console.log(`  mint RANGE $${pos.lower_strike}–$${pos.higher_strike} qty=${pos.quantity_usdc} dUSDC`);
      const tx = buildDepositAndMintRange(
        MANAGER_ID, coins, depositRaw, oracleId, expiry, lower, higher, qty,
      );
      if (LIVE_MODE) {
        const r = await execute(tx);
        digests.push(r.digest);
        availWallet -= depositRaw;
        console.log(`  ✓ mint_range ${r.digest}`);
      } else {
        await inspect(tx);
        console.log(`  [sim] mint_range PTB valid`);
      }
    }
  }

  return digests;
}

/**
 * Rebalance the LP position toward target.
 *  - extreme vol → withdraw all PLP (full pullback)
 *  - under target by > band → supply the gap from the Manager balance
 *  - otherwise → hold (no churn)
 */
async function rebalanceLP(
  lpDelta:       number,        // human dUSDC: + supply more, - over target
  vol:           number,
  currentPlp:    number,
  managerBalRaw: bigint,
  plpCoins:      CoinStruct[],
): Promise<{ digests: string[]; action: string }> {
  const digests: string[] = [];
  const address = getAddress();

  // Full pullback in extreme vol — exit liquidity from harm's way.
  if (vol >= EXTREME_VOL_THRESHOLD && currentPlp > LP_REBALANCE_BAND) {
    console.log(`  [LP] extreme vol ${vol.toFixed(1)}% — pulling all liquidity (${currentPlp.toFixed(1)} dUSDC PLP)`);
    for (const c of plpCoins) {
      const tx = buildWithdrawLiquidity(c.coinObjectId, address);
      if (LIVE_MODE) { const r = await execute(tx); digests.push(r.digest); console.log(`  ✓ withdraw ${r.digest}`); }
      else           { await inspect(tx);            console.log(`  [sim] withdraw PTB valid`); }
    }
    return { digests, action: 'pullback' };
  }

  // Supply toward target, funded directly from the Manager balance.
  if (lpDelta > LP_REBALANCE_BAND) {
    const wantRaw   = humanToDusdc(lpDelta);
    const supplyRaw = wantRaw <= managerBalRaw ? wantRaw : managerBalRaw;
    if (supplyRaw < humanToDusdc(1)) {
      console.log(`  [LP] manager balance too low to supply (${(Number(managerBalRaw) / Number(DUSDC_SCALE)).toFixed(2)} dUSDC)`);
      return { digests, action: 'none' };
    }
    if (supplyRaw < wantRaw) {
      console.log(`  [LP] capping supply ${lpDelta.toFixed(1)} → ${(Number(supplyRaw) / Number(DUSDC_SCALE)).toFixed(1)} dUSDC (manager-limited)`);
    }
    console.log(`  [LP] supplying ${(Number(supplyRaw) / Number(DUSDC_SCALE)).toFixed(1)} dUSDC → PLP (from manager)`);
    const tx = buildSupplyFromManager(MANAGER_ID, supplyRaw, address);
    if (LIVE_MODE) { const r = await execute(tx); digests.push(r.digest); console.log(`  ✓ supply ${r.digest}`); }
    else           { await inspect(tx);            console.log(`  [sim] supply-from-manager PTB valid`); }
    return { digests, action: 'supply' };
  }

  console.log(`  [LP] within band — holding`);
  return { digests, action: 'hold' };
}

// ── Main cycle ────────────────────────────────────────────────────────────────

export async function runCycle(): Promise<void> {
  const ts = new Date().toISOString();
  console.log(`\n━━━ FairLine Cycle — ${ts} ━━━`);
  console.log(`Mode: ${LIVE_MODE ? 'LIVE 🔴' : 'SIM 🟡'}`);

  if (!MANAGER_ID) throw new Error('MANAGER_ID not set — run npm run setup first');

  // 1. Check Ollama
  const ollamaOk = await ping();
  if (!ollamaOk) throw new Error('hermes3 not reachable — is Ollama running?');
  console.log('hermes3 ✓');

  // 2. Market + wallet state
  const [oracle, address] = [await getNearestActiveOracle(), getAddress()];
  if (!oracle) throw new Error('No active oracle found');

  const minsLeft = (oracle.expiry - Date.now()) / 60_000;
  console.log(`Oracle: ${oracle.oracle_id.slice(0, 12)}… expiry in ${minsLeft.toFixed(1)} min`);

  // The LP engine rebalances every tick regardless. This flag only gates the
  // directional sleeve: at most one directional position per oracle.
  const existingPositions = await getManagerPositions(MANAGER_ID);
  const alreadyEntered = existingPositions.minted.some(p => p.oracle_id === oracle.oracle_id);
  if (alreadyEntered) {
    console.log(`Note: directional position already open in this oracle — sleeve will hold.`);
  }

  const [prices, latest, summary, dusdcBal, plpCoins] = await Promise.all([
    getPriceHistory(oracle.oracle_id),
    getLatestPrice(oracle.oracle_id),
    getManagerSummary(MANAGER_ID),
    getDusdcCoins(address),
    getPlpCoins(address),
  ]);

  const features    = computeFeatures(oracle, prices, latest);
  const managerBal  = (summary.balances.find(b => b.quote_asset.includes('dusdc'))?.balance ?? 0);
  const walletBal   = Number(dusdcBal.totalRaw);
  // Total available = manager balance + wallet dUSDC (model works on combined)
  const totalH      = (managerBal + walletBal) / Number(DUSDC_SCALE);
  const pnlH        = summary.realized_pnl / Number(DUSDC_SCALE);
  const currentPlp  = plpCoins.reduce((s, c) => s + Number(c.balance), 0) / Number(DUSDC_SCALE);

  console.log(`Spot: $${features.spot_usd.toFixed(2)}  Vol: ${features.realized_vol_pct.toFixed(2)}%  Trend: ${features.price_trend}`);
  console.log(`Wallet dUSDC : ${formatBalance(dusdcBal)}`);
  console.log(`Manager bal  : ${(managerBal / Number(DUSDC_SCALE)).toFixed(6)} dUSDC`);
  console.log(`PLP locked   : ${currentPlp.toFixed(4)} / ${MAX_PLP_DUSDC} dUSDC max`);
  console.log(`Total avail  : ${totalH.toFixed(6)} dUSDC  |  PnL: ${pnlH >= 0 ? '+' : ''}${pnlH.toFixed(6)}`);

  // 3. Model decision
  const ctx: CycleContext = {
    features,
    balance_usdc:     totalH,
    realized_pnl:     pnlH,
    recent_history:   loadHistory(),
    current_plp_usdc: currentPlp,
    max_plp_usdc:     MAX_PLP_DUSDC,
  };

  // Run trained ML model for directional signal
  const mlPrediction = mlPredict(features);
  console.log(`ML model: ${formatPrediction(mlPrediction)}`);

  const vol = features.realized_vol_pct;
  const managerBalRaw = BigInt(Math.max(0, Math.floor(managerBal)));

  let digests: string[] = [];
  let execError: string | undefined;

  // ── PRIMARY: ML/vol-gated liquidity provision ──────────────────────────────
  const lpFactor = computeLpExposureFactor(vol, mlPrediction);
  const lpTarget = Math.min(totalH * LP_TARGET_PCT * lpFactor, MAX_PLP_DUSDC);
  const lpDelta  = lpTarget - currentPlp;
  console.log(`\n[LP engine] exposure factor ${lpFactor.toFixed(2)} → target ${lpTarget.toFixed(1)} dUSDC | current ${currentPlp.toFixed(1)} | delta ${lpDelta >= 0 ? '+' : ''}${lpDelta.toFixed(1)}`);

  let lpAction = 'hold';
  try {
    const lp = await rebalanceLP(lpDelta, vol, currentPlp, managerBalRaw, plpCoins);
    digests.push(...lp.digests);
    lpAction = lp.action;
  } catch (err) {
    execError = String(err);
    console.error('  [LP] error:', execError);
  }

  // ── SECONDARY: small, capped, experimental directional sleeve ──────────────
  // Only when the market is calm AND the ML model is highly convicted. Bets are
  // hard-capped (MAX_POSITION_USDC / MAX_CYCLE_USDC) — this is research, not the
  // income engine. In any other regime the sleeve sits idle.
  let decision: AllocationDecision = {
    reasoning:   `directional sleeve idle (vol ${vol.toFixed(1)}%, ML ${mlPrediction.confidence})`,
    supply_usdc: 0, positions: [], confidence: 'low', skip: true,
    skip_reason: 'sleeve idle',
  };

  if (vol < HIGH_VOL_THRESHOLD && mlPrediction.confidence === 'high' && !alreadyEntered) {
    ctx.ml_prediction = mlPrediction;
    console.log('\n[sleeve] calm + high-confidence ML — consulting hermes3 (capped)…');
    decision = await decide(ctx);
    decision.supply_usdc = 0;  // LP is handled by the engine above; sleeve is directional only
  } else {
    const why = alreadyEntered ? 'position already open this oracle'
      : vol >= HIGH_VOL_THRESHOLD ? `vol ${vol.toFixed(1)}% not calm`
      : `ML confidence ${mlPrediction.confidence}`;
    console.log(`\n[sleeve] idle — ${why}`);
  }

  if (!decision.skip && decision.positions.length > 0) {
    console.log(`  ${decision.reasoning}`);
    if (!LIVE_MODE && dusdcBal.coins.length === 0) {
      console.log('  [sim] No dUSDC coins — skipping devInspect');
    } else {
      try {
        const sleeveDigests = await executeDecision(
          decision, oracle.oracle_id, BigInt(oracle.expiry), managerBalRaw,
        );
        digests.push(...sleeveDigests);
      } catch (err) {
        execError = (execError ? execError + ' | ' : '') + String(err);
        console.error('  [sleeve] error:', String(err));
      }
    }
  }

  // 5. Log
  const entry: CycleLog = {
    ts, oracle_id: oracle.oracle_id,
    expiry: new Date(oracle.expiry).toISOString(),
    spot_usd: features.spot_usd,
    features: features as unknown as Record<string, unknown>,
    decision, executed: digests.length > 0,
    tx_digests: digests, sim_only: !LIVE_MODE, error: execError,
    lp: { factor: lpFactor, target: lpTarget, current: currentPlp, delta: lpDelta, action: lpAction },
  };
  appendLog(entry);
  saveHistory(entry);

  console.log(`\nLogged → ${LOG_PATH}`);
  console.log('━━━ done ━━━\n');
}

// CLI — only run when invoked directly (not when imported as a module by watcher.ts)
const isMain = process.argv[1] && (
  process.argv[1].endsWith('cycle.ts') ||
  process.argv[1].endsWith('cycle.js') ||
  // tsx passes the real file path even through the loader
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!)
);
if (isMain) {
  runCycle().catch(err => { console.error(err); process.exit(1); });
}
