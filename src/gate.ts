/**
 * Risk gate — smoothed, hysteretic volatility regime + floored exposure.
 *
 * Fixes two issues found live: (1) the raw vol read flickers minute-to-minute
 * (10% → 53% → 43%), which whipsaws a sticky engine; (2) going fully flat in
 * high vol earns nothing. So we:
 *   • EWMA-smooth the vol and apply HYSTERESIS (enter a tighter regime at the
 *     threshold, only exit after a buffer) so the regime can't chatter;
 *   • keep an EXPOSURE FLOOR — even in the extreme regime we hold a defensive
 *     base position earning the (wide) spread; the junior tranche absorbs the
 *     directional tail risk.
 *
 * State advances on the decision cadence (the 60s watcher calls `updateGate`);
 * everything else (dashboard, vault engine) calls `readGate` — non-mutating.
 */
import * as fs from 'fs';
import { HIGH_VOL_THRESHOLD, EXTREME_VOL_THRESHOLD } from './config.js';

export type Regime = 'GREEN' | 'AMBER' | 'RED';
export interface GateState { smoothedVol: number; regime: Regime; ts: string }

const STATE_FILE = 'logs/gate-state.json';
const EWMA_ALPHA = 0.4;     // weight on the newest reading (lower = smoother)
const HYST = 5;             // % buffer to exit a tighter regime (anti-chatter)

// Exposure factor per regime (× ML adjust). RED is a FLOOR, not zero — always
// capture some spread. Tune these to trade edge capture vs drawdown.
const BASE: Record<Regime, number> = { GREEN: 1.0, AMBER: 0.6, RED: 0.42 };

function load(): GateState | null { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')); } catch { return null; } }
function save(s: GateState) { fs.mkdirSync('logs', { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

/** Hysteretic regime: harder to leave a tighter regime than to enter it. */
export function hystRegime(vol: number, prev: Regime | null): Regime {
  const hi = HIGH_VOL_THRESHOLD, ex = EXTREME_VOL_THRESHOLD;
  if (prev === 'RED')   return vol >= ex - HYST ? 'RED'   : (vol >= hi ? 'AMBER' : 'GREEN');
  if (prev === 'AMBER') return vol >= ex ? 'RED' : (vol >= hi - HYST ? 'AMBER' : 'GREEN');
  return vol >= ex ? 'RED' : vol >= hi ? 'AMBER' : 'GREEN';   // GREEN / first run
}

/** Advance the gate with a fresh raw vol reading (decision processes only). */
export function updateGate(rawVol: number): GateState {
  const prev = load();
  const smoothedVol = prev ? EWMA_ALPHA * rawVol + (1 - EWMA_ALPHA) * prev.smoothedVol : rawVol;
  const s: GateState = { smoothedVol, regime: hystRegime(smoothedVol, prev?.regime ?? null), ts: new Date().toISOString() };
  save(s);
  return s;
}

/** Read the current gate without mutating (dashboard / vault engine). Falls back
 * to the raw reading if no state has been written yet. */
export function readGate(rawVol: number): GateState {
  const prev = load();
  return prev ?? { smoothedVol: rawVol, regime: hystRegime(rawVol, null), ts: new Date().toISOString() };
}

/** Exposure factor in [floor, 1] — base by regime × ML adjust, never below floor. */
export function exposureFactor(regime: Regime, mlAdjust: number): number {
  const floor = BASE.RED * 0.7;   // hard floor even after a full ML trim
  return Math.max(floor, BASE[regime] * mlAdjust);
}
