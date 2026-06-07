/** Probe DeepBook testnet: operator balances + SUI/DBUSDC pool mid price. */
import 'dotenv/config';
import { Transaction } from '@mysten/sui/transactions';
import { client, getAddress } from '../src/wallet.js';

const DEEPBOOK_PKG = '0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c';
const SUI_DBUSDC_POOL = '0x1c19362ca52b8ffd7a33cee805a67d40f31e6ba303753fd3a4cfdfacea7163a5';
const SUI = '0x2::sui::SUI';
const DBUSDC = '0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC';
const DEEP = '0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP';

async function bal(owner: string, type: string, scalar: number) {
  return Number((await client.getBalance({ owner, coinType: type })).totalBalance) / scalar;
}

async function main() {
  const op = getAddress();
  console.log('Operator:', op);
  console.log('  SUI   :', (await bal(op, SUI, 1e9)).toFixed(4));
  console.log('  DBUSDC:', (await bal(op, DBUSDC, 1e6)).toFixed(4));
  console.log('  DEEP  :', (await bal(op, DEEP, 1e6)).toFixed(4));

  // devInspect pool::mid_price<SUI,DBUSDC>(pool, clock) — free read
  const tx = new Transaction();
  tx.moveCall({
    target: `${DEEPBOOK_PKG}::pool::mid_price`,
    typeArguments: [SUI, DBUSDC],
    arguments: [tx.object(SUI_DBUSDC_POOL), tx.object('0x6')],
  });
  try {
    const r: any = await client.devInspectTransactionBlock({ transactionBlock: tx, sender: op });
    const rv = r?.results?.[0]?.returnValues?.[0];
    if (rv) {
      const raw = Buffer.from(rv[0]).readBigUInt64LE(0);
      // on-chain price units → human DBUSDC/SUI = raw * baseScalar / (FLOAT_SCALAR * quoteScalar) = raw / 1e6
      console.log(`\nSUI/DBUSDC pool LIVE — mid price raw ${raw} → ~${(Number(raw) / 1e6).toFixed(4)} DBUSDC/SUI`);
    } else {
      console.log('\nmid_price returned no value:', JSON.stringify(r?.error ?? r?.results));
    }
  } catch (e) {
    console.log('\nmid_price devInspect error:', String(e).slice(0, 200));
  }
}

main().catch(e => { console.error(String(e)); process.exit(1); });
