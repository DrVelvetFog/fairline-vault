/**
 * Vault posture — the depositor-facing risk state of the FairLine house.
 *
 * FairLine is the *house* of a prediction market: it earns the spread by
 * supplying PLP, and its only real risk is a large directional move. The bot
 * therefore gates exposure on realized volatility (see computeLpExposureFactor
 * in cycle.ts). Most vaults hide this; FairLine surfaces it as a single,
 * honest signal so depositors can see *why* their exposure changed.
 *
 *   GREEN  — calm:     full liquidity provision; directional sleeve armed.
 *   AMBER  — elevated: liquidity reduced (~60%), sleeve idle, earning spread only.
 *   RED    — extreme:  liquidity pulled to reserve, out of harm's way.
 *
 * This module is the single source of truth for that mapping. It reads the same
 * vol/ML inputs the trading loop uses, so the banner never disagrees with the bot.
 *
 *   npx tsx src/posture.ts        # print the live posture
 */

import { computeFeatures } from './features.js';
import { predict as mlPredict, MLPrediction } from './ml-model.js';
import { computeLpExposureFactor } from './cycle.js';
import { getNearestActiveOracle, getPriceHistory, getLatestPrice } from './indexer.js';
import { HIGH_VOL_THRESHOLD, EXTREME_VOL_THRESHOLD } from './config.js';

export type PostureState = 'GREEN' | 'AMBER' | 'RED';

export interface Posture {
  state:        PostureState;
  label:        string;   // short human title
  description:  string;   // what the vault is doing and why
  color:        string;   // hex for UI accents
  vol:          number;   // realized vol % (annualized)
  lpFactor:     number;   // actual exposure factor in [0,1] (same as the trading loop)
  sleeveActive: boolean;  // is the directional sleeve armed this regime
  mlDirection:  MLPrediction['direction'];
  mlConfidence: MLPrediction['confidence'];
  asOf:         string;   // ISO timestamp
}

const COLORS: Record<PostureState, string> = {
  GREEN: '#30a46c',
  AMBER: '#ffb224',
  RED:   '#e5484d',
};

/**
 * Pure classification — maps the live vol + ML signal onto a depositor-facing
 * posture. Thresholds are the same ones the trading loop gates on (config.ts),
 * so the banner and the bot can never drift apart.
 */
export function classifyPosture(vol: number, ml: MLPrediction): Posture {
  const lpFactor = computeLpExposureFactor(vol, ml);
  // Sleeve arms on the same condition as the cycle (calm + high ML conviction).
  const sleeveActive = vol < HIGH_VOL_THRESHOLD && ml.confidence === 'high';

  let state: PostureState;
  let label: string;
  let description: string;

  if (vol >= EXTREME_VOL_THRESHOLD) {
    state = 'RED';
    label = 'De-risked';
    description =
      `Extreme volatility (${vol.toFixed(1)}%). The vault has pulled liquidity ` +
      `out of harm's way — capital sits in reserve until markets calm. No new ` +
      `house exposure.`;
  } else if (vol >= HIGH_VOL_THRESHOLD) {
    state = 'AMBER';
    label = 'Defensive';
    description =
      `Elevated volatility (${vol.toFixed(1)}%). Liquidity provision is reduced to ` +
      `~${Math.round(lpFactor * 100)}% of target and the directional sleeve is idle — ` +
      `the house is earning spread only.`;
  } else {
    state = 'GREEN';
    label = 'Full house';
    description =
      `Calm markets (${vol.toFixed(1)}%). Full liquidity provision at ` +
      `~${Math.round(lpFactor * 100)}% of target; directional sleeve is ` +
      `${sleeveActive ? 'armed (calm + high-confidence signal)' : 'on standby'}.`;
  }

  return {
    state, label, description,
    color: COLORS[state],
    vol,
    lpFactor,
    sleeveActive,
    mlDirection:  ml.direction,
    mlConfidence: ml.confidence,
    asOf: new Date().toISOString(),
  };
}

/** Fetch live market data and return the current vault posture. */
export async function getLivePosture(): Promise<Posture> {
  const oracle = await getNearestActiveOracle();
  if (!oracle) throw new Error('No active oracle found');
  const [prices, latest] = await Promise.all([
    getPriceHistory(oracle.oracle_id),
    getLatestPrice(oracle.oracle_id),
  ]);
  const features = computeFeatures(oracle, prices, latest);
  return classifyPosture(features.realized_vol_pct, mlPredict(features));
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && (
  process.argv[1].endsWith('posture.ts') || process.argv[1].endsWith('posture.js')
);
if (isMain) {
  getLivePosture()
    .then(p => {
      const dot = p.state === 'GREEN' ? '🟢' : p.state === 'AMBER' ? '🟡' : '🔴';
      console.log(`\n${dot}  VAULT POSTURE: ${p.state} — ${p.label}`);
      console.log(`    vol ${p.vol.toFixed(2)}%  |  exposure ${(p.lpFactor * 100).toFixed(0)}%  |  sleeve ${p.sleeveActive ? 'armed' : 'idle'}`);
      console.log(`    ${p.description}\n`);
    })
    .catch(e => { console.error(String(e)); process.exit(1); });
}
