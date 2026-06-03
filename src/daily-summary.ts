/**
 * Daily P&L summary — reconstructs completed round-trips from on-chain
 * minted/redeemed records and groups them by UTC day.
 *
 * Source of truth = the indexer's manager positions, NOT local logs, so this
 * reflects exactly what happened on-chain.
 *
 * Run once:    npm run summary
 * Writes:      logs/daily-summary.json  (consumed by the dashboard)
 */

import 'dotenv/config';
import * as fs from 'fs';
import { getManagerPositions, getManagerSummary, ManagerPosition } from './indexer.js';
import { MANAGER_ID, DUSDC_SCALE, priceToHuman } from './config.js';

const OUT_PATH = 'logs/daily-summary.json';
const SCALE    = Number(DUSDC_SCALE);

interface RoundTrip {
  day:        string;   // YYYY-MM-DD (UTC)
  oracle_id:  string;
  direction:  string;   // UP / DOWN
  strike:     number;
  qty:        number;   // dUSDC max payout
  cost:       number;   // dUSDC paid to enter
  payout:     number;   // dUSDC received at settlement
  pnl:        number;   // payout - cost
  won:        boolean;
  ts:         number;   // settlement checkpoint ms
}

interface DayStats {
  day:         string;
  trades:      number;
  wins:        number;
  losses:      number;
  win_rate:    number;
  total_cost:  number;
  total_payout:number;
  net_pnl:     number;
}

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

async function main() {
  console.log('\n━━━ FairLine — Daily P&L Summary ━━━\n');

  // Positions are the core data; manager summary is supplementary (one display line).
  // Fetch summary tolerantly so a transient indexer outage never crash-loops this job.
  const { minted, redeemed } = await getManagerPositions(MANAGER_ID);
  const summary = await getManagerSummary(MANAGER_ID).catch(err => {
    console.log(`  [warn] manager summary unavailable: ${String(err).slice(0, 80)}`);
    return null;
  });

  // Index minted positions by oracle_id (one position per oracle by design)
  const mintByOracle = new Map<string, ManagerPosition>();
  for (const m of minted) mintByOracle.set(m.oracle_id, m);

  // Match each redeemed position back to its mint → completed round-trip
  const roundTrips: RoundTrip[] = [];
  for (const r of redeemed) {
    const m = mintByOracle.get(r.oracle_id);
    if (!m) continue;  // can't compute P&L without the entry cost

    const cost   = Number(m.cost ?? 0)   / SCALE;
    const payout = Number(r.payout ?? 0) / SCALE;
    const ts     = Number(r.checkpoint_timestamp_ms ?? r.expiry);

    roundTrips.push({
      day:       dayKey(ts),
      oracle_id: r.oracle_id,
      direction: r.is_up ? 'UP' : 'DOWN',
      strike:    priceToHuman(r.strike),
      qty:       Number(r.quantity) / SCALE,
      cost,
      payout,
      pnl:       payout - cost,
      won:       payout > cost,
      ts,
    });
  }

  // Group into per-day stats
  const byDay = new Map<string, RoundTrip[]>();
  for (const rt of roundTrips) {
    if (!byDay.has(rt.day)) byDay.set(rt.day, []);
    byDay.get(rt.day)!.push(rt);
  }

  const days: DayStats[] = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, trips]) => {
      const wins   = trips.filter(t => t.won).length;
      const losses = trips.length - wins;
      return {
        day,
        trades:       trips.length,
        wins,
        losses,
        win_rate:     trips.length ? wins / trips.length : 0,
        total_cost:   trips.reduce((s, t) => s + t.cost, 0),
        total_payout: trips.reduce((s, t) => s + t.payout, 0),
        net_pnl:      trips.reduce((s, t) => s + t.pnl, 0),
      };
    });

  // Totals
  const totalTrades = roundTrips.length;
  const totalWins   = roundTrips.filter(t => t.won).length;
  const totalPnl    = roundTrips.reduce((s, t) => s + t.pnl, 0);
  const openCount   = minted.length - redeemed.length;

  // ── Print table ──────────────────────────────────────────────────────────
  console.log('Day         Trades   W/L      Win%     Cost      Payout    Net P&L');
  console.log('─'.repeat(70));
  for (const d of days) {
    console.log(
      `${d.day}  ${String(d.trades).padStart(5)}   ` +
      `${d.wins}/${d.losses}`.padEnd(7) + '  ' +
      `${(d.win_rate * 100).toFixed(0).padStart(4)}%   ` +
      `${d.total_cost.toFixed(3).padStart(7)}   ` +
      `${d.total_payout.toFixed(3).padStart(7)}   ` +
      `${(d.net_pnl >= 0 ? '+' : '') + d.net_pnl.toFixed(3)}`,
    );
  }
  console.log('─'.repeat(70));

  console.log(`\nCompleted trades : ${totalTrades}  (${totalWins}W / ${totalTrades - totalWins}L)`);
  console.log(`Overall win rate : ${totalTrades ? (totalWins / totalTrades * 100).toFixed(1) : '—'}%  (breakeven ≈ 51.5%)`);
  console.log(`Net realized P&L : ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(4)} dUSDC`);
  console.log(`Open positions   : ${openCount} (awaiting settlement)`);

  const mgrBal = (summary?.balances.find(b => b.quote_asset.includes('dusdc'))?.balance ?? 0) / SCALE;
  console.log(`Manager balance  : ${summary ? mgrBal.toFixed(4) + ' dUSDC' : '(unavailable)'}`);

  // ── Save JSON for dashboard ────────────────────────────────────────────────
  const output = {
    generated_at:    new Date().toISOString(),
    total_trades:    totalTrades,
    total_wins:      totalWins,
    total_losses:    totalTrades - totalWins,
    overall_win_rate: totalTrades ? totalWins / totalTrades : 0,
    net_pnl:         totalPnl,
    open_positions:  openCount,
    breakeven_win_rate: 0.515,
    days,
    recent_trips:    roundTrips.sort((a, b) => b.ts - a.ts).slice(0, 30),
  };
  fs.mkdirSync('logs', { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nSaved → ${OUT_PATH}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
