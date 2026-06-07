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
import { readGate, exposureFactor } from './gate.js';
import { getNearestActiveOracle, getPriceHistory, getLatestPrice } from './indexer.js';

export type PostureState = 'GREEN' | 'AMBER' | 'RED';

export interface Posture {
  state:        PostureState;
  label:        string;   // short human title
  description:  string;   // what the vault is doing and why
  color:        string;   // hex for UI accents
  vol:          number;   // realized vol % (annualized)
  lpFactor:     number;   // actual exposure factor in [0,1] (same as the trading loop)
  sleeveActive: boolean;  // is the directional sleeve armed this regime
  mlProbLarge:  number;   // P(large move) from the risk model
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
  // Smoothed, hysteretic regime (no chatter) + floored exposure (always earn some spread).
  const gate = readGate(vol);
  const state = gate.regime;
  const v = gate.smoothedVol;
  // Trim exposure when a large move is likely (the event that hurts the house).
  const mlAdjust = 1 - 0.5 * ml.probLarge;
  const lpFactor = exposureFactor(state, mlAdjust);
  const pct = Math.round(lpFactor * 100);

  let label: string;
  let description: string;
  if (state === 'RED') {
    label = 'Defensive floor';
    description =
      `Extreme volatility (${v.toFixed(1)}%). Exposure cut to a defensive floor ` +
      `(~${pct}% of target) — the house keeps earning the wide spread while the ` +
      `junior tranche absorbs the directional tail risk.`;
  } else if (state === 'AMBER') {
    label = 'Reduced';
    description =
      `Elevated volatility (${v.toFixed(1)}%). Liquidity reduced to ~${pct}% of ` +
      `target — the house earns the spread with less directional exposure.`;
  } else {
    label = 'Full house';
    description = `Calm markets (${v.toFixed(1)}%). Full liquidity provision at ~${pct}% of target.`;
  }

  return {
    state, label, description,
    color: COLORS[state],
    vol: v,
    lpFactor,
    sleeveActive: false,   // directional sleeve retired — the signal feeds the gate only
    mlProbLarge:  ml.probLarge,
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
