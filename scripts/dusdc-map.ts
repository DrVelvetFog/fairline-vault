/**
 * Map where all the dUSDC lives — tranched-vault edition.
 *
 *   npx tsx scripts/dusdc-map.ts
 *
 * Covers: the vault's on-chain books (tranches, capacity), the operator
 * (loose, PLP, gas) with a vault-backing coverage check, the demo + faucet
 * wallets, the flywheel reward pool, and non-operator depositors in aggregate.
 */
import 'dotenv/config';
import * as fs from 'fs';
import { client } from '../src/wallet.js';
import { getVaultState, getPlpRate } from '../src/vault.js';
import { getDusdcCoins } from '../src/coins.js';
import { DUSDC_TYPE, FLP_S_TYPE, FLP_J_TYPE, PLP_TYPE, WALLET_ADDRESS, REWARD_POOL, DUSDC_SCALE } from '../src/config.js';

const fmt = (n: number) => n.toFixed(2).padStart(12);
const SUI = '0x2::sui::SUI';

async function bal(owner: string, type: string, scale = 1e6) {
  return Number((await client.getBalance({ owner, coinType: type })).totalBalance) / scale;
}
function savedAddr(file: string): string | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')).address; } catch { return null; }
}

async function main() {
  const op = WALLET_ADDRESS;
  const bob = savedAddr('logs/demo-wallet.json');
  const faucet = savedAddr('logs/faucet-wallet.json');

  const [vault, plpRate] = await Promise.all([getVaultState(), getPlpRate()]);

  const [opDusdc, opS, opJ, opPlp, opSui] = await Promise.all([
    getDusdcCoins(op).then(c => c.totalHuman),
    bal(op, FLP_S_TYPE), bal(op, FLP_J_TYPE), bal(op, PLP_TYPE), bal(op, SUI, 1e9),
  ]);
  const opPlpVal = opPlp * plpRate;

  console.log('\n━━━━━━━━━━━━━━━ dUSDC MAP (testnet, tranched) ━━━━━━━━━━━━━━━\n');
  console.log('VAULT OBJECT (on-chain accounting):');
  console.log(`  reserve (idle, withdrawable)      : ${fmt(vault.reserve)}`);
  console.log(`  deployed (out to strategy)        : ${fmt(vault.deployed)}`);
  console.log(`  NAV (reserve + deployed)          : ${fmt(vault.nav)}  (${vault.pctFull.toFixed(1)}% of ${vault.capacity} cap)`);
  console.log(`  senior  ${fmt(vault.seniorValue)} dUSDC | ${vault.seniorShares.toFixed(2)} FLP-S @ ${vault.seniorPrice.toFixed(6)}`);
  console.log(`  junior  ${fmt(vault.juniorValue)} dUSDC | ${vault.juniorShares.toFixed(2)} FLP-J @ ${vault.juniorPrice.toFixed(6)}`);
  console.log(`  lifetime deposited / withdrawn    : ${vault.lifetimeDeposited.toFixed(2)} / ${vault.lifetimeWithdrawn.toFixed(2)}`);

  console.log('\nOPERATOR wallet:', op);
  console.log(`  loose dUSDC (not in vault)        : ${fmt(opDusdc)}`);
  console.log(`  PLP held                          : ${fmt(opPlp)} units (~${opPlpVal.toFixed(2)} dUSDC @ rate ${plpRate.toFixed(6)})`);
  console.log(`  FLP-S / FLP-J held                : ${opS.toFixed(2)} / ${opJ.toFixed(2)}`);
  console.log(`  SUI (gas)                         : ${opSui.toFixed(4)}`);
  const coverage = vault.deployed > 0 ? opPlpVal / vault.deployed : Infinity;
  console.log(`  vault-backing check               : PLP value ${opPlpVal.toFixed(2)} vs vault deployed claim ${vault.deployed.toFixed(2)} → ${coverage >= 1 ? '✓ covered' : '⚠️ SHORT'} (${(coverage * 100).toFixed(1)}%)`);

  if (bob) {
    const [d, s, j, g] = await Promise.all([bal(bob, DUSDC_TYPE), bal(bob, FLP_S_TYPE), bal(bob, FLP_J_TYPE), bal(bob, SUI, 1e9)]);
    console.log('\nBOB (demo depositor):', bob);
    console.log(`  dUSDC ${d.toFixed(2)} | FLP-S ${s.toFixed(2)} | FLP-J ${j.toFixed(2)} | SUI ${g.toFixed(4)}`);
  }

  if (faucet) {
    const [d, g] = await Promise.all([bal(faucet, DUSDC_TYPE), bal(faucet, SUI, 1e9)]);
    console.log('\nJUDGE FAUCET:', faucet);
    console.log(`  dUSDC ${d.toFixed(2)} (${Math.floor(d / 10)} claims left) | SUI ${g.toFixed(4)}`);
  }

  const pool = await client.getObject({ id: REWARD_POOL, options: { showContent: true } });
  const pf: any = (pool.data?.content as any)?.fields ?? {};
  const poolBal = Number(BigInt(pf.balance ?? 0)) / Number(DUSDC_SCALE);
  console.log('\nFLYWHEEL REWARD POOL:', REWARD_POOL.slice(0, 16) + '…');
  console.log(`  balance ${poolBal.toFixed(2)} | lifetime funded ${(Number(BigInt(pf.lifetime_funded ?? 0)) / 1e6).toFixed(2)} / rebated ${(Number(BigInt(pf.lifetime_rebated ?? 0)) / 1e6).toFixed(2)} (${pf.rebate_count} payouts)`);

  // Non-operator depositors, in aggregate (sim wallets + anyone from the dApp).
  const extS = vault.seniorShares - opS - 0;
  const extJ = vault.juniorShares - opJ - 0;
  console.log('\nOTHER DEPOSITORS (aggregate = outstanding − operator):');
  console.log(`  FLP-S ${extS.toFixed(2)} (~${(extS * vault.seniorPrice).toFixed(2)} dUSDC) | FLP-J ${extJ.toFixed(2)} (~${(extJ * vault.juniorPrice).toFixed(2)} dUSDC)`);

  console.log('\n━━━━━━━━━━━━━━━ TOTALS ━━━━━━━━━━━━━━━');
  console.log(`  vault reserve + op loose + op PLP : ${(vault.reserve + opDusdc + opPlpVal).toFixed(2)} dUSDC`);
  console.log(`  (op PLP backs the vault's ${vault.deployed.toFixed(2)} deployed claim; the excess is the operator's own house position)`);
  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });
