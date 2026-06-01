/**
 * Redeem all settled positions for this manager.
 * Run after an oracle settles: npm run redeem
 */

import 'dotenv/config';
import { getSettledOracles, getManagerPositions, getManagerSummary } from './indexer.js';
import { buildRedeemPermissionless } from './transactions.js';
import { execute, getAddress } from './wallet.js';
import { MANAGER_ID, DUSDC_SCALE } from './config.js';

async function main() {
  console.log('\n━━━ FairLine — Redeem Settled Positions ━━━\n');

  const address  = getAddress();
  const summary  = await getManagerSummary(MANAGER_ID);

  console.log('Manager:', MANAGER_ID);
  console.log('Awaiting settlement:', summary.awaiting_settlement_positions);
  console.log('Open positions     :', summary.open_positions);

  if (summary.awaiting_settlement_positions === 0 && summary.open_positions === 0) {
    console.log('\nNo positions to redeem.');
    return;
  }

  const positions = await getManagerPositions(MANAGER_ID);
  console.log(`\nPositions found: ${positions.length}`);

  // Cross-reference against settled oracles
  const settled = await getSettledOracles();
  const settledIds = new Set(settled.map(o => o.oracle_id));

  let redeemed = 0;
  for (const pos of positions) {
    if (!settledIds.has(pos.oracle_id)) {
      console.log(`  ${pos.oracle_id.slice(0,12)}… not yet settled — skip`);
      continue;
    }

    console.log(`  Redeeming ${pos.quantity} units at oracle ${pos.oracle_id.slice(0,12)}…`);
    try {
      const tx     = buildRedeemPermissionless(
        MANAGER_ID, pos.oracle_id, BigInt(pos.expiry),
        BigInt(pos.strike), pos.is_up, BigInt(pos.quantity),
      );
      const result = await execute(tx);
      console.log(`  ✅ ${result.digest}`);
      redeemed++;
    } catch (e) {
      console.error(`  ❌ Failed: ${String(e).slice(0, 120)}`);
    }
  }

  console.log(`\nRedeemed ${redeemed} position(s).`);

  await new Promise(r => setTimeout(r, 2000));
  const after = await getManagerSummary(MANAGER_ID);
  const bal   = (after.balances.find(b => b.quote_asset.includes('dusdc'))?.balance ?? 0) / Number(DUSDC_SCALE);
  const pnl   = after.realized_pnl / Number(DUSDC_SCALE);
  console.log(`\nManager balance  : ${bal.toFixed(6)} dUSDC`);
  console.log(`Realized P&L     : ${pnl >= 0 ? '+' : ''}${pnl.toFixed(6)} dUSDC`);
}

main().catch(e => { console.error(e); process.exit(1); });
