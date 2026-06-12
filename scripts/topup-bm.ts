/**
 * Top up the DeepBook BalanceManager so the CLOB maker can quote both sides.
 *
 *   npx tsx scripts/topup-bm.ts            # report balances only
 *   DO=1 npx tsx scripts/topup-bm.ts       # deposit SUI + swap SUI→DEEP + deposit DEEP
 *
 * Env: TOPUP_SUI (default 8) SUI deposited straight into the BM,
 *      SWAP_SUI  (default 6) SUI swapped to DEEP on the whitelisted pool, then deposited.
 */
import { Transaction } from '@mysten/sui/transactions';
import { getAddress, client, execute } from '../src/wallet.js';
import {
  DEEPBOOK_PKG, POOL, BASE, QUOTE,
  loadBM, buildDepositSui, readBmSui, readBmDeep, readMid,
} from '../src/deepbook.js';

const BASE_SCALAR = 1e6;   // DEEP decimals
const QUOTE_SCALAR = 1e9;  // SUI decimals
const CLOCK = '0x6';

const addr = getAddress();
const bm = loadBM();
if (!bm) throw new Error('no BalanceManager recorded (logs/balance-manager.json)');

const [walletSui, walletDeep, bmSui, bmDeep, mid] = await Promise.all([
  client.getBalance({ owner: addr, coinType: QUOTE }).then(b => Number(b.totalBalance) / QUOTE_SCALAR),
  client.getBalance({ owner: addr, coinType: BASE }).then(b => Number(b.totalBalance) / BASE_SCALAR),
  readBmSui(bm, addr),
  readBmDeep(bm, addr),
  readMid(addr),
]);
console.log(`wallet  ${walletSui.toFixed(3)} SUI · ${walletDeep.toFixed(2)} DEEP`);
console.log(`BM      ${bmSui.toFixed(3)} SUI · ${bmDeep.toFixed(2)} DEEP   (mid ${mid ?? '—'} SUI/DEEP)`);

if (!process.env.DO) { console.log('\nreport only — rerun with DO=1 to top up'); process.exit(0); }

const topupSui = Number(process.env.TOPUP_SUI ?? 8);
const swapSui = Number(process.env.SWAP_SUI ?? 6);
if (walletSui < topupSui + swapSui + 0.5) {
  throw new Error(`wallet has ${walletSui.toFixed(2)} SUI — need ~${topupSui + swapSui + 0.5} (faucet the operator address first)`);
}

// 1) straight SUI deposit
console.log(`\ndepositing ${topupSui} SUI into BM…`);
const r1 = await execute(buildDepositSui(bm, topupSui));
console.log('  tx', r1.digest);

// 2) swap SUI→DEEP on the whitelisted pool (zero-DEEP fee), deposit DEEP in the same PTB
if (!mid) throw new Error('no mid price — cannot size the swap');
const slack = Number(process.env.SLACK ?? 0.8);
const minOut = BigInt(Math.floor((swapSui / mid) * slack * BASE_SCALAR)); // slippage guard
console.log(`swapping ${swapSui} SUI → DEEP (min ${Number(minOut) / BASE_SCALAR} DEEP) + depositing…`);
const tx = new Transaction();
const [quoteIn] = tx.splitCoins(tx.gas, [tx.pure.u64(BigInt(Math.round(swapSui * QUOTE_SCALAR)))]);
const zeroDeep = tx.moveCall({ target: '0x2::coin::zero', typeArguments: [BASE] });
const [baseOut, quoteRem, deepRem] = tx.moveCall({
  target: `${DEEPBOOK_PKG}::pool::swap_exact_quote_for_base`,
  typeArguments: [BASE, QUOTE],
  arguments: [tx.object(POOL), quoteIn, zeroDeep, tx.pure.u64(minOut), tx.object(CLOCK)],
});
tx.moveCall({ target: `${DEEPBOOK_PKG}::balance_manager::deposit`, typeArguments: [BASE], arguments: [tx.object(bm), baseOut] });
tx.transferObjects([quoteRem, deepRem], addr);
const r2 = await execute(tx);
console.log('  tx', r2.digest);

const [sui2, deep2] = await Promise.all([readBmSui(bm, addr), readBmDeep(bm, addr)]);
console.log(`\nBM now  ${sui2.toFixed(3)} SUI · ${deep2.toFixed(2)} DEEP`);
