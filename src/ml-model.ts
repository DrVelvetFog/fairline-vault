/**
 * Trained ML risk model — logistic regression forecasting a LARGE BTC settlement
 * move, i.e. P(|move| > threshold). Reframed from direction (which the spread
 * beats) to the event that actually threatens the house, and fed into the
 * defensive risk gate. CV ROC-AUC ~0.80 vs 0.5 random.
 *
 * Input:  MarketFeatures from features.ts
 * Output: { probLarge, confidence, cvAuc, thresholdPct }
 *
 * Weights loaded from scripts/model_weights.json (exported by train_model.py).
 */

import { readFileSync } from 'fs';
import { MarketFeatures } from './features.js';

interface ModelWeights {
  model_type:    string;
  objective?:    string;
  threshold_pct?: number;
  base_rate?:    number;
  features:      string[];
  cv_auc?:       number;
  cv_accuracy:   number;
  scaler_mean:   number[];
  scaler_scale:  number[];
  coef:          number[];
  intercept:     number;
  trained_on:    number;
}

function loadWeights(): ModelWeights {
  try {
    return JSON.parse(readFileSync('scripts/model_weights.json', 'utf-8')) as ModelWeights;
  } catch {
    throw new Error('model_weights.json not found — run python3 scripts/train_model.py first');
  }
}

const WEIGHTS: ModelWeights = loadWeights();

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

export interface MLPrediction {
  probLarge:   number;   // P(|settlement move| > threshold) — 0..1
  confidence:  'high' | 'medium' | 'low';  // strength of the large-move signal
  cvAuc:       number;   // model's cross-validated ROC-AUC for display
  thresholdPct: number;  // the "large move" threshold (%)
}

/** Feature vector in the same order as train_model.py's FEATURES. */
function extractFeatureVector(f: MarketFeatures): number[] {
  const hourSin = Math.sin(2 * Math.PI * f.hour_utc / 24);
  const hourCos = Math.cos(2 * Math.PI * f.hour_utc / 24);
  const dowSin  = Math.sin(2 * Math.PI * f.day_of_week / 7);
  const dowCos  = Math.cos(2 * Math.PI * f.day_of_week / 7);
  const volRegimeEnc = f.realized_vol_pct < 5 ? 0 : f.realized_vol_pct < 12 ? 1 : 2;
  const trendXVol = f.price_change_pct * (1 / (f.realized_vol_pct + 0.1));
  return [
    f.realized_vol_pct, f.price_change_pct, f.momentum_pct, f.range_pct, f.basis_bps,
    f.time_to_expiry_min, volRegimeEnc, hourSin, hourCos, dowSin, dowCos, trendXVol,
  ];
}

export function predict(features: MarketFeatures): MLPrediction {
  const w = WEIGHTS;
  const raw = extractFeatureVector(features);
  const scaled = raw.map((x, i) => (x - w.scaler_mean[i]) / w.scaler_scale[i]);
  const z = scaled.reduce((sum, x, i) => sum + x * w.coef[i], 0) + w.intercept;
  const probLarge = sigmoid(z);

  const strength = Math.abs(probLarge - 0.5) * 2;   // 0 (uncertain) .. 1 (decisive)
  const confidence: MLPrediction['confidence'] = strength >= 0.5 ? 'high' : strength >= 0.25 ? 'medium' : 'low';

  return {
    probLarge: Math.min(0.99, Math.max(0.01, Math.round(probLarge * 10000) / 10000)),
    confidence,
    cvAuc: w.cv_auc ?? w.cv_accuracy,
    thresholdPct: w.threshold_pct ?? 0.1,
  };
}

/** Human-readable summary for the dashboard / logs. */
export function formatPrediction(p: MLPrediction): string {
  return `ML risk model: P(large move >${p.thresholdPct}%) = ${(p.probLarge * 100).toFixed(0)}% (${p.confidence}) [CV AUC ${p.cvAuc.toFixed(2)}]`;
}
