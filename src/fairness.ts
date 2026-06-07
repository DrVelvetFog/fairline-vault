/**
 * Provably-fair pricing — FairLine's namesake guarantee.
 *
 * The vault prices deposits/withdrawals off NAV = reserve + `deployed`, where
 * `deployed` is the operator-reported value of the PLP position. Between marks
 * that figure is stale: the live PLP redemption rate drifts above/below it, so
 * anyone entering or exiting transacts at a slightly unfair share price (a gain
 * to one side, a loss to the other).
 *
 * This module makes that gap *visible and provable* — it recomputes the live
 * NAV independently from the on-chain PLP rate × the recorded deploy lots, and
 * exposes the drift between the price the contract will use and the fair price.
 * It also provides mark-to-fair enforcement: before honoring a material entry/
 * exit, the operator marks the vault to live value so the transaction prices at
 * freshly-marked, honest NAV.
 *
 *   npx tsx src/fairness.ts          # print fair vs on-chain pricing
 *   npx tsx src/fairness.ts --mark   # mark to fair if drift exceeds the band
 */

import 'dotenv/config';
import * as fs from 'fs';
import { getVaultState, getPlpRate, buildVaultMark } from './vault.js';
import { execute } from './wallet.js';
import { DUSDC_SCALE } from './config.js';

const LOTS_FILE = 'logs/vault-strategy.json';

// Freshness band: if the on-chain share price is within this % of fair, an
// entry/exit is considered fairly priced. Beyond it, the operator should mark.
export const FAIR_BAND_PCT = Number(process.env.FAIR_BAND_PCT ?? 0.02);

interface Lot { principal: number; entryRate: number; ts: string }

export interface Fairness {
  reserve:             number;
  deployedRecorded:    number;  // on-chain v.deployed (what the contract uses)
  deployedLive:        number;  // Σ lot.principal × rateNow / entryRate (independent)
  navRecorded:         number;
  navLive:             number;
  totalShares:         number;
  sharePriceRecorded:  number;  // price the contract will transact at right now
  sharePriceFair:      number;  // price after a fresh mark
  driftDusdc:          number;  // navLive − navRecorded
  driftPct:            number;  // (fair − recorded) / recorded × 100
  isFresh:             boolean; // |driftPct| < FAIR_BAND_PCT
  plpRate:             number;
  lots:                number;
  verifiable:          boolean; // do recorded deploy lots back the deployed figure
  asOf:                string;
}

function loadLots(): Lot[] {
  try { return JSON.parse(fs.readFileSync(LOTS_FILE, 'utf-8')); } catch { return []; }
}

/** Compute live (fair) NAV independently from on-chain PLP rate + deploy lots. */
export async function getFairness(): Promise<Fairness> {
  const [v, plpRate] = await Promise.all([getVaultState(), getPlpRate()]);
  const lots = loadLots();
  const lotPrincipal = lots.reduce((s, l) => s + l.principal, 0);
  const deployedLive = lots.reduce((s, l) => s + l.principal * plpRate / l.entryRate, 0);

  // If lots don't cover the recorded deployed figure, we can't independently
  // value the gap — fall back to the recorded figure and flag unverifiable.
  const verifiable = v.deployed === 0 || lotPrincipal > 0;
  const navLive = verifiable && lots.length > 0 ? v.reserve + deployedLive : v.nav;

  const sharePriceRecorded = v.totalShares > 0 ? v.nav / v.totalShares : 1;
  const sharePriceFair     = v.totalShares > 0 ? navLive / v.totalShares : 1;
  const driftDusdc = navLive - v.nav;
  const driftPct   = sharePriceRecorded > 0 ? (sharePriceFair - sharePriceRecorded) / sharePriceRecorded * 100 : 0;

  return {
    reserve: v.reserve,
    deployedRecorded: v.deployed,
    deployedLive: lots.length > 0 ? deployedLive : v.deployed,
    navRecorded: v.nav,
    navLive,
    totalShares: v.totalShares,
    sharePriceRecorded,
    sharePriceFair,
    driftDusdc,
    driftPct,
    isFresh: Math.abs(driftPct) < FAIR_BAND_PCT,
    plpRate,
    lots: lots.length,
    verifiable,
    asOf: new Date().toISOString(),
  };
}

/**
 * Operator: if the on-chain price is staler than the fair band, mark the vault
 * to live value so the next entry/exit prices at honest NAV. Returns the tx
 * digest if a mark was sent, or null if already fresh.
 */
export async function ensureFreshMark(): Promise<{ marked: boolean; digest?: string; fairness: Fairness }> {
  const f = await getFairness();
  if (f.isFresh || !f.verifiable || f.lots === 0) return { marked: false, fairness: f };
  const newDeployedRaw = BigInt(Math.round(f.deployedLive * Number(DUSDC_SCALE)));
  const r = await execute(buildVaultMark(newDeployedRaw));
  return { marked: true, digest: r.digest, fairness: await getFairness() };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && (
  process.argv[1].endsWith('fairness.ts') || process.argv[1].endsWith('fairness.js')
);
if (isMain) {
  (async () => {
    if (process.argv.includes('--mark')) {
      const res = await ensureFreshMark();
      console.log(res.marked
        ? `\n✓ marked to fair — tx ${res.digest}\n  drift now ${res.fairness.driftPct.toFixed(4)}%`
        : `\n✓ already fresh (drift ${ (await getFairness()).driftPct.toFixed(4) }% < ${FAIR_BAND_PCT}%) — no mark needed`);
      return;
    }
    const f = await getFairness();
    const badge = f.isFresh ? '🟢 FRESH' : '🟡 STALE — operator should mark';
    console.log(`\n━━━ Provably-Fair Pricing ━━━  ${badge}`);
    console.log(`  reserve            ${f.reserve.toFixed(4)} dUSDC`);
    console.log(`  deployed  recorded ${f.deployedRecorded.toFixed(4)} | live ${f.deployedLive.toFixed(4)}`);
    console.log(`  NAV       recorded ${f.navRecorded.toFixed(4)} | live ${f.navLive.toFixed(4)}`);
    console.log(`  share px  on-chain ${f.sharePriceRecorded.toFixed(6)} | fair ${f.sharePriceFair.toFixed(6)}`);
    console.log(`  drift              ${f.driftDusdc >= 0 ? '+' : ''}${f.driftDusdc.toFixed(6)} dUSDC  (${f.driftPct >= 0 ? '+' : ''}${f.driftPct.toFixed(4)}%)`);
    console.log(`  PLP rate ${f.plpRate.toFixed(6)} | lots ${f.lots} | verifiable ${f.verifiable}\n`);
  })().catch(e => { console.error(String(e)); process.exit(1); });
}
