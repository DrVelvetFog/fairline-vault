/**
 * Vault earning engine — makes depositor capital actually earn the house edge.
 *
 * Posture-gated and **sticky** (consistent with FairLine's LP philosophy): each
 * cycle it deploys idle vault reserve toward a risk-scaled PLP target when the
 * regime allows, holds otherwise (never force-exits / thrashes), and marks NAV to
 * the live PLP value so the gains flow into the senior/junior share prices.
 *
 *   target_deployed = NAV × LP_TARGET_PCT × posture.lpFactor   (capped at MAX_PLP)
 *   🟢 Green  → ~70% deployed   🟡 Amber → reduced   🔴 Red → 0 (hold, don't add)
 *
 *   npx tsx src/vault-engine.ts        # run one cycle
 */
import 'dotenv/config';
import * as fs from 'fs';
import { getAddress, execute } from './wallet.js';
import { getLivePosture } from './posture.js';
import { getVaultState, getPlpRate, buildVaultDeployToPlp } from './vault.js';
import { ensureFreshMark } from './fairness.js';
import { LP_TARGET_PCT, MAX_PLP_DUSDC, humanToDusdc } from './config.js';

const LOTS = 'logs/vault-strategy.json';
const BAND = 20;        // min deploy delta (dUSDC) — avoid dust churn
const MIN_RESERVE = 5;  // keep a little reserve for instant withdrawals

interface Lot { principal: number; entryRate: number; ts: string }
const loadLots = (): Lot[] => { try { return JSON.parse(fs.readFileSync(LOTS, 'utf-8')); } catch { return []; } };
const saveLots = (l: Lot[]) => { fs.mkdirSync('logs', { recursive: true }); fs.writeFileSync(LOTS, JSON.stringify(l, null, 2)); };

async function run() {
  const op = getAddress();
  const [posture, v, rate] = await Promise.all([getLivePosture(), getVaultState(), getPlpRate()]);

  const target = Math.min(v.nav * LP_TARGET_PCT * posture.lpFactor, MAX_PLP_DUSDC, v.nav);
  const delta = target - v.deployed;
  console.log(`\n━━━ Vault engine — ${new Date().toISOString()} ━━━`);
  console.log(`posture ${posture.state} (factor ${posture.lpFactor.toFixed(2)}) | NAV ${v.nav.toFixed(2)} | deployed ${v.deployed.toFixed(2)} | reserve ${v.reserve.toFixed(2)}`);
  console.log(`target deployed ${target.toFixed(2)} → delta ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`);

  // Sticky: only add toward target when calm; never force-exit on the downside.
  const deployable = Math.min(delta, v.reserve - MIN_RESERVE);
  if (delta > BAND && deployable >= BAND) {
    console.log(`→ deploying ${deployable.toFixed(2)} dUSDC of vault reserve into PLP (the house)…`);
    const r = await execute(buildVaultDeployToPlp(humanToDusdc(deployable), op));
    const lots = loadLots();
    lots.push({ principal: deployable, entryRate: rate, ts: new Date().toISOString() });
    saveLots(lots);
    console.log(`  ✓ ${r.digest}  (now earning the house edge for depositors)`);
  } else {
    console.log(delta <= BAND ? '→ at/above target — holding (sticky, no force-exit)' : '→ reserve too thin to add — holding');
  }

  // Always mark accrued PLP gains into NAV → lifts senior/junior share prices.
  const m = await ensureFreshMark();
  console.log(m.marked ? `→ marked gains to NAV (tx ${m.digest})` : `→ NAV already fresh (drift ${m.fairness.driftPct.toFixed(4)}%)`);

  const after = await getVaultState();
  console.log(`Result: deployed ${after.deployed.toFixed(2)} | senior px ${after.seniorPrice.toFixed(6)} | junior px ${after.juniorPrice.toFixed(6)}\n`);
}

run().catch(e => { console.error(String(e)); process.exit(1); });
