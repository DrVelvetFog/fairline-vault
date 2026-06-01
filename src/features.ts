/**
 * Compute market features from raw oracle price history.
 * These are the inputs fed to the hermes3 allocation model each cycle.
 */

import { OracleRecord, PriceEvent } from './indexer.js';
import { priceToHuman } from './config.js';

export interface MarketFeatures {
  // Oracle identity
  oracle_id:        string;
  underlying:       string;
  expiry_ms:        number;

  // Current price state
  spot_usd:         number;
  forward_usd:      number;
  min_strike_usd:   number;
  tick_usd:         number;

  // Time
  time_to_expiry_min: number;

  // Derived from price history (last ~20 events)
  realized_vol_pct:   number;   // annualized % vol from log returns
  price_trend:        'up' | 'down' | 'flat';
  price_change_pct:   number;   // % change over the price history window
  basis_bps:          number;   // (forward - spot) / spot in bps

  // Price history summary (for prompt context)
  price_high_usd:   number;
  price_low_usd:    number;
  n_prices:         number;
}

export function computeFeatures(
  oracle: OracleRecord,
  prices: PriceEvent[],
  latest: PriceEvent,
): MarketFeatures {
  const now = Date.now();
  const spot    = priceToHuman(latest.spot);
  const forward = priceToHuman(latest.forward);

  // Use last 20 price events, oldest-first
  const window = prices.slice(-20).sort((a, b) => a.checkpoint_timestamp_ms - b.checkpoint_timestamp_ms);

  // Realized vol from log returns of spot prices
  let realizedVol = 0;
  if (window.length >= 2) {
    const logReturns: number[] = [];
    for (let i = 1; i < window.length; i++) {
      const prev = priceToHuman(window[i - 1].spot);
      const curr = priceToHuman(window[i].spot);
      if (prev > 0 && curr > 0) logReturns.push(Math.log(curr / prev));
    }
    if (logReturns.length > 0) {
      const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
      const variance = logReturns.reduce((a, r) => a + (r - mean) ** 2, 0) / logReturns.length;
      const stdPerPeriod = Math.sqrt(variance);
      // Approximate: each price event ~30s apart → 2/min → 2*60*24*365 per year
      const periodsPerYear = 2 * 60 * 24 * 365;
      realizedVol = stdPerPeriod * Math.sqrt(periodsPerYear) * 100;
    }
  }

  // Price trend: compare first vs last in window
  const first = window.length > 0 ? priceToHuman(window[0].spot) : spot;
  const priceChangePct = first > 0 ? ((spot - first) / first) * 100 : 0;
  const trend: 'up' | 'down' | 'flat' =
    priceChangePct > 0.02 ? 'up' : priceChangePct < -0.02 ? 'down' : 'flat';

  // Price range
  const spots = window.map(p => priceToHuman(p.spot));
  const priceHigh = spots.length > 0 ? Math.max(...spots) : spot;
  const priceLow  = spots.length > 0 ? Math.min(...spots) : spot;

  // Basis
  const basisBps = spot > 0 ? ((forward - spot) / spot) * 10_000 : 0;

  return {
    oracle_id:           oracle.oracle_id,
    underlying:          oracle.underlying_asset,
    expiry_ms:           oracle.expiry,
    spot_usd:            spot,
    forward_usd:         forward,
    min_strike_usd:      priceToHuman(oracle.min_strike),
    tick_usd:            priceToHuman(oracle.tick_size),
    time_to_expiry_min:  (oracle.expiry - now) / 60_000,
    realized_vol_pct:    Math.round(realizedVol * 100) / 100,
    price_trend:         trend,
    price_change_pct:    Math.round(priceChangePct * 10_000) / 10_000,
    basis_bps:           Math.round(basisBps * 10) / 10,
    price_high_usd:      Math.round(priceHigh * 100) / 100,
    price_low_usd:       Math.round(priceLow * 100) / 100,
    n_prices:            window.length,
  };
}
