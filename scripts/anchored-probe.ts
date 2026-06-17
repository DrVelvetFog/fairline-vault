/**
 * Pre-flight probe for redemption-anchored settle.
 * Reads (no writes): rate-limiter headroom, operator PLP value vs vault.deployed,
 * current PLP rate, vault state, operator gas. Decides redeem-all vs partial.
 *   Run: npx tsx scripts/anchored-probe.ts
 */
import { Transaction } from '@mysten/sui/transactions';
import { SuiClient } from '@mysten/sui/client';
import {
  SUI_RPC_URL, PREDICT_PACKAGE, PREDICT_OBJECT, DUSDC_TYPE, DUSDC_SCALE,
} from '../src/config.js';
import { getAddress } from '../src/wallet.js';
import { getPlpCoins } from '../src/coins.js';
import { getVaultState, getPlpRate } from '../src/vault.js';

const client = new SuiClient({ url: SUI_RPC_URL });
const CLOCK = '0x6';
const D = Number(DUSDC_SCALE);

async function inspectU64(tx: Transaction, sender: string): Promise<bigint | null> {
  const r: any = await client.devInspectTransactionBlock({ transactionBlock: tx, sender });
  if (r?.effects?.status?.status !== 'success') {
    console.log('  devInspect error:', r?.effects?.status?.error ?? JSON.stringify(r?.error));
  }
  const rv = r?.results?.[0]?.returnValues?.[0];
  return rv ? Buffer.from(rv[0]).readBigUInt64LE(0) : null;
}

(async () => {
  const addr = getAddress();
  console.log('Operator:', addr, '\n');

  // 1. Rate-limiter headroom
  const tx = new Transaction();
  tx.moveCall({
    target: `${PREDICT_PACKAGE}::predict::available_withdrawal`,
    arguments: [tx.object(PREDICT_OBJECT), tx.object(CLOCK)],
  });
  const availRaw = await inspectU64(tx, addr);
  const avail = availRaw === null ? null : Number(availRaw) / D;
  console.log('available_withdrawal :', avail === null ? 'NULL (read failed)' : avail.toFixed(2) + ' dUSDC');

  // 2. Operator PLP holdings -> value at current rate
  const rate = await getPlpRate();
  const plpCoins = await getPlpCoins(addr);
  const plpUnits = plpCoins.reduce((s, c) => s + BigInt(c.balance), 0n);
  const plpValue = (Number(plpUnits) / D) * rate;
  console.log('PLP rate (dUSDC/PLP):', rate.toFixed(6), `(house edge ${((rate - 1) * 100).toFixed(3)}%)`);
  console.log('operator PLP coins   :', plpCoins.length, '→', (Number(plpUnits) / D).toFixed(4), 'PLP →', plpValue.toFixed(2), 'dUSDC value');

  // 3. Vault state
  const v = await getVaultState();
  console.log('\nvault NAV            :', v.nav.toFixed(2), 'dUSDC');
  console.log('  reserve            :', v.reserve.toFixed(2));
  console.log('  deployed (reported):', v.deployed.toFixed(2));
  console.log('  senior / junior    :', v.seniorValue.toFixed(2), '/', v.juniorValue.toFixed(2));

  // 4. Gas
  const bal = await client.getBalance({ owner: addr });
  console.log('\noperator SUI gas     :', (Number(bal.totalBalance) / 1e9).toFixed(4), 'SUI');

  // 5. Decision
  const deployed = v.deployed;
  console.log('\n── decision ──');
  console.log('PLP value vs vault.deployed:', plpValue.toFixed(2), 'vs', deployed.toFixed(2),
    Math.abs(plpValue - deployed) < 0.05 * Math.max(deployed, 1) ? '(≈ match → operator PLP ≈ vault capital)' : '(MISMATCH → commingled, redeem only deployed-worth)');
  if (avail !== null) {
    console.log('rate-limiter allows full redeem of deployed?', avail >= deployed ? 'YES' : `NO — cap ${avail.toFixed(2)} < deployed ${deployed.toFixed(2)} → partial`);
  }
})().catch(e => { console.error(e); process.exit(1); });
