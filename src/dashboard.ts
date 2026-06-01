/**
 * FairLine Dashboard — Step 5
 * Single-screen Express app showing allocation, reasoning, and simulation results.
 * Run: npm run dashboard
 */

import 'dotenv/config';
import express, { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import {
  getNearestActiveOracle, getFutureOracles, getLatestPrice, getManagerSummary,
} from './indexer.js';
import { getDusdcCoins } from './coins.js';
import { getAddress, client } from './wallet.js';
import { MANAGER_ID, DUSDC_SCALE, priceToHuman } from './config.js';
import { computeFeatures } from './features.js';

const PORT         = parseInt(process.env.DASHBOARD_PORT ?? '3002', 10);
const CYCLES_LOG   = 'logs/cycles.jsonl';
const SIM_LOG      = 'logs/simulation.json';

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
    const [price, active] = await Promise.all([
      getLatestPrice(oracle.oracle_id),
      getFutureOracles(),
    ]);
    const features = computeFeatures(oracle, [], price);
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

app.get('/api/cycles', (_req: Request, res: Response) => {
  res.json(readCycles(30));
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
:root{--bg:#0d1117;--surf:#161b22;--border:#30363d;--text:#e6edf3;--muted:#8b949e;--green:#3fb950;--blue:#58a6ff;--yellow:#d29922;--red:#f85149;--purple:#bc8cff;--teal:#39d353}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:'SF Mono','Cascadia Code','Fira Code',monospace;font-size:13px;line-height:1.5;min-height:100vh}
h2{font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px}

/* Header */
header{background:var(--surf);border-bottom:1px solid var(--border);padding:12px 20px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10}
.header-left{display:flex;align-items:center;gap:16px}
.logo{font-size:16px;font-weight:700;color:var(--text)}
.logo span{color:var(--blue)}
#hd-spot{font-size:18px;font-weight:700;color:var(--green)}
#hd-expiry{font-size:11px;color:var(--muted)}
.header-right{display:flex;align-items:center;gap:12px;font-size:11px;color:var(--muted)}

/* Metrics bar */
.metrics{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;padding:16px 20px;border-bottom:1px solid var(--border)}
.metric{background:var(--surf);border:1px solid var(--border);border-radius:8px;padding:12px 14px}
.metric .lbl{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px}
.metric .val{font-size:22px;font-weight:700}
.metric .sub{font-size:10px;color:var(--muted);margin-top:2px}

/* Main grid */
main{display:grid;grid-template-columns:280px 1fr 300px;gap:14px;padding:16px 20px;align-items:start}

/* Cards */
.card{background:var(--surf);border:1px solid var(--border);border-radius:8px;padding:14px}
.card+.card{margin-top:12px}

/* Status dot */
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px}
.dot-green{background:var(--green);box-shadow:0 0 5px var(--green)}
.dot-yellow{background:var(--yellow)}
.dot-red{background:var(--red);box-shadow:0 0 5px var(--red)}
.dot-grey{background:var(--muted)}

/* Reasoning box */
.reasoning-box{background:var(--bg);border-radius:6px;padding:12px;font-size:12px;line-height:1.7;color:#cdd9e5;border-left:3px solid var(--blue);min-height:60px}

/* Position chips */
.positions{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.pos-chip{padding:4px 10px;border-radius:20px;font-size:11px;font-weight:600}
.pos-up{background:#1a3a1a;color:var(--green);border:1px solid var(--green)}
.pos-down{background:#3d1014;color:var(--red);border:1px solid var(--red)}
.pos-range{background:#1a2a3a;color:var(--blue);border:1px solid var(--blue)}
.pos-supply{background:#2a1a3a;color:var(--purple);border:1px solid var(--purple)}
.pos-skip{background:#1c2128;color:var(--muted);border:1px solid var(--border)}

/* Strike grid */
.strike-grid{font-size:12px}
.strike-row{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #21262d}
.strike-row:last-child{border-bottom:none}
.strike-atm{color:var(--yellow);font-weight:700}

/* Cycles table */
table{width:100%;border-collapse:collapse;font-size:11px}
th{text-align:left;color:var(--muted);font-weight:500;padding:4px 6px;border-bottom:1px solid var(--border)}
td{padding:4px 6px;border-bottom:1px solid #21262d}
tr:last-child td{border-bottom:none}
tr:hover td{background:#1c2128}

/* Equity chart */
#equity-chart{width:100%;height:160px;display:block}

/* Comparison bars */
.strat-bar{margin-bottom:10px}
.strat-name{display:flex;justify-content:space-between;margin-bottom:4px;font-size:11px}
.bar-track{background:var(--bg);border-radius:3px;height:8px;overflow:hidden}
.bar-fill{height:100%;border-radius:3px;transition:width .5s}

/* Buttons */
button{cursor:pointer;border:1px solid var(--border);border-radius:6px;padding:5px 12px;font-size:11px;font-family:inherit;transition:all .15s}
.btn-primary{background:#1f6feb;border-color:#388bfd;color:#fff}
.btn-primary:hover{background:#388bfd}
.btn-secondary{background:var(--surf);color:var(--text)}
.btn-secondary:hover{background:var(--border)}
button:disabled{opacity:.5;cursor:not-allowed}

/* Job status */
.job-pill{display:inline-block;padding:3px 8px;border-radius:12px;font-size:10px;font-weight:600}
.job-running{background:#112233;color:var(--blue)}
.job-done{background:#1a3a1a;color:var(--green)}
.job-error{background:#3d1014;color:var(--red)}

::-webkit-scrollbar{width:5px}
::-webkit-scrollbar-track{background:var(--bg)}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
</style>
</head>
<body>

<header>
  <div class="header-left">
    <div class="logo">Fair<span>Line</span></div>
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
  <div class="metric"><div class="lbl">Win Rate</div><div class="val" id="m-winrate">—</div><div class="sub" id="m-winrate-sub">— cycles</div></div>
  <div class="metric"><div class="lbl">Total P&amp;L</div><div class="val" id="m-pnl">—</div><div class="sub">dUSDC simulated</div></div>
  <div class="metric"><div class="lbl">Max Drawdown</div><div class="val" id="m-dd">—</div><div class="sub">peak-to-trough</div></div>
  <div class="metric"><div class="lbl">Period Return</div><div class="val" id="m-apy">—</div><div class="sub" id="m-apy-sub">over backtest window</div></div>
  <div class="metric"><div class="lbl">Manager Balance</div><div class="val" id="m-bal">—</div><div class="sub">dUSDC</div></div>
  <div class="metric"><div class="lbl">Active Markets</div><div class="val" id="m-markets">—</div><div class="sub">BTC oracles live</div></div>
</div>

<main>
  <!-- Left: Live market -->
  <div>
    <div class="card">
      <h2>Live BTC Market</h2>
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">
          <span style="color:var(--muted)">Spot</span><strong id="mk-spot">—</strong>
        </div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">
          <span style="color:var(--muted)">Forward</span><strong id="mk-fwd">—</strong>
        </div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">
          <span style="color:var(--muted)">Expires</span><strong id="mk-expiry">—</strong>
        </div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">
          <span style="color:var(--muted)">Vol (ann.)</span><strong id="mk-vol">—</strong>
        </div>
        <div style="display:flex;justify-content:space-between;padding:4px 0">
          <span style="color:var(--muted)">Trend</span><strong id="mk-trend">—</strong>
        </div>
      </div>
      <h2 style="margin-top:10px">Strike Grid</h2>
      <div class="strike-grid" id="strike-grid">—</div>
    </div>

    <div class="card">
      <h2>Wallet</h2>
      <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--muted)">SUI (gas)</span><span id="w-sui">—</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--muted)">dUSDC wallet</span><span id="w-dusdc">—</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:4px 0">
        <span style="color:var(--muted)">Manager</span><span id="w-mgr">—</span>
      </div>
      <div style="margin-top:10px;font-size:10px;color:var(--muted);word-break:break-all" id="w-addr">—</div>
    </div>
  </div>

  <!-- Center: Model decision + cycles -->
  <div>
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <h2 style="margin:0">hermes3 Allocation</h2>
        <div style="display:flex;align-items:center;gap:8px">
          <span id="job-pill"></span>
          <button class="btn-primary" id="btn-cycle" onclick="runCycle()">▶ Run Cycle</button>
        </div>
      </div>
      <div class="reasoning-box" id="reasoning">No cycle run yet — click Run Cycle to allocate.</div>
      <div class="positions" id="positions"></div>
      <div style="margin-top:8px;font-size:10px;color:var(--muted)" id="cycle-meta">—</div>
    </div>

    <div class="card" style="margin-top:12px">
      <h2>Recent Cycles</h2>
      <div style="overflow-x:auto">
        <table>
          <thead><tr>
            <th>Expiry</th><th>Spot</th><th>Strategy</th><th>P&amp;L</th><th>Mode</th>
          </tr></thead>
          <tbody id="cycles-table"><tr><td colspan="5" style="color:var(--muted)">No cycles yet</td></tr></tbody>
        </table>
      </div>
    </div>

    <div class="card" style="margin-top:12px">
      <h2>Equity Curve (Backtest — FairLine vs Always UP)</h2>
      <canvas id="equity-chart"></canvas>
      <div style="display:flex;gap:16px;margin-top:8px;font-size:10px">
        <span><span style="color:var(--blue)">■</span> FairLine</span>
        <span><span style="color:var(--red)">■</span> Always UP</span>
        <span><span style="color:var(--purple)">■</span> PLP Only</span>
      </div>
    </div>
  </div>

  <!-- Right: Simulation results -->
  <div>
    <div class="card">
      <h2>Simulation Results</h2>
      <div id="sim-period" style="font-size:10px;color:var(--muted);margin-bottom:10px">—</div>

      <div class="strat-bar">
        <div class="strat-name">
          <span style="color:var(--blue)">FairLine</span>
          <span id="sim-fl-ret">—</span>
        </div>
        <div class="bar-track"><div class="bar-fill" id="sim-fl-bar" style="background:var(--blue);width:0%"></div></div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px" id="sim-fl-detail">—</div>
      </div>

      <div class="strat-bar">
        <div class="strat-name">
          <span style="color:var(--purple)">PLP Only</span>
          <span id="sim-plp-ret">—</span>
        </div>
        <div class="bar-track"><div class="bar-fill" id="sim-plp-bar" style="background:var(--purple);width:0%"></div></div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px" id="sim-plp-detail">—</div>
      </div>

      <div class="strat-bar">
        <div class="strat-name">
          <span style="color:var(--red)">Always UP</span>
          <span id="sim-au-ret">—</span>
        </div>
        <div class="bar-track"><div class="bar-fill" id="sim-au-bar" style="background:var(--red);width:0%"></div></div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px" id="sim-au-detail">—</div>
      </div>
    </div>

    <div class="card">
      <h2>FairLine Metrics</h2>
      <div id="sim-metrics" style="font-size:12px">—</div>
    </div>

    <div class="card">
      <h2>Methodology</h2>
      <div style="font-size:11px;color:var(--muted);line-height:1.7">
        <div>• <strong style="color:var(--text)">Data</strong>: Real on-chain settled BTC oracles</div>
        <div>• <strong style="color:var(--text)">Entry</strong>: Earliest price event per oracle</div>
        <div>• <strong style="color:var(--text)">Rule</strong>: Trend-follow, skip if vol &gt; 15%</div>
        <div>• <strong style="color:var(--text)">Ask</strong>: 51.5% ATM (live devInspect)</div>
        <div>• <strong style="color:var(--text)">Return</strong>: Total % over backtest window (no APY extrapolation)</div>
        <div>• <strong style="color:var(--text)">Entry</strong>: Earliest available price event per oracle</div>
        <div>• <strong style="color:var(--text)">Capital</strong>: 100 dUSDC simulated start</div>
        <div>• <strong style="color:var(--text)">Size</strong>: 5 dUSDC max payout / position</div>
      </div>
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

async function loadVault(){
  const d=await api('/api/vault');
  document.getElementById('w-sui').textContent=d.sui_balance.toFixed(4)+' SUI';
  document.getElementById('w-dusdc').textContent=d.dusdc_wallet.toFixed(6)+' dUSDC';
  const mgrBal=d.manager?.balances?.find(b=>b.quote_asset.includes('dusdc'))?.balance??0;
  document.getElementById('w-mgr').textContent=(mgrBal/1e6).toFixed(6)+' dUSDC';
  document.getElementById('w-addr').textContent=d.address;

  // Metrics
  const total=(d.dusdc_wallet+(mgrBal/1e6));
  document.getElementById('m-bal').textContent=total.toFixed(4);
  if(d.manager){
    const pnl=d.manager.realized_pnl/1e6;
    document.getElementById('m-bal').style.color=total>0?'var(--green)':'var(--red)';
  }
}

// ── Cycles ───────────────────────────────────────────────────────────────────

async function loadCycles(){
  const cycles=await api('/api/cycles');
  const tbody=document.getElementById('cycles-table');
  if(!cycles.length){tbody.innerHTML='<tr><td colspan="5" style="color:var(--muted)">No cycles yet — click Run Cycle</td></tr>';return;}

  // Show latest decision
  const latest=cycles[0];
  const d=latest.decision;
  document.getElementById('reasoning').textContent=d.reasoning||'—';
  document.getElementById('cycle-meta').textContent=
    fmtDate(latest.ts)+' · '+d.confidence+' confidence · '+(latest.sim_only?'SIM mode':'LIVE');

  const posEl=document.getElementById('positions');
  if(d.skip){
    posEl.innerHTML='<span class="pos-chip pos-skip">SKIP</span>';
  } else {
    let html='';
    if(d.supply_usdc>0) html+='<span class="pos-chip pos-supply">PLP +'+d.supply_usdc.toFixed(1)+' dUSDC</span>';
    for(const p of (d.positions||[])){
      if(p.type==='up') html+='<span class="pos-chip pos-up">UP $'+p.strike+' / '+p.quantity_usdc+' dUSDC</span>';
      else if(p.type==='down') html+='<span class="pos-chip pos-down">DOWN $'+p.strike+' / '+p.quantity_usdc+' dUSDC</span>';
      else html+='<span class="pos-chip pos-range">RANGE $'+p.lower_strike+'-$'+p.higher_strike+' / '+p.quantity_usdc+' dUSDC</span>';
    }
    posEl.innerHTML=html||'<span class="pos-chip pos-skip">SKIP</span>';
  }

  // Table
  tbody.innerHTML=cycles.slice(0,15).map(c=>{
    const dec=c.decision;
    const pnlSign=dec.positions?.[0]?.pnl??0;
    const stratLabel=dec.skip?'SKIP':
      (dec.positions||[]).map(p=>p.type.toUpperCase()).join('+');
    const mode=c.sim_only?'<span style="color:var(--yellow)">SIM</span>':'<span style="color:var(--green)">LIVE</span>';
    return '<tr>'+
      '<td>'+new Date(c.expiry).toISOString().slice(11,16)+'</td>'+
      '<td>$'+(c.spot_usd||0).toLocaleString('en-US',{maximumFractionDigits:0})+'</td>'+
      '<td>'+esc(stratLabel)+'</td>'+
      '<td style="color:var(--muted);font-size:10px">'+(dec.skip?'—':'pending settlement')+'</td>'+
      '<td>'+mode+'</td>'+
    '</tr>';
  }).join('');
}

// ── Simulation ───────────────────────────────────────────────────────────────

async function loadSim(){
  let sim;
  try{sim=await api('/api/simulation');}catch{document.getElementById('sim-period').textContent='Run npm run simulate to generate results.';return;}

  const fl=sim.strategies.fairline;
  const au=sim.strategies.always_up;
  const plp=sim.strategies.plp_only;
  const cfg=sim.config;

  document.getElementById('sim-period').textContent=
    cfg.n_oracles+' oracles · '+cfg.period_start.slice(0,10)+' → '+cfg.period_end.slice(0,10);

  // Metrics bar
  document.getElementById('m-winrate').textContent=(fl.win_rate*100).toFixed(1)+'%';
  document.getElementById('m-winrate').style.color=fl.win_rate>0.5?'var(--green)':'var(--red)';
  document.getElementById('m-winrate-sub').textContent=fl.wins+'W / '+fl.losses+'L';
  document.getElementById('m-pnl').textContent=(fl.total_pnl>=0?'+':'')+fl.total_pnl.toFixed(2);
  document.getElementById('m-pnl').style.color=fl.total_pnl>=0?'var(--green)':'var(--red)';
  document.getElementById('m-dd').textContent=(fl.max_drawdown*100).toFixed(1)+'%';
  document.getElementById('m-dd').style.color=fl.max_drawdown>0.2?'var(--red)':'var(--yellow)';
  const simHours=(cfg.n_oracles*15/60).toFixed(0);
  document.getElementById('m-apy').textContent=(fl.total_return*100>=0?'+':'')+(fl.total_return*100).toFixed(1)+'%';
  document.getElementById('m-apy').style.color=fl.total_return>=0?'var(--green)':'var(--red)';
  document.getElementById('m-apy-sub').textContent='over '+simHours+'hr backtest ('+cfg.n_oracles+' oracles)';

  // Strategy bars (normalize to ±50% range)
  function barWidth(ret){return Math.min(Math.abs(ret*100),100).toFixed(0)+'%';}
  document.getElementById('sim-fl-ret').textContent=(fl.total_return*100>=0?'+':'')+( fl.total_return*100).toFixed(1)+'%';
  document.getElementById('sim-fl-bar').style.width=barWidth(fl.total_return);
  document.getElementById('sim-fl-detail').textContent='Win rate '+(fl.win_rate*100).toFixed(1)+'% · Sharpe '+fl.sharpe.toFixed(2)+' · '+fl.cycles_run+' cycles run';

  document.getElementById('sim-plp-ret').textContent='+'+(plp.total_return*100).toFixed(1)+'%';
  document.getElementById('sim-plp-bar').style.width=barWidth(plp.total_return);
  document.getElementById('sim-plp-detail').textContent='Yield 0.20%/cycle · passive liquidity provision';

  document.getElementById('sim-au-ret').textContent=(au.total_return*100>=0?'+':'')+(au.total_return*100).toFixed(1)+'%';
  document.getElementById('sim-au-bar').style.width=barWidth(Math.abs(au.total_return));
  document.getElementById('sim-au-bar').style.background='var(--red)';
  document.getElementById('sim-au-detail').textContent='Win rate '+(au.win_rate*100).toFixed(1)+'% · no vol filter · loses to spread';

  // Metrics card
  document.getElementById('sim-metrics').innerHTML=[
    ['Cycles run', fl.cycles_run+' / '+cfg.n_oracles],
    ['Cycles skipped', fl.cycles_skipped+' (vol filter)'],
    ['Win / Loss', fl.wins+' / '+fl.losses],
    ['Total return', (fl.total_return*100).toFixed(2)+'%'],
    ['Max drawdown', (fl.max_drawdown*100).toFixed(2)+'%'],
    ['Sharpe ratio', fl.sharpe.toFixed(2)],
    ['Period return', (fl.total_return*100>=0?'+':'')+(fl.total_return*100).toFixed(2)+'% over '+simHours+'hr'],
  ].map(([k,v])=>
    '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">'+
    '<span style="color:var(--muted)">'+k+'</span><strong>'+v+'</strong></div>'
  ).join('');

  // Chart
  drawChart(fl.equity_curve, au.equity_curve, plp.equity_curve);
}

// ── Equity chart ─────────────────────────────────────────────────────────────

function drawChart(fl, au, plp){
  const canvas=document.getElementById('equity-chart');
  const ctx=canvas.getContext('2d');
  const W=canvas.parentElement.clientWidth-28;
  const H=160;
  canvas.width=W; canvas.height=H;

  const allVals=[...fl,...au,...plp].map(p=>p.equity);
  const minV=Math.min(...allVals)*0.98;
  const maxV=Math.max(...allVals)*1.02;
  const scaleY=v=>H-(v-minV)/(maxV-minV)*H*0.9-H*0.05;
  const scaleX=(i,len)=>i/(len-1)*W;

  function drawLine(data,color){
    if(data.length<2)return;
    ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=1.5;
    data.forEach((p,i)=>{
      const x=scaleX(i,data.length),y=scaleY(p.equity);
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    });
    ctx.stroke();
  }

  // Grid line at 100
  const y100=scaleY(100);
  ctx.strokeStyle='#30363d';ctx.lineWidth=1;ctx.setLineDash([4,4]);
  ctx.beginPath();ctx.moveTo(0,y100);ctx.lineTo(W,y100);ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle='#8b949e';ctx.font='10px monospace';ctx.fillText('100 dUSDC',4,y100-3);

  drawLine(fl,'#58a6ff');
  drawLine(au,'#f85149');
  drawLine(plp,'#bc8cff');
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

async function loadAll(){
  document.getElementById('hd-time').textContent=new Date().toLocaleTimeString();
  await Promise.allSettled([loadMarket(),loadVault(),loadCycles(),loadSim()]);
}

loadAll();
setInterval(loadAll,30000);
</script>
</body>
</html>`;

app.get('/', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(HTML);
});

app.listen(PORT, () => {
  console.log(`FairLine dashboard → http://localhost:${PORT}`);
  console.log(`Manager: ${MANAGER_ID || '(not set)'}`);
});
