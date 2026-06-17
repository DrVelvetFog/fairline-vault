/**
 * dApp judge-path smoke test. Exercises the exact deposit/withdraw moveCalls the
 * web/app dApp builds (mirrored by src/vault.ts), against the live testnet vault.
 *
 *   npx tsx scripts/dapp-smoke.ts            # devInspect all paths (no writes)
 *   npx tsx scripts/dapp-smoke.ts --execute  # + a real deposit→withdraw round-trip
 */
import { SuiClient, CoinStruct } from '@mysten/sui/client';
import { SUI_RPC_URL, DUSDC_TYPE, FLP_S_TYPE, FLP_J_TYPE, DUSDC_SCALE, VAULT_CAPACITY } from '../src/config.js';
import { getAddress, execute, inspect } from '../src/wallet.js';
import { getDusdcCoins } from '../src/coins.js';
import {
  buildDepositSenior, buildDepositJunior, buildWithdrawSenior, buildWithdrawJunior, getVaultState,
} from '../src/vault.js';

const client = new SuiClient({ url: SUI_RPC_URL });
const D = Number(DUSDC_SCALE);
const addr = getAddress();
const flpCoins = (t: string) => client.getCoins({ owner: addr, coinType: t }).then(r => r.data);

async function sim(name: string, txP: Promise<any> | any, expectAbort?: number): Promise<boolean> {
  const tx = await txP;
  const r: any = await inspect(tx);
  const ok = r?.effects?.status?.status === 'success';
  const err = r?.effects?.status?.error ?? '';
  if (expectAbort !== undefined) {
    const hit = !ok && err.includes(`, ${expectAbort})`) || err.includes(`abort_code: ${expectAbort}`) || (!ok && err.includes(String(expectAbort)));
    console.log(`  ${hit ? '✓' : '✗'} ${name}: ${ok ? 'UNEXPECTED success (guard missing!)' : 'aborted as expected → ' + err}`);
    return hit;
  }
  console.log(`  ${ok ? '✓' : '✗'} ${name}: ${ok ? 'devInspect success' : 'FAILED → ' + err}`);
  return ok;
}

(async () => {
  const exec = process.argv.includes('--execute');
  const v = await getVaultState();
  const headroom = VAULT_CAPACITY - v.nav;
  const [dusdc, sCoins, jCoins] = await Promise.all([getDusdcCoins(addr), flpCoins(FLP_S_TYPE), flpCoins(FLP_J_TYPE)]);
  console.log(`vault NAV ${v.nav.toFixed(2)}/${VAULT_CAPACITY} | reserve ${v.reserve.toFixed(2)} | deposit headroom ${headroom.toFixed(2)} | withdraw liq ${v.reserve.toFixed(2)}`);
  console.log(`operator: ${(Number(dusdc.totalRaw) / D).toFixed(2)} dUSDC, ${sCoins.length} FLP-S, ${jCoins.length} FLP-J\n`);

  const dcoins = dusdc.coins as CoinStruct[];
  const r1 = BigInt(5 * D);                // 5 dUSDC deposit
  const r2 = BigInt(1 * D);                // 1 share withdraw
  const over = BigInt(Math.ceil((headroom + 50) * D));  // > capacity headroom

  console.log('── happy paths (devInspect) ──');
  const results = [
    await sim('deposit_senior 5',  buildDepositSenior(dcoins, r1, addr)),
    await sim('deposit_junior 5',  buildDepositJunior(dcoins, r1, addr)),
    await sim('withdraw_senior 1', buildWithdrawSenior(sCoins, r2, addr)),
    await sim('withdraw_junior 1', buildWithdrawJunior(jCoins, r2, addr)),
  ];

  console.log('\n── capacity guard (devInspect) ──');
  const guard = await sim(`deposit_senior ${(Number(over) / D).toFixed(0)} (> headroom)`, buildDepositSenior(dcoins, over, addr), 4 /* ECapacityFull */);

  if (exec) {
    console.log('\n── real round-trip (execute) ──');
    const dep = await execute(buildDepositSenior(dcoins, r1, addr));
    console.log(`  deposit tx: ${dep.digest} (${dep.effects?.status?.status})`);
    await new Promise(r => setTimeout(r, 2500));
    const fresh = await flpCoins(FLP_S_TYPE);
    const got = fresh.reduce((s, c) => s + BigInt(c.balance), 0n);
    // withdraw exactly the ~5 shares just minted (senior price ≈1 so ≈5 FLP-S)
    const wd = await execute(buildWithdrawSenior(fresh, BigInt(Math.min(Number(got), 5 * D)), addr));
    console.log(`  withdraw tx: ${wd.digest} (${wd.effects?.status?.status})`);
    console.log(`  https://suiscan.xyz/testnet/tx/${dep.digest}\n  https://suiscan.xyz/testnet/tx/${wd.digest}`);
  }

  const allOk = results.every(Boolean) && guard;
  console.log(`\n${allOk ? '✅ ALL PATHS OK' : '⚠️  SOME PATHS FAILED — investigate above'}`);
  if (!exec) console.log('(devInspect only — add --execute for a real round-trip artifact)');
  process.exit(allOk ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
