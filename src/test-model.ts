import 'dotenv/config';
import { decide } from './model.js';

const ctx = {
  features: {
    oracle_id: '0xcdf5a5fe',
    underlying: 'BTC',
    expiry_ms: Date.now() + 13 * 60_000,
    spot_usd: 71207.86,
    forward_usd: 71205.12,
    min_strike_usd: 50000,
    tick_usd: 1,
    time_to_expiry_min: 13.0,
    realized_vol_pct: 6.49,
    price_trend: 'up' as const,
    price_change_pct: 0.0412,
    basis_bps: -0.4,
    price_high_usd: 71250.00,
    price_low_usd: 71140.00,
    n_prices: 18,
  },
  balance_usdc: 100.0,
  realized_pnl: -1.03,
  recent_history: '',
};

console.log('Calling hermes3 with 100 dUSDC simulated balance...\n');
const d = await decide(ctx);
console.log('Decision:');
console.log(JSON.stringify(d, null, 2));
