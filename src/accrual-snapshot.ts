/**
 * Accrual snapshot — appends one data point capturing the house edge accruing
 * over time, for the dashboard's accrual chart. Run periodically (pm2 cron).
 *
 *   npm run snapshot
 */

import 'dotenv/config';
import * as fs from 'fs';
import { getPlpRate, getVaultState } from './vault.js';

const PATH = 'logs/accrual.jsonl';

async function main() {
  const [rate, v] = await Promise.all([getPlpRate(), getVaultState()]);
  const point = {
    ts: new Date().toISOString(),
    rate,                       // PLP redemption rate (house edge index)
    edge_pct: (rate - 1) * 100,
    vault_nav: v.nav,
    vault_tvl: v.nav,
    share_price: v.sharePrice,
  };
  fs.mkdirSync('logs', { recursive: true });
  fs.appendFileSync(PATH, JSON.stringify(point) + '\n');
  console.log('snapshot:', JSON.stringify(point));
}

main().catch(e => { console.error(String(e)); process.exit(1); });
