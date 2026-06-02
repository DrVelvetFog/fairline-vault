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
import {
  getNearestActiveOracle, getPriceHistory, getLatestPrice, getManagerSummary,
  getManagerPositions, ManagerPosition,
} from './indexer.js';
import { computeFeatures } from './features.js';
import { decide, ping, AllocationDecision, CycleContext } from './model.js';
import { predict as mlPredict, formatPrediction } from './ml-model.js';
import {
  buildDepositAndMint, buildDepositAndMintRange, buildSupply,
} from './transactions.js';
import { getDusdcCoins, formatBalance } from './coins.js';
import { execute, inspect, getAddress } from './wallet.js';
import { MANAGER_ID, DUSDC_SCALE, humanToDusdc, PREDICT_PACKAGE } from './config.js';
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

async function executeDecision(
  decision:  AllocationDecision,
  oracleId:  string,
  expiry:    bigint,
): Promise<string[]> {
  const digests: string[] = [];
  const address = getAddress();
  const { coins } = await getDusdcCoins(address);

  // ── Supply PLP ──────────────────────────────────────────────────────────────
  if (decision.supply_usdc >= 1.0) {
    const supplyRaw = humanToDusdc(decision.supply_usdc);
    console.log(`  supply ${decision.supply_usdc} dUSDC → PLP`);
    const tx = buildSupply(coins, supplyRaw, address);
    if (LIVE_MODE) {
      const r = await execute(tx);
      digests.push(r.digest);
      console.log(`  ✓ supply ${r.digest}`);
    } else {
      await inspect(tx);
      console.log(`  [sim] supply PTB valid`);
    }
  }

  // ── Mint positions ──────────────────────────────────────────────────────────
  for (const pos of decision.positions) {
    const qty        = humanToDusdc(pos.quantity_usdc);
    // Deposit = full quantity as max-possible cost (any leftover stays in manager)
    const depositRaw = qty;

    if (pos.type === 'up' || pos.type === 'down') {
      const strike = BigInt(Math.round(pos.strike!)) * 1_000_000_000n;
      console.log(`  mint ${pos.type.toUpperCase()} strike=$${pos.strike} qty=${pos.quantity_usdc} dUSDC`);
      const tx = buildDepositAndMint(
        MANAGER_ID, coins, depositRaw, oracleId, expiry, strike, pos.type === 'up', qty,
      );
      if (LIVE_MODE) {
        const r = await execute(tx);
        digests.push(r.digest);
        console.log(`  ✓ mint ${r.digest}`);
      } else {
        await inspect(tx);
        console.log(`  [sim] mint PTB valid`);
      }
    }

    if (pos.type === 'range') {
      const lower  = BigInt(Math.round(pos.lower_strike!))  * 1_000_000_000n;
      const higher = BigInt(Math.round(pos.higher_strike!)) * 1_000_000_000n;
      console.log(`  mint RANGE $${pos.lower_strike}–$${pos.higher_strike} qty=${pos.quantity_usdc} dUSDC`);
      const tx = buildDepositAndMintRange(
        MANAGER_ID, coins, depositRaw, oracleId, expiry, lower, higher, qty,
      );
      if (LIVE_MODE) {
        const r = await execute(tx);
        digests.push(r.digest);
        console.log(`  ✓ mint_range ${r.digest}`);
      } else {
        await inspect(tx);
        console.log(`  [sim] mint_range PTB valid`);
      }
    }
  }

  return digests;
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

  // Guard: skip if we already have an open position in this oracle
  const existingPositions = await getManagerPositions(MANAGER_ID);
  const alreadyEntered = existingPositions.minted.some(p => p.oracle_id === oracle.oracle_id);
  if (alreadyEntered) {
    console.log(`Already entered oracle ${oracle.oracle_id.slice(0, 12)}… — waiting for settlement.`);
    console.log('━━━ done (idle) ━━━\n');
    return;
  }

  const [prices, latest, summary, dusdcBal] = await Promise.all([
    getPriceHistory(oracle.oracle_id),
    getLatestPrice(oracle.oracle_id),
    getManagerSummary(MANAGER_ID),
    getDusdcCoins(address),
  ]);

  const features    = computeFeatures(oracle, prices, latest);
  const managerBal  = (summary.balances.find(b => b.quote_asset.includes('dusdc'))?.balance ?? 0);
  const walletBal   = Number(dusdcBal.totalRaw);
  // Total available = manager balance + wallet dUSDC (model works on combined)
  const totalH      = (managerBal + walletBal) / Number(DUSDC_SCALE);
  const pnlH        = summary.realized_pnl / Number(DUSDC_SCALE);

  console.log(`Spot: $${features.spot_usd.toFixed(2)}  Vol: ${features.realized_vol_pct.toFixed(2)}%  Trend: ${features.price_trend}`);
  console.log(`Wallet dUSDC : ${formatBalance(dusdcBal)}`);
  console.log(`Manager bal  : ${(managerBal / Number(DUSDC_SCALE)).toFixed(6)} dUSDC`);
  console.log(`Total avail  : ${totalH.toFixed(6)} dUSDC  |  PnL: ${pnlH >= 0 ? '+' : ''}${pnlH.toFixed(6)}`);

  // 3. Model decision
  const ctx: CycleContext = {
    features,
    balance_usdc:   totalH,
    realized_pnl:   pnlH,
    recent_history: loadHistory(),
  };

  // Run trained ML model for directional signal
  const mlPrediction = mlPredict(features);
  console.log(`ML model: ${formatPrediction(mlPrediction)}`);

  // Pass ML signal to hermes3 — it will use it for direction, decide sizing itself
  ctx.ml_prediction = mlPrediction;

  console.log('Asking hermes3…');
  const decision = await decide(ctx);

  console.log(`\nDecision (${decision.confidence} confidence):`);
  console.log(`  ${decision.reasoning}`);
  if (decision.skip) {
    console.log(`  SKIP: ${decision.skip_reason}`);
  } else {
    if (decision.supply_usdc > 0) console.log(`  Supply PLP : ${decision.supply_usdc} dUSDC`);
    for (const p of decision.positions) {
      if (p.type === 'range')
        console.log(`  Range      : $${p.lower_strike}–$${p.higher_strike}  qty=${p.quantity_usdc} dUSDC`);
      else
        console.log(`  ${p.type.toUpperCase().padEnd(4)}       : strike=$${p.strike}  qty=${p.quantity_usdc} dUSDC`);
    }
  }

  // 4. Execute or sim
  let digests: string[] = [];
  let execError: string | undefined;

  if (!decision.skip) {
    if (!LIVE_MODE && dusdcBal.coins.length === 0) {
      console.log('\n  [sim] No dUSDC coins — skipping devInspect (tokens not yet received)');
    } else {
      try {
        digests = await executeDecision(decision, oracle.oracle_id, BigInt(oracle.expiry));
      } catch (err) {
        execError = String(err);
        console.error('  Error:', execError);
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
