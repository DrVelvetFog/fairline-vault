/**
 * Manual LP supply — deposit dUSDC from the Manager into PLP, receive PLP tokens.
 *
 * Safety: always devInspects the PTB first; only executes if it validates AND
 * the --execute flag is passed.
 *
 *   npm run lp-supply -- 200            # dry-run (devInspect only)
 *   npm run lp-supply -- 200 --execute  # live supply on testnet
 */

import 'dotenv/config';
import { buildSupplyFromManager } from './transactions.js';
import { getPlpCoins } from './coins.js';
import { getManagerSummary } from './indexer.js';
import { execute, inspect, getAddress } from './wallet.js';
import { MANAGER_ID, DUSDC_SCALE, humanToDusdc } from './config.js';

async function main() {
  const amountH  = Number(process.argv[2] ?? '200');
  const doExecute = process.argv.includes('--execute');
  const address  = getAddress();

  if (!MANAGER_ID) throw new Error('MANAGER_ID not set');
  if (!(amountH > 0)) throw new Error(`Invalid amount: ${process.argv[2]}`);

  console.log(`\n━━━ FairLine LP Supply ━━━`);
  console.log(`Mode    : ${doExecute ? 'LIVE 🔴' : 'DRY-RUN (devInspect) 🟡'}`);
  console.log(`Amount  : ${amountH} dUSDC  (Manager → PLP)\n`);

  const summary = await getManagerSummary(MANAGER_ID);
  const mgrRaw  = summary.balances.find(b => b.quote_asset.includes('dusdc'))?.balance ?? 0;
  console.log(`Manager balance : ${(mgrRaw / Number(DUSDC_SCALE)).toFixed(4)} dUSDC`);

  const plpBefore = (await getPlpCoins(address)).reduce((s, c) => s + Number(c.balance), 0) / Number(DUSDC_SCALE);
  console.log(`PLP before      : ${plpBefore.toFixed(4)} PLP`);

  const amountRaw = humanToDusdc(amountH);
  if (BigInt(Math.floor(mgrRaw)) < amountRaw) {
    throw new Error(`Manager balance ${(mgrRaw / Number(DUSDC_SCALE)).toFixed(4)} < ${amountH} dUSDC`);
  }

  const tx = buildSupplyFromManager(MANAGER_ID, amountRaw, address);

  // 1. Always validate first
  console.log(`\nValidating PTB via devInspect…`);
  const ins: any = await inspect(tx);
  const status = ins?.effects?.status?.status;
  console.log(`  devInspect: ${status} ${ins?.effects?.status?.error ?? ''}`);
  if (status !== 'success') { console.log('\n❌ Validation failed — not executing.'); process.exit(1); }

  if (!doExecute) {
    console.log('\n✓ PTB valid. Re-run with --execute to supply live.');
    return;
  }

  // 2. Execute live
  console.log(`\nExecuting live supply…`);
  const r = await execute(tx);
  console.log(`  ✓ tx digest: ${r.digest}`);

  // 3. Verify
  const plpAfter = (await getPlpCoins(address)).reduce((s, c) => s + Number(c.balance), 0) / Number(DUSDC_SCALE);
  console.log(`\nPLP after       : ${plpAfter.toFixed(4)} PLP  (+${(plpAfter - plpBefore).toFixed(4)})`);
  console.log(`\n━━━ done ━━━\n`);
}

main().catch(e => { console.error(String(e)); process.exit(1); });
