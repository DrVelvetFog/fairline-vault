/**
 * Redemption-anchored settle — test harness.
 *
 *   npx tsx scripts/anchored-settle.ts                 # devInspect PREVIEW of a full anchor (deployed→0)
 *   npx tsx scripts/anchored-settle.ts --execute 200   # EXECUTE a controlled anchor: redeem ~200 dUSDC worth
 *
 * Always devInspects first and parses the on-chain `Settled` event so the exact,
 * chain-enforced `returned` amount is known before any write.
 */
import { Transaction } from '@mysten/sui/transactions';
import { SuiClient } from '@mysten/sui/client';
import { SUI_RPC_URL, DUSDC_SCALE } from '../src/config.js';
import { getAddress, execute } from '../src/wallet.js';
import { getPlpCoins } from '../src/coins.js';
import { getVaultState, getPlpRate, buildRedemptionAnchoredSettle } from '../src/vault.js';

const client = new SuiClient({ url: SUI_RPC_URL });
const D = Number(DUSDC_SCALE);

function findSettled(events: any[]): any | null {
  const e = (events ?? []).find(ev => String(ev.type).endsWith('::vault::Settled'));
  return e?.parsedJson ?? null;
}
const fmt = (raw: any) => (Number(raw) / D).toFixed(4);

(async () => {
  const exec = process.argv.includes('--execute');
  const valueArg = exec ? Number(process.argv[process.argv.indexOf('--execute') + 1]) : NaN;
  const addr = getAddress();

  const [rate, plpCoins, v0] = await Promise.all([getPlpRate(), getPlpCoins(addr), getVaultState()]);
  const plpUnitsRaw = plpCoins.reduce((s, c) => s + BigInt(c.balance), 0n);
  const plpValue = (Number(plpUnitsRaw) / D) * rate;

  // How much dUSDC value to realize this run, and the implied PLP units to redeem.
  const targetValue = exec && !Number.isNaN(valueArg) ? Math.min(valueArg, v0.deployed) : v0.deployed;
  const redeemPlpRaw = BigInt(Math.floor((targetValue / rate) * D));
  const newDeployedRaw = BigInt(Math.max(0, Math.round((v0.deployed - targetValue) * D)));

  console.log(`Operator ${addr}`);
  console.log(`PLP rate ${rate.toFixed(6)} | operator PLP ${(Number(plpUnitsRaw) / D).toFixed(2)} (=${plpValue.toFixed(2)} dUSDC)`);
  console.log(`vault: NAV ${v0.nav.toFixed(2)} | reserve ${v0.reserve.toFixed(2)} | deployed ${v0.deployed.toFixed(2)} | S ${v0.seniorValue.toFixed(2)} / J ${v0.juniorValue.toFixed(2)}`);
  console.log(`\nplan: realize ~${targetValue.toFixed(2)} dUSDC → redeem ${(Number(redeemPlpRaw) / D).toFixed(4)} PLP, set new_deployed=${(Number(newDeployedRaw) / D).toFixed(2)}`);
  if (redeemPlpRaw > plpUnitsRaw) { console.error('ABORT: redeem amount exceeds operator PLP'); process.exit(1); }

  const tx = buildRedemptionAnchoredSettle(plpCoins, redeemPlpRaw, newDeployedRaw);

  // ── always devInspect first ──
  const sim: any = await client.devInspectTransactionBlock({ transactionBlock: tx, sender: addr });
  const status = sim?.effects?.status?.status;
  console.log(`\ndevInspect: ${status} ${sim?.effects?.status?.error ?? ''}`);
  if (status !== 'success') { console.error('ABORT: devInspect failed'); process.exit(1); }
  const s = findSettled(sim.events);
  if (s) {
    const newNav = Number(s.nav) / D, realizedPnl = newNav - v0.nav;
    console.log('Settled (previewed):');
    console.log(`  returned (chain-enforced): ${fmt(s.returned)} dUSDC`);
    console.log(`  new_deployed             : ${fmt(s.new_deployed)}`);
    console.log(`  senior_value             : ${fmt(s.senior_value)}  (was ${v0.seniorValue.toFixed(4)})`);
    console.log(`  new NAV                  : ${newNav.toFixed(4)}  (was ${v0.nav.toFixed(4)} → realized P&L ${realizedPnl >= 0 ? '+' : ''}${realizedPnl.toFixed(4)})`);
    console.log(`  junior_value             : ${(newNav - Number(s.senior_value) / D).toFixed(4)}`);
  } else {
    console.log('  (no Settled event in devInspect — check event parsing)');
  }

  if (!exec) { console.log('\nPREVIEW only. Re-run with --execute <dUSDC> to write a controlled anchor.'); return; }

  // ── execute ──
  console.log('\nexecuting…');
  const r = await execute(tx);
  console.log('digest:', r.digest, '| status:', r.effects?.status?.status);
  const v1 = await getVaultState();
  console.log(`vault AFTER: NAV ${v1.nav.toFixed(2)} | reserve ${v1.reserve.toFixed(2)} | deployed ${v1.deployed.toFixed(2)} | S ${v1.seniorValue.toFixed(2)} / J ${v1.juniorValue.toFixed(2)}`);
  console.log(`NAV preserved? Δ ${(v1.nav - v0.nav).toFixed(4)} dUSDC | https://suiscan.xyz/testnet/tx/${r.digest}`);
})().catch(e => { console.error(e); process.exit(1); });
