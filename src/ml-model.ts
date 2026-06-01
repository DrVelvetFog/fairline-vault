/**
 * Trained ML model — logistic regression for BTC settlement direction.
 *
 * Trained on 800 settled DeepBook Predict oracles (scripts/train_model.py).
 * CV accuracy: 59.1% vs 50% random baseline (+9.1pp edge).
 *
 * Input:  MarketFeatures from features.ts
 * Output: { direction, prob_up, confidence }
 *
 * Weights loaded from scripts/model_weights.json (exported by Python trainer).
 */

import { readFileSync } from 'fs';
import { MarketFeatures } from './features.js';

// ── Load weights ──────────────────────────────────────────────────────────────

interface ModelWeights {
  model_type:   string;
  features:     string[];
  cv_accuracy:  number;
  cv_std:       number;
  scaler_mean:  number[];
  scaler_scale: number[];
  coef:         number[];
  intercept:    number;
  trained_on:   number;
}

function loadWeights(): ModelWeights {
  try {
    const raw = readFileSync('scripts/model_weights.json', 'utf-8');
    return JSON.parse(raw) as ModelWeights;
  } catch {
    throw new Error('model_weights.json not found — run python3 scripts/train_model.py first');
  }
}

const WEIGHTS: ModelWeights = loadWeights();

// ── Inference ─────────────────────────────────────────────────────────────────

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

export interface MLPrediction {
  direction:  'up' | 'down' | 'uncertain';
  prob_up:    number;   // 0.0–1.0
  confidence: 'high' | 'medium' | 'low';
  cv_accuracy: number;  // model's cross-validated accuracy for display
}

/**
 * Extract the feature vector in the same order as training.
 * Must match FEATURES list in train_model.py exactly.
 */
function extractFeatureVector(f: MarketFeatures): number[] {
  // Cyclical encoding for hour/day
  const hourSin  = Math.sin(2 * Math.PI * f.hour_utc / 24);
  const hourCos  = Math.cos(2 * Math.PI * f.hour_utc / 24);
  const dowSin   = Math.sin(2 * Math.PI * f.day_of_week / 7);
  const dowCos   = Math.cos(2 * Math.PI * f.day_of_week / 7);

  // Vol regime ordinal: low=0, medium=1, high=2
  const volRegimeEnc = f.realized_vol_pct < 5 ? 0 : f.realized_vol_pct < 12 ? 1 : 2;

  // Interaction term: trend × (1 / vol) — strong trend + low vol = clearest signal
  const trendXVol = f.price_change_pct * (1 / (f.realized_vol_pct + 0.1));

  return [
    f.realized_vol_pct,   // realized_vol
    f.price_change_pct,   // trend_pct
    f.momentum_pct,       // momentum_pct
    f.range_pct,          // range_pct
    f.basis_bps,          // basis_bps
    f.time_to_expiry_min, // mins_to_expiry
    volRegimeEnc,         // vol_regime_enc
    hourSin,              // hour_sin
    hourCos,              // hour_cos
    dowSin,               // dow_sin
    dowCos,               // dow_cos
    trendXVol,            // trend_x_vol
  ];
}

export function predict(features: MarketFeatures): MLPrediction {
  const raw = extractFeatureVector(features);
  const w   = WEIGHTS;

  // Standardize: (x - mean) / scale
  const scaled = raw.map((x, i) => (x - w.scaler_mean[i]) / w.scaler_scale[i]);

  // Linear combination + intercept
  const z = scaled.reduce((sum, x, i) => sum + x * w.coef[i], 0) + w.intercept;

  // Sigmoid → probability of UP
  const prob_up = sigmoid(z);

  // Direction thresholds
  const HIGH_THRESHOLD   = 0.58;
  const MEDIUM_THRESHOLD = 0.54;

  let direction:  MLPrediction['direction']  = 'uncertain';
  let confidence: MLPrediction['confidence'] = 'low';

  if (prob_up >= HIGH_THRESHOLD) {
    direction = 'up'; confidence = 'high';
  } else if (prob_up >= MEDIUM_THRESHOLD) {
    direction = 'up'; confidence = 'medium';
  } else if (prob_up <= (1 - HIGH_THRESHOLD)) {
    direction = 'down'; confidence = 'high';
  } else if (prob_up <= (1 - MEDIUM_THRESHOLD)) {
    direction = 'down'; confidence = 'medium';
  }

  // Clamp display to [0.01, 0.99] — 100% signals extreme feature values, not certainty
  const prob_display = Math.min(0.99, Math.max(0.01, prob_up));
  return { direction, prob_up: Math.round(prob_display * 10000) / 10000, confidence, cv_accuracy: w.cv_accuracy };
}

/** Return a human-readable summary for the dashboard and hermes3 prompt. */
export function formatPrediction(p: MLPrediction): string {
  const pct = (p.prob_up * 100).toFixed(1);
  const dir = p.direction === 'uncertain'
    ? `uncertain (${pct}% UP probability)`
    : `${p.direction.toUpperCase()} (${pct}% UP probability, ${p.confidence} confidence)`;
  return `ML model: ${dir} [CV acc: ${(p.cv_accuracy * 100).toFixed(1)}%]`;
}
