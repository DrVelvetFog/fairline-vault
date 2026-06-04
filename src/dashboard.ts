/**
 * FairLine Dashboard — Step 5
 * Single-screen Express app showing allocation, reasoning, and simulation results.
 * Run: npm run dashboard
 */

import 'dotenv/config';
import express, { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
const ROOT = process.cwd();
import * as child_process from 'child_process';
import {
  getNearestActiveOracle, getFutureOracles, getLatestPrice, getManagerSummary,
  getPriceHistory, PriceEvent,
} from './indexer.js';
import { getDusdcCoins, getPlpCoins } from './coins.js';
import { getVaultState } from './vault.js';
import { getAddress, client } from './wallet.js';
import { MANAGER_ID, DUSDC_SCALE, priceToHuman, PREDICT_OBJECT } from './config.js';
import { computeFeatures } from './features.js';

const PORT         = parseInt(process.env.DASHBOARD_PORT ?? '3002', 10);
const CYCLES_LOG   = path.join(ROOT, 'logs/cycles.jsonl');
const SIM_LOG      = path.join(ROOT, 'logs/simulation.json');
const MODEL_STATS  = path.join(ROOT, 'scripts/model_stats.json');
const RETRAIN_STATE = path.join(ROOT, 'logs/retrain-state.json');

// ── Price history cache (30s TTL — avoids 3s RPC call on every refresh) ──────
const priceCache = new Map<string, { data: PriceEvent[]; ts: number }>();
async function getCachedPriceHistory(oracleId: string) {
  const cached = priceCache.get(oracleId);
  if (cached && Date.now() - cached.ts < 30_000) return cached.data;
  const fresh = await getPriceHistory(oracleId);
  priceCache.set(oracleId, { data: fresh, ts: Date.now() });
  // Clear old entries
  if (priceCache.size > 5) {
    const oldest = [...priceCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    priceCache.delete(oldest[0]);
  }
  return fresh;
}

// ── Data helpers ──────────────────────────────────────────────────────────────

function readCycles(n = 20) {
  try {
    const lines = fs.readFileSync(CYCLES_LOG, 'utf-8').trim().split('\n').filter(Boolean);
    return lines.slice(-n).map(l => JSON.parse(l)).reverse();
  } catch { return []; }
}

function readSim() {
  try { return JSON.parse(fs.readFileSync(SIM_LOG, 'utf-8')); } catch { return null; }
}

// ── Background cycle runner ───────────────────────────────────────────────────

interface Job { status: 'running' | 'done' | 'error'; log: string; startedAt: string }
let activeJob: Job | null = null;

function runCycleBg() {
  if (activeJob?.status === 'running') return 'already_running';
  activeJob = { status: 'running', log: '', startedAt: new Date().toISOString() };
  const proc = child_process.spawn('npx', ['tsx', 'src/cycle.ts'], {
    cwd: process.cwd(), env: { ...process.env },
  });
  proc.stdout.on('data', (d: Buffer) => { activeJob!.log += d.toString(); });
  proc.stderr.on('data', (d: Buffer) => { activeJob!.log += d.toString(); });
  proc.on('close', code => { activeJob!.status = code === 0 ? 'done' : 'error'; });
  return 'started';
}

// ── API ───────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

app.get('/api/market', async (_req: Request, res: Response) => {
  try {
    const oracle  = await getNearestActiveOracle();
    if (!oracle) { res.json({ oracle: null }); return; }
    const [price, prices, active] = await Promise.all([
      getLatestPrice(oracle.oracle_id),
      getCachedPriceHistory(oracle.oracle_id),
      getFutureOracles(),
    ]);
    const features = computeFeatures(oracle, prices, price);
    res.json({ oracle, price, features, active_count: active.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/vault', async (_req: Request, res: Response) => {
  try {
    const address = getAddress();
    const [summary, dusdc, sui] = await Promise.all([
      MANAGER_ID ? getManagerSummary(MANAGER_ID) : Promise.resolve(null),
      getDusdcCoins(address),
      client.getBalance({ owner: address }),
    ]);
    res.json({
      manager_id:   MANAGER_ID,
      address,
      sui_balance:  Number(sui.totalBalance) / 1e9,
      dusdc_wallet: Number(dusdc.totalRaw) / Number(DUSDC_SCALE),
      manager:      summary,
    });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Liquidity provision (PLP) state ───────────────────────────────────────────
// Reads the on-chain vault reserves + PLP supply to compute the redemption rate
// (the realized house edge), plus this wallet's PLP holdings and the latest LP
// engine decision from the cycle log.
app.get('/api/plp', async (_req: Request, res: Response) => {
  try {
    const address = getAddress();
    const [predictObj, plpCoins] = await Promise.all([
      client.getObject({ id: PREDICT_OBJECT, options: { showContent: true } }),
      getPlpCoins(address),
    ]);

    const f: any = (predictObj.data?.content as any)?.fields ?? {};
    const reservesRaw = BigInt(f.vault?.fields?.balance ?? 0);
    const plpSupplyRaw = BigInt(f.treasury_cap?.fields?.total_supply?.fields?.value ?? 0);
    const mtmRaw       = BigInt(f.vault?.fields?.total_mtm ?? 0);
    const rate = plpSupplyRaw > 0n ? Number(reservesRaw) / Number(plpSupplyRaw) : 1;

    const heldRaw = plpCoins.reduce((s, c) => s + BigInt(c.balance), 0n);
    const heldValueDusdc = Number(heldRaw) * rate / Number(DUSDC_SCALE);

    // Latest LP engine decision from the cycle log
    const latest = readCycles(1)[0];
    const lp = latest?.lp ?? null;

    res.json({
      redemption_rate:  rate,
      house_edge_pct:   (rate - 1) * 100,
      reserves_dusdc:   Number(reservesRaw) / Number(DUSDC_SCALE),
      open_liability_dusdc: Number(mtmRaw) / Number(DUSDC_SCALE),
      plp_held:         Number(heldRaw) / Number(DUSDC_SCALE),
      plp_value_dusdc:  heldValueDusdc,
      lp_engine:        lp,   // { factor, target, current, delta, action }
    });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/vault-state', async (_req: Request, res: Response) => {
  try { res.json(await getVaultState()); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/accrual', (_req: Request, res: Response) => {
  try {
    const lines = fs.readFileSync(path.join(ROOT, 'logs/accrual.jsonl'), 'utf-8').trim().split('\n').filter(Boolean);
    res.json(lines.slice(-200).map(l => JSON.parse(l)));
  } catch { res.json([]); }
});

app.get('/api/cycles', (_req: Request, res: Response) => {
  res.json(readCycles(30));
});

app.get('/api/summary', (_req: Request, res: Response) => {
  try {
    res.json(JSON.parse(fs.readFileSync(path.join(ROOT, 'logs/daily-summary.json'), 'utf-8')));
  } catch {
    res.json(null);
  }
});

app.get('/api/model/stats', (_req: Request, res: Response) => {
  try {
    const stats = JSON.parse(fs.readFileSync(MODEL_STATS, 'utf-8'));
    let retrainState = {};
    try { retrainState = JSON.parse(fs.readFileSync(RETRAIN_STATE, 'utf-8')); } catch {}
    res.json({ ...stats, retrain_state: retrainState });
  } catch {
    res.json(null);
  }
});

app.get('/api/simulation', (_req: Request, res: Response) => {
  const sim = readSim();
  if (!sim) { res.status(404).json({ error: 'No simulation data — run npm run simulate' }); return; }
  res.json(sim);
});

app.get('/api/job', (_req: Request, res: Response) => {
  res.json(activeJob ?? { status: 'idle' });
});

app.post('/api/cycle/run', (_req: Request, res: Response) => {
  const status = runCycleBg();
  res.json({ status });
});

// ── Dashboard HTML ────────────────────────────────────────────────────────────

const HTML = /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FairLine — DeepBook Predict Vault</title>
<style>
:root{
  --bg:#0a0e14;--bg2:#0d1219;--surf:#141a23;--surf2:#1a212b;--border:#262e3a;
  --text:#e8eef5;--muted:#7d8896;--faint:#4a5563;
  --green:#3fd77a;--green-dim:#1a7a44;--blue:#5b9dff;--amber:#e0a93c;--red:#ff5d52;--teal:#2dd4bf;
  --sans:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  --mono:'SF Mono','JetBrains Mono','Cascadia Code','Fira Code',ui-monospace,monospace;
}
*{box-sizing:border-box;margin:0;padding:0}
body{
  background:radial-gradient(1200px 600px at 80% -10%,#10202b 0%,transparent 60%),var(--bg);
  color:var(--text);font-family:var(--sans);font-size:13px;line-height:1.5;min-height:100vh;
  -webkit-font-smoothing:antialiased;
}
.mono{font-family:var(--mono)}
h2{font-size:10.5px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px;display:flex;align-items:center;gap:7px}
.tag{font-size:9px;font-weight:700;letter-spacing:.06em;padding:2px 7px;border-radius:5px}
.tag-primary{background:rgba(63,215,122,.14);color:var(--green)}
.tag-exp{background:rgba(224,169,60,.14);color:var(--amber)}

/* Header */
header{background:rgba(13,18,25,.85);backdrop-filter:blur(10px);border-bottom:1px solid var(--border);padding:14px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10}
.header-left{display:flex;align-items:center;gap:18px}
.logo{font-size:17px;font-weight:700;letter-spacing:-.01em;display:flex;align-items:center;gap:11px}
.logo span{color:var(--green)}
#hd-spot{font-size:19px;font-weight:700;color:var(--text);font-family:var(--mono)}
#hd-expiry{font-size:11px;color:var(--muted)}
.header-right{display:flex;align-items:center;gap:14px;font-size:11px;color:var(--muted)}

/* Metrics bar */
.metrics{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;padding:20px 24px 6px}
.metric{background:linear-gradient(180deg,var(--surf2),var(--surf));border:1px solid var(--border);border-radius:12px;padding:14px 16px;position:relative;overflow:hidden}
.metric.hero{border-color:rgba(63,215,122,.35);box-shadow:0 0 0 1px rgba(63,215,122,.08),0 8px 24px -12px rgba(63,215,122,.3)}
.metric.hero::before{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(63,215,122,.07),transparent 70%);pointer-events:none}
.metric .lbl{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
.metric .val{font-size:23px;font-weight:700;font-family:var(--mono);letter-spacing:-.02em;line-height:1.1}
.metric .sub{font-size:10px;color:var(--faint);margin-top:4px}

/* Main grid */
main{display:grid;grid-template-columns:300px 1fr 320px;gap:16px;padding:16px 24px 28px;align-items:start}

/* Cards */
.card{background:var(--surf);border:1px solid var(--border);border-radius:12px;padding:16px 18px}
.card+.card{margin-top:14px}
.card.glow{border-color:rgba(63,215,122,.3);background:linear-gradient(180deg,rgba(63,215,122,.04),var(--surf))}
.row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)}
.row:last-child{border-bottom:none}
.row .k{color:var(--muted);font-size:12px}
.row .v{font-family:var(--mono);font-weight:600;font-size:12.5px}
.note{font-size:10.5px;color:var(--faint);line-height:1.6;margin-top:12px;padding-top:10px;border-top:1px solid var(--border)}

/* Big stat (hero LP) */
.bigstat{display:flex;align-items:baseline;gap:8px;margin:2px 0 14px}
.bigstat .num{font-family:var(--mono);font-size:34px;font-weight:700;color:var(--green);letter-spacing:-.02em}
.bigstat .unit{font-size:13px;color:var(--muted)}

/* Allocation bar */
.allocbar{display:flex;height:14px;border-radius:7px;overflow:hidden;background:var(--bg);margin:4px 0 8px;border:1px solid var(--border)}
.allocbar>span{height:100%;transition:width .6s ease}
.alloclegend{display:flex;gap:14px;font-size:10.5px;color:var(--muted);flex-wrap:wrap}
.alloclegend i{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:5px;vertical-align:middle}

/* Status dot */
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px}
.dot-green{background:var(--green);box-shadow:0 0 6px var(--green);animation:pulse 1.6s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1;box-shadow:0 0 6px var(--green)}50%{opacity:.45;box-shadow:0 0 12px var(--green)}}
.dot-yellow{background:var(--amber)}
.dot-red{background:var(--red);box-shadow:0 0 6px var(--red)}
.dot-grey{background:var(--muted)}

/* Reasoning box */
.reasoning-box{background:var(--bg);border-radius:8px;padding:13px 15px;font-size:12.5px;line-height:1.7;color:#cdd9e5;border-left:3px solid var(--green);min-height:48px}

/* Position chips */
.positions{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.pos-chip{padding:5px 11px;border-radius:8px;font-size:11px;font-weight:600;font-family:var(--mono)}
.pos-up{background:rgba(63,215,122,.12);color:var(--green);border:1px solid rgba(63,215,122,.4)}
.pos-down{background:rgba(255,93,82,.1);color:var(--red);border:1px solid rgba(255,93,82,.4)}
.pos-range{background:rgba(91,157,255,.1);color:var(--blue);border:1px solid rgba(91,157,255,.4)}
.pos-supply{background:rgba(45,212,191,.1);color:var(--teal);border:1px solid rgba(45,212,191,.4)}
.pos-skip{background:var(--surf2);color:var(--muted);border:1px solid var(--border)}

/* Strike grid */
.strike-grid{font-size:12px;font-family:var(--mono)}
.strike-row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)}
.strike-row:last-child{border-bottom:none}
.strike-atm{color:var(--amber);font-weight:700}

/* Cycles table */
table{width:100%;border-collapse:collapse;font-size:11px}
th{text-align:left;color:var(--muted);font-weight:500;padding:6px 6px;border-bottom:1px solid var(--border);text-transform:uppercase;letter-spacing:.04em;font-size:10px}
td{padding:6px 6px;border-bottom:1px solid var(--border);font-family:var(--mono)}
tr:last-child td{border-bottom:none}
tr:hover td{background:var(--surf2)}

/* Buttons */
button{cursor:pointer;border:1px solid var(--border);border-radius:8px;padding:6px 13px;font-size:11px;font-family:inherit;font-weight:600;transition:all .15s}
.btn-primary{background:var(--green-dim);border-color:var(--green);color:#eafff2}
.btn-primary:hover{background:var(--green);color:#06210f}
.btn-secondary{background:var(--surf2);color:var(--text)}
.btn-secondary:hover{background:var(--border)}
button:disabled{opacity:.5;cursor:not-allowed}

/* Job status */
.job-pill{display:inline-block;padding:3px 9px;border-radius:8px;font-size:10px;font-weight:700}
.job-running{background:rgba(91,157,255,.15);color:var(--blue)}
.job-done{background:rgba(63,215,122,.15);color:var(--green)}
.job-error{background:rgba(255,93,82,.15);color:var(--red)}

::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
@media(max-width:1100px){.metrics{grid-template-columns:repeat(3,1fr)}main{grid-template-columns:1fr}}
</style>
</head>
<body>

<header>
  <div class="header-left">
    <div class="logo" style="display:flex;align-items:center;gap:10px">
    <svg width="32" height="32" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
      <rect width="120" height="120" rx="28" fill="#16120e"/>
      <line x1="20" y1="60" x2="100" y2="60" stroke="#ece2d0" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 9" opacity="0.65"/>
      <path d="M52 60 L94 87" stroke="#8c8170" stroke-width="6" stroke-linecap="round"/>
      <circle cx="94" cy="87" r="4.5" fill="#8c8170"/>
      <path d="M52 60 L94 33" stroke="#ff4d2e" stroke-width="6.5" stroke-linecap="round"/>
      <circle cx="94" cy="33" r="5.5" fill="#ff4d2e"/>
      <circle cx="52" cy="60" r="7.5" fill="#ece2d0"/>
      <circle cx="52" cy="60" r="3.2" fill="#16120e"/>
    </svg>
    Fair<span>Line</span>
  </div>
    <div>
      <div id="hd-spot">—</div>
      <div id="hd-expiry">Loading market…</div>
    </div>
  </div>
  <div class="header-right">
    <span><span class="dot" id="hd-dot"></span><span id="hd-status">—</span></span>
    <span id="hd-oracle" style="color:var(--muted);font-size:10px">—</span>
    <span id="hd-time">—</span>
    <button class="btn-secondary" style="padding:4px 10px;font-size:11px" onclick="loadAll()">↻</button>
  </div>
</header>

<div class="metrics">
  <div class="metric hero"><div class="lbl">PLP Position</div><div class="val" id="m-plp" style="color:var(--green)">—</div><div class="sub" id="m-plp-sub">liquidity supplied · the house</div></div>
  <div class="metric"><div class="lbl">House Edge</div><div class="val" id="m-edge" style="color:var(--green)">—</div><div class="sub">PLP redemption rate</div></div>
  <div class="metric"><div class="lbl">Total Capital</div><div class="val" id="m-bal">—</div><div class="sub">PLP + wallet + manager</div></div>
  <div class="metric"><div class="lbl">LP Exposure</div><div class="val" id="m-exp">—</div><div class="sub" id="m-exp-sub">of target</div></div>
  <div class="metric"><div class="lbl">Sleeve P&amp;L</div><div class="val" id="m-pnl">—</div><div class="sub" id="m-pnl-sub">directional · experimental</div></div>
  <div class="metric"><div class="lbl">Active Markets</div><div class="val" id="m-markets">—</div><div class="sub">BTC oracles live</div></div>
</div>

<main>
  <!-- Left: Live market + wallet -->
  <div>
    <div class="card">
      <h2>Live BTC Market</h2>
      <div class="row"><span class="k">Spot</span><span class="v" id="mk-spot">—</span></div>
      <div class="row"><span class="k">Forward</span><span class="v" id="mk-fwd">—</span></div>
      <div class="row"><span class="k">Expires</span><span class="v" id="mk-expiry">—</span></div>
      <div class="row"><span class="k">Vol (ann.)</span><span class="v" id="mk-vol">—</span></div>
      <div class="row"><span class="k">Trend</span><span class="v" id="mk-trend">—</span></div>
      <h2 style="margin-top:16px">Strike Grid</h2>
      <div class="strike-grid" id="strike-grid">—</div>
    </div>

    <div class="card">
      <h2>Capital</h2>
      <div class="row"><span class="k">PLP (liquidity)</span><span class="v" id="w-plp" style="color:var(--green)">—</span></div>
      <div class="row"><span class="k">dUSDC wallet</span><span class="v" id="w-dusdc">—</span></div>
      <div class="row"><span class="k">Manager balance</span><span class="v" id="w-mgr">—</span></div>
      <div class="row"><span class="k">SUI (gas)</span><span class="v" id="w-sui">—</span></div>
      <div class="note mono" id="w-addr" style="word-break:break-all">—</div>
    </div>
  </div>

  <!-- Center: LP engine (hero) + latest cycle + activity -->
  <div>
    <div class="card glow">
      <h2>💧 Liquidity Provision Engine <span class="tag tag-primary">PRIMARY</span></h2>
      <div class="bigstat"><span class="num" id="lp-position">—</span><span class="unit">dUSDC in PLP</span></div>

      <div class="allocbar" id="alloc-bar"><span style="width:0%;background:var(--green)"></span><span style="width:0%;background:var(--blue)"></span><span style="width:0%;background:var(--faint)"></span></div>
      <div class="alloclegend">
        <span><i style="background:var(--green)"></i>PLP <span id="al-plp">—</span></span>
        <span><i style="background:var(--blue)"></i>Wallet <span id="al-wal">—</span></span>
        <span><i style="background:var(--faint)"></i>Manager <span id="al-mgr">—</span></span>
      </div>

      <div style="margin-top:16px">
        <div class="row"><span class="k">Redemption rate</span><span class="v" id="lp-rate">—</span></div>
        <div class="row"><span class="k">House edge (LP gain to date)</span><span class="v" id="lp-edge">—</span></div>
        <div class="row"><span class="k">Exposure factor → target</span><span class="v" id="lp-factor">—</span></div>
        <div class="row"><span class="k">Last LP action</span><span class="v" id="lp-action">—</span></div>
      </div>
      <div class="note">
        Vault reserves <span class="mono" id="lp-reserves">—</span> · open liability <span class="mono" id="lp-liability">—</span> of reserves.
        FairLine earns the vault's spread as the <strong style="color:var(--text)">house</strong>; the ML/volatility signal gates exposure against directional risk (sticky — it scales position size, never thrashes in and out).
      </div>
    </div>

    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <h2 style="margin:0">Latest Cycle Decision</h2>
        <div style="display:flex;align-items:center;gap:8px">
          <span id="job-pill"></span>
          <button class="btn-primary" id="btn-cycle" onclick="runCycle()">▶ Run Cycle</button>
        </div>
      </div>
      <div class="reasoning-box" id="reasoning">No cycle run yet — click Run Cycle.</div>
      <div class="positions" id="positions"></div>
      <div class="note" id="cycle-meta" style="border:none;padding-top:8px">—</div>
    </div>

    <div class="card">
      <h2>Engine Activity</h2>
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>Time</th><th>Vol</th><th>LP Action</th><th>Target</th><th>Sleeve</th><th>Mode</th></tr></thead>
          <tbody id="cycles-table"><tr><td colspan="6" style="color:var(--muted)">No cycles yet</td></tr></tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h2>House Edge Accrual <span style="font-size:10px;color:var(--muted)">PLP redemption rate over time</span></h2>
      <canvas id="accrual-chart" style="width:100%;height:140px;display:block"></canvas>
      <div id="accrual-empty" class="note" style="border:none">Accruing — chart fills as snapshots accumulate (run <span class="mono">npm run snapshot</span> on a cron).</div>
    </div>
  </div>

  <!-- Right: vault + ML risk gate + directional sleeve -->
  <div>
    <div class="card glow">
      <h2>🏦 FairLine Vault <span class="tag tag-primary">MULTI-USER</span></h2>
      <div class="bigstat"><span class="num" id="v-tvl" style="font-size:28px">—</span><span class="unit">TVL (dUSDC)</span></div>
      <div class="row"><span class="k">Share price (FLP)</span><span class="v" id="v-price">—</span></div>
      <div class="row"><span class="k">FLP supply</span><span class="v" id="v-supply">—</span></div>
      <div class="row"><span class="k">Idle reserve</span><span class="v" id="v-reserve">—</span></div>
      <div class="row"><span class="k">Deployed to strategy</span><span class="v" id="v-deployed">—</span></div>
      <div class="note">
        On-chain share vault — anyone deposits dUSDC for FLP shares priced at NAV, withdraws pro-rata.
        <span class="mono" id="v-addr">—</span>
      </div>
    </div>

    <div class="card">
      <h2>ML Risk Gate</h2>
      <div class="note" style="border:none;padding:0 0 10px;margin:0">A directional model used <strong style="color:var(--text)">defensively</strong> — it scales LP exposure down when a strong move is likely, not to place bets.</div>
      <div id="ml-stats">Loading…</div>
    </div>

    <div class="card">
      <h2>Directional Sleeve <span class="tag tag-exp">EXPERIMENTAL</span></h2>
      <div class="note" style="border:none;padding:0 0 10px;margin:0">Small capped research sleeve (≤15/position, ≤45/cycle). Full on-chain P&amp;L, reported honestly — not the income strategy.</div>
      <div id="live-results">Loading…</div>
    </div>
  </div>
</main>

<script>
function fmt(ts){if(!ts)return'—';const d=new Date(ts);return d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});}
function fmtDate(ts){if(!ts)return'—';return new Date(ts).toISOString().slice(0,16).replace('T',' ');}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
async function api(url){const r=await fetch(url);if(!r.ok)throw new Error(r.statusText);return r.json();}

// ── Market ───────────────────────────────────────────────────────────────────

async function loadMarket(){
  const d = await api('/api/market');
  if(!d.oracle){document.getElementById('hd-expiry').textContent='No active oracle';return;}
  const f=d.features, p=d.price, o=d.oracle;
  const spot=f.spot_usd, atm=Math.round(spot);
  const minsLeft=((o.expiry-Date.now())/60000).toFixed(1);

  // Header
  document.getElementById('hd-spot').textContent='$'+spot.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  document.getElementById('hd-expiry').textContent='Expires in '+minsLeft+' min';
  document.getElementById('hd-oracle').textContent=o.oracle_id.slice(0,12)+'…';
  document.getElementById('hd-time').textContent=new Date().toLocaleTimeString();
  const dotEl=document.getElementById('hd-dot');
  const statusEl=document.getElementById('hd-status');
  dotEl.className='dot '+(minsLeft>5?'dot-green':minsLeft>2?'dot-yellow':'dot-red');
  statusEl.textContent=d.active_count+' active markets';

  // Market card
  document.getElementById('mk-spot').textContent='$'+spot.toLocaleString('en-US',{minimumFractionDigits:2});
  document.getElementById('mk-fwd').textContent='$'+f.forward_usd.toLocaleString('en-US',{minimumFractionDigits:2});
  document.getElementById('mk-expiry').textContent=minsLeft+' min ('+new Date(o.expiry).toISOString().slice(11,16)+' UTC)';
  document.getElementById('mk-vol').textContent=f.realized_vol_pct.toFixed(2)+'%';
  const tColor=f.price_trend==='up'?'var(--green)':f.price_trend==='down'?'var(--red)':'var(--muted)';
  document.getElementById('mk-trend').innerHTML='<span style="color:'+tColor+'">'+f.price_trend+'</span> ('+
    (f.price_change_pct>=0?'+':'')+f.price_change_pct.toFixed(4)+'%)';

  // Strike grid
  const ticks=[-3,-2,-1,0,1,2,3];
  document.getElementById('strike-grid').innerHTML=ticks.map(d=>{
    const s=atm+d;
    const isAtm=d===0;
    return '<div class="strike-row'+(isAtm?' strike-atm':'')+'">'+
      '<span>$'+s.toLocaleString()+(isAtm?' ← ATM':'')+'</span>'+
      '<span style="color:var(--muted)">'+(isAtm?'~50%':'—')+'</span>'+
    '</div>';
  }).join('');

  // Metrics
  document.getElementById('m-markets').textContent=d.active_count;
}

// ── Vault ────────────────────────────────────────────────────────────────────

const S={wallet:0,manager:0,plp:0,target:0};

async function loadVault(){
  const d=await api('/api/vault');
  const mgrBal=(d.manager?.balances?.find(b=>b.quote_asset.includes('dusdc'))?.balance??0)/1e6;
  S.wallet=d.dusdc_wallet; S.manager=mgrBal;
  document.getElementById('w-sui').textContent=d.sui_balance.toFixed(4)+' SUI';
  document.getElementById('w-dusdc').textContent=d.dusdc_wallet.toFixed(2)+' dUSDC';
  document.getElementById('w-mgr').textContent=mgrBal.toFixed(2)+' dUSDC';
  document.getElementById('w-addr').textContent=d.address;
}

// Cross-cutting capital view — needs both wallet (loadVault) and PLP (loadPlp).
function renderCapital(){
  const total=S.plp+S.wallet+S.manager;
  document.getElementById('m-bal').textContent=total.toFixed(0);
  const pct=v=>total>0?(v/total*100):0;
  const bar=document.getElementById('alloc-bar').children;
  bar[0].style.width=pct(S.plp)+'%'; bar[1].style.width=pct(S.wallet)+'%'; bar[2].style.width=pct(S.manager)+'%';
  document.getElementById('al-plp').textContent=pct(S.plp).toFixed(0)+'%';
  document.getElementById('al-wal').textContent=pct(S.wallet).toFixed(0)+'%';
  document.getElementById('al-mgr').textContent=pct(S.manager).toFixed(0)+'%';
  if(S.target>0){
    document.getElementById('m-exp').textContent=Math.min(100,S.plp/S.target*100).toFixed(0)+'%';
    document.getElementById('m-exp-sub').textContent='of '+S.target.toFixed(0)+' dUSDC target';
  }else{
    document.getElementById('m-exp').textContent='—';
    document.getElementById('m-exp-sub').textContent='awaiting next cycle';
  }
}

// ── Cycles ───────────────────────────────────────────────────────────────────

function lpActionChip(a){
  const c=a==='supply'?'var(--green)':a==='pullback'?'var(--red)':a==='none'?'var(--amber)':'var(--muted)';
  return '<span style="color:'+c+'">'+(a||'—')+'</span>';
}

async function loadCycles(){
  const cycles=await api('/api/cycles');
  const tbody=document.getElementById('cycles-table');
  if(!cycles.length){tbody.innerHTML='<tr><td colspan="6" style="color:var(--muted)">No cycles yet — click Run Cycle</td></tr>';return;}

  // Latest decision (LP + sleeve)
  const latest=cycles[0];
  const d=latest.decision, lp=latest.lp;
  let reason='';
  if(lp) reason+='LP: '+(lp.action==='supply'?'supplying toward '+lp.target.toFixed(0)+' dUSDC target (factor '+lp.factor.toFixed(2)+')':lp.action==='hold'?'holding '+lp.current.toFixed(0)+' dUSDC (factor '+lp.factor.toFixed(2)+')':lp.action)+'. ';
  reason+='Sleeve: '+(d.skip?(d.skip_reason||'idle'):(d.reasoning||'active'));
  document.getElementById('reasoning').textContent=reason||'—';
  document.getElementById('cycle-meta').textContent=fmtDate(latest.ts)+' · '+(latest.sim_only?'SIM mode':'LIVE 🔴');

  const posEl=document.getElementById('positions');
  let html='';
  if(lp&&lp.action==='supply') html+='<span class="pos-chip pos-supply">PLP SUPPLY → '+lp.target.toFixed(0)+'</span>';
  else if(lp) html+='<span class="pos-chip pos-skip">LP '+lp.action.toUpperCase()+'</span>';
  if(d.skip) html+='<span class="pos-chip pos-skip">SLEEVE IDLE</span>';
  for(const p of (d.positions||[])){
    if(p.type==='up') html+='<span class="pos-chip pos-up">UP $'+p.strike+' / '+p.quantity_usdc+'</span>';
    else if(p.type==='down') html+='<span class="pos-chip pos-down">DOWN $'+p.strike+' / '+p.quantity_usdc+'</span>';
    else html+='<span class="pos-chip pos-range">RANGE '+p.lower_strike+'-'+p.higher_strike+'</span>';
  }
  posEl.innerHTML=html;

  // Activity table
  tbody.innerHTML=cycles.slice(0,14).map(c=>{
    const lp=c.lp, dec=c.decision;
    const vol=(c.features&&c.features.realized_vol_pct!=null)?c.features.realized_vol_pct.toFixed(0)+'%':'—';
    const sleeve=dec.skip?'idle':(dec.positions||[]).map(p=>p.type.toUpperCase()).join('+')||'idle';
    const mode=c.sim_only?'<span style="color:var(--amber)">SIM</span>':'<span style="color:var(--green)">LIVE</span>';
    return '<tr>'+
      '<td>'+new Date(c.ts).toISOString().slice(11,16)+'</td>'+
      '<td>'+vol+'</td>'+
      '<td>'+lpActionChip(lp&&lp.action)+'</td>'+
      '<td>'+(lp?lp.target.toFixed(0):'—')+'</td>'+
      '<td style="color:var(--muted)">'+esc(sleeve)+'</td>'+
      '<td>'+mode+'</td>'+
    '</tr>';
  }).join('');
}

// ── Cycle runner ─────────────────────────────────────────────────────────────

async function runCycle(){
  const btn=document.getElementById('btn-cycle');
  btn.disabled=true;btn.textContent='Running…';
  document.getElementById('job-pill').innerHTML='<span class="job-pill job-running">running</span>';
  try{
    await fetch('/api/cycle/run',{method:'POST'});
    pollJob();
  }catch(e){
    document.getElementById('job-pill').innerHTML='<span class="job-pill job-error">error</span>';
    btn.disabled=false;btn.textContent='▶ Run Cycle';
  }
}

function pollJob(){
  const interval=setInterval(async()=>{
    const j=await api('/api/job');
    if(j.status==='done'){
      clearInterval(interval);
      document.getElementById('job-pill').innerHTML='<span class="job-pill job-done">done</span>';
      document.getElementById('btn-cycle').disabled=false;
      document.getElementById('btn-cycle').textContent='▶ Run Cycle';
      await loadCycles();
      await loadVault();
      setTimeout(()=>{document.getElementById('job-pill').innerHTML='';},5000);
    } else if(j.status==='error'){
      clearInterval(interval);
      document.getElementById('job-pill').innerHTML='<span class="job-pill job-error">error</span>';
      document.getElementById('btn-cycle').disabled=false;
      document.getElementById('btn-cycle').textContent='▶ Run Cycle';
    }
  },2000);
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function loadModelStats(){
  try{
    const d=await api('/api/model/stats');
    if(!d){document.getElementById('ml-stats').textContent='Stats not available — run npm run train';return;}
    const rows=[
      ['Model','Logistic Regression'],
      ['Trained on',d.trained_on.toLocaleString()+' oracles'],
      ['CV Accuracy',(d.cv_accuracy*100).toFixed(1)+'%  (±'+(d.cv_std*100).toFixed(1)+'%)'],
      ['Edge over random','+'+(d.edge_over_random_pp).toFixed(1)+'pp'],
      ['Top feature',d.top_features?.[0] ? d.top_features[0][0]+' ('+d.top_features[0][1]+')' : '—'],
      ['Last retrained',d.trained_at?new Date(d.trained_at).toLocaleString():'—'],
    ];
    document.getElementById('ml-stats').innerHTML=rows.map(([k,v])=>
      '<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border)">'+
      '<span style="color:var(--muted)">'+k+'</span><strong>'+v+'</strong></div>'
    ).join('');
  }catch(e){document.getElementById('ml-stats').textContent='Error: '+e.message;}
}

async function loadLiveResults(){
  try{
    const d=await api('/api/summary');

    // ── Sleeve P&L metric tile ────────────────────────────────────────────────
    if(d&&d.total_trades>0){
      document.getElementById('m-pnl').textContent=(d.net_pnl>=0?'+':'')+d.net_pnl.toFixed(1);
      document.getElementById('m-pnl').style.color=d.net_pnl>=0?'var(--green)':'var(--red)';
      document.getElementById('m-pnl-sub').textContent=d.total_wins+'W / '+d.total_losses+'L · '+(d.overall_win_rate*100).toFixed(0)+'% win';
    }

    if(!d||d.total_trades===0){document.getElementById('live-results').innerHTML='<div style="color:var(--muted)">No completed trades yet — first results appear after a position settles.</div>';return;}
    const wr=(d.overall_win_rate*100);
    const wrColor=wr>=51.5?'var(--green)':'var(--red)';
    const pnlColor=d.net_pnl>=0?'var(--green)':'var(--red)';
    let html=
      '<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border)"><span style="color:var(--muted)">Completed trades</span><strong>'+d.total_trades+'</strong></div>'+
      '<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border)"><span style="color:var(--muted)">Win / Loss</span><strong>'+d.total_wins+'W / '+d.total_losses+'L</strong></div>'+
      '<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border)"><span style="color:var(--muted)">Win rate</span><strong style="color:'+wrColor+'">'+wr.toFixed(1)+'% <span style="color:var(--muted);font-weight:400">(BE 51.5%)</span></strong></div>'+
      '<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border)"><span style="color:var(--muted)">Net P&L</span><strong style="color:'+pnlColor+'">'+(d.net_pnl>=0?'+':'')+d.net_pnl.toFixed(4)+' dUSDC</strong></div>'+
      '<div style="display:flex;justify-content:space-between;padding:3px 0"><span style="color:var(--muted)">Open positions</span><strong>'+d.open_positions+'</strong></div>';
    if(d.days&&d.days.length){
      html+='<div style="margin-top:10px;font-size:10px;color:var(--muted);text-transform:uppercase">By day</div>';
      for(const day of d.days){
        html+='<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:11px"><span>'+day.day.slice(5)+'  '+day.wins+'/'+day.losses+'</span><span style="color:'+(day.net_pnl>=0?'var(--green)':'var(--red)')+'">'+(day.net_pnl>=0?'+':'')+day.net_pnl.toFixed(3)+'</span></div>';
      }
    }
    document.getElementById('live-results').innerHTML=html;
  }catch(e){document.getElementById('live-results').textContent='Error: '+e.message;}
}

async function loadPlp(){
  try{
    const d=await api('/api/plp');
    const held=d.plp_value_dusdc||0;
    S.plp=held;
    // Hero + metric tiles
    document.getElementById('lp-position').textContent=held.toFixed(0);
    document.getElementById('m-plp').textContent=held.toFixed(0);
    document.getElementById('m-edge').textContent=(d.house_edge_pct>=0?'+':'')+d.house_edge_pct.toFixed(3)+'%';
    document.getElementById('w-plp').textContent=held.toFixed(2)+' dUSDC';
    document.getElementById('lp-rate').textContent=d.redemption_rate.toFixed(6);
    document.getElementById('lp-edge').textContent=(d.house_edge_pct>=0?'+':'')+d.house_edge_pct.toFixed(4)+'%';
    document.getElementById('lp-edge').style.color=d.house_edge_pct>=0?'var(--green)':'var(--red)';
    if(d.lp_engine){
      S.target=d.lp_engine.target||0;
      document.getElementById('lp-factor').textContent=d.lp_engine.factor.toFixed(2)+' → '+d.lp_engine.target.toFixed(0)+' dUSDC';
      const act=d.lp_engine.action;
      document.getElementById('lp-action').innerHTML=lpActionChip(act);
    }
    document.getElementById('lp-reserves').textContent=(d.reserves_dusdc/1e6).toFixed(2)+'M dUSDC';
    document.getElementById('lp-liability').textContent=(d.open_liability_dusdc/d.reserves_dusdc*100).toFixed(3)+'%';
  }catch(e){}
}

async function loadVaultState(){
  try{
    const d=await api('/api/vault-state');
    document.getElementById('v-tvl').textContent=d.nav.toFixed(2);
    document.getElementById('v-price').textContent=d.sharePrice.toFixed(6)+' dUSDC';
    document.getElementById('v-price').style.color=d.sharePrice>=1?'var(--green)':'var(--red)';
    document.getElementById('v-supply').textContent=d.totalShares.toFixed(2)+' FLP';
    document.getElementById('v-reserve').textContent=d.reserve.toFixed(2)+' dUSDC';
    document.getElementById('v-deployed').textContent=d.deployed.toFixed(2)+' dUSDC';
    document.getElementById('v-addr').textContent='0x71a352…af04fb7e';
  }catch(e){}
}

async function loadAccrual(){
  let pts=[]; try{pts=await api('/api/accrual');}catch{}
  const empty=document.getElementById('accrual-empty');
  const canvas=document.getElementById('accrual-chart');
  if(!pts||pts.length<2){empty.style.display='';return;}
  empty.style.display='none';
  const ctx=canvas.getContext('2d');
  const W=canvas.clientWidth, H=140; canvas.width=W; canvas.height=H;
  const vals=pts.map(p=>p.edge_pct);
  const min=Math.min(...vals), max=Math.max(...vals), span=(max-min)||1;
  const x=i=>i/(pts.length-1)*(W-8)+4;
  const y=v=>H-8-((v-min)/span)*(H-20);
  // area + line
  ctx.beginPath();ctx.moveTo(x(0),y(vals[0]));
  for(let i=1;i<vals.length;i++)ctx.lineTo(x(i),y(vals[i]));
  ctx.strokeStyle='#3fd77a';ctx.lineWidth=2;ctx.stroke();
  ctx.lineTo(x(vals.length-1),H);ctx.lineTo(x(0),H);ctx.closePath();
  ctx.fillStyle='rgba(63,215,122,.10)';ctx.fill();
  ctx.fillStyle='#7d8896';ctx.font='10px monospace';
  ctx.fillText('+'+max.toFixed(3)+'%',4,12);
  ctx.fillText(pts.length+' pts',W-46,12);
}

async function loadAll(){
  document.getElementById('hd-time').textContent=new Date().toLocaleTimeString();
  await Promise.allSettled([loadMarket(),loadVault(),loadCycles(),loadModelStats(),loadLiveResults(),loadPlp(),loadVaultState(),loadAccrual()]);
  renderCapital();
}

loadAll();
setInterval(loadAll, 10000);  // refresh on-chain + market data every 10s (visibly live)
setInterval(function(){ var e=document.getElementById('hd-time'); if(e) e.textContent=new Date().toLocaleTimeString(); }, 1000);  // ticking clock
</script>
</body>
</html>`;

app.get('/', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.send(HTML);
});

app.listen(PORT, () => {
  console.log(`FairLine dashboard → http://localhost:${PORT}`);
  console.log(`Manager: ${MANAGER_ID || '(not set)'}`);
});
