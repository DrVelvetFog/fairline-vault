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
  hour_utc:           number;  // 0-23, UTC hour at entry
  day_of_week:        number;  // 0=Mon, 6=Sun

  // Derived from price history (last ~20 events)
  realized_vol_pct:   number;   // annualized % vol from log returns
  price_trend:        'up' | 'down' | 'flat';
  price_change_pct:   number;   // % change over the price history window
  momentum_pct:       number;   // second half mean vs first half mean
  range_pct:          number;   // (high-low)/mid over window
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

  // Realized vol from log returns of spot prices, using actual elapsed time
  let realizedVol = 0;
  if (window.length >= 2) {
    const logReturns: number[] = [];
    let totalMs = 0;
    for (let i = 1; i < window.length; i++) {
      const prev    = priceToHuman(window[i - 1].spot);
      const curr    = priceToHuman(window[i].spot);
      const dtMs    = window[i].checkpoint_timestamp_ms - window[i - 1].checkpoint_timestamp_ms;
      if (prev > 0 && curr > 0 && dtMs > 0) {
        logReturns.push(Math.log(curr / prev));
        totalMs += dtMs;
      }
    }
    if (logReturns.length > 0 && totalMs > 0) {
      const mean           = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
      const variance       = logReturns.reduce((a, r) => a + (r - mean) ** 2, 0) / logReturns.length;
      const stdPerPeriod   = Math.sqrt(variance);
      // Scale: avg period in years = (totalMs / logReturns.length) / msPerYear
      const msPerYear      = 365 * 24 * 60 * 60 * 1000;
      const avgPeriodYears = (totalMs / logReturns.length) / msPerYear;
      realizedVol = avgPeriodYears > 0 ? (stdPerPeriod / Math.sqrt(avgPeriodYears)) * 100 : 0;
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

  // Momentum: second-half mean vs first-half mean of entry window
  const mid         = Math.floor(window.length / 2);
  const firstHalf   = window.slice(0, mid);
  const secondHalf  = window.slice(mid);
  const firstMean   = firstHalf.reduce((a, b) => a + priceToHuman(b.spot), 0) / (firstHalf.length || 1);
  const secondMean  = secondHalf.reduce((a, b) => a + priceToHuman(b.spot), 0) / (secondHalf.length || 1);
  const momentumPct = firstMean > 0 ? ((secondMean - firstMean) / firstMean) * 100 : 0;

  // Price range
  const rangePct = spot > 0 ? ((priceHigh - priceLow) / spot) * 100 : 0;

  // Time context
  const entryDate  = new Date(window.length > 0 ? window[0].checkpoint_timestamp_ms : now);
  const hourUtc    = entryDate.getUTCHours();
  const dayOfWeek  = entryDate.getUTCDay() === 0 ? 6 : entryDate.getUTCDay() - 1; // 0=Mon

  return {
    oracle_id:           oracle.oracle_id,
    underlying:          oracle.underlying_asset,
    expiry_ms:           oracle.expiry,
    spot_usd:            spot,
    forward_usd:         forward,
    min_strike_usd:      priceToHuman(oracle.min_strike),
    tick_usd:            priceToHuman(oracle.tick_size),
    time_to_expiry_min:  (oracle.expiry - now) / 60_000,
    hour_utc:            hourUtc,
    day_of_week:         dayOfWeek,
    realized_vol_pct:    Math.round(realizedVol * 100) / 100,
    price_trend:         trend,
    price_change_pct:    Math.round(priceChangePct * 10_000) / 10_000,
    momentum_pct:        Math.round(momentumPct * 10_000) / 10_000,
    range_pct:           Math.round(rangePct * 10_000) / 10_000,
    basis_bps:           Math.round(basisBps * 10) / 10,
    price_high_usd:      Math.round(priceHigh * 100) / 100,
    price_low_usd:       Math.round(priceLow * 100) / 100,
    n_prices:            window.length,
  };
}
