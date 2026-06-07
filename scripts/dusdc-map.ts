/** One-off: map where all the dUSDC lives across operator, vault, depositors, PLP. */
import 'dotenv/config';
import * as fs from 'fs';
import { client } from '../src/wallet.js';
import { getVaultState, getPlpRate } from '../src/vault.js';
import { getDusdcCoins } from '../src/coins.js';
import { DUSDC_TYPE, FLP_TYPE, PLP_TYPE, WALLET_ADDRESS } from '../src/config.js';

const fmt = (n: number) => n.toFixed(2).padStart(12);

async function bal(owner: string, type: string) {
  return Number((await client.getBalance({ owner, coinType: type })).totalBalance) / 1e6;
}

async function main() {
  const op = WALLET_ADDRESS;
  let bob: string | null = null;
  try { bob = JSON.parse(fs.readFileSync('logs/demo-wallet.json', 'utf-8')).address; } catch {}

  const vault = await getVaultState();
  const plpRate = await getPlpRate();

  const opDusdc = (await getDusdcCoins(op)).totalHuman;
  const opFlp = await bal(op, FLP_TYPE);
  const opPlp = await bal(op, PLP_TYPE);
  const opPlpVal = opPlp * plpRate;
  const opSui = Number((await client.getBalance({ owner: op, coinType: '0x2::sui::SUI' })).totalBalance) / 1e9;

  console.log('\n━━━━━━━━━━━━━━━ dUSDC MAP (testnet) ━━━━━━━━━━━━━━━\n');
  console.log('VAULT OBJECT (on-chain accounting):');
  console.log(`  reserve (idle dUSDC held by vault) : ${fmt(vault.reserve)}`);
  console.log(`  deployed (reported out to strategy): ${fmt(vault.deployed)}`);
  console.log(`  NAV (reserve + deployed)          : ${fmt(vault.nav)}`);
  console.log(`  FLP shares outstanding            : ${fmt(vault.totalShares)}`);
  console.log(`  share price (NAV/shares)          : ${vault.sharePrice.toFixed(6)}`);
  console.log(`  lifetime deposited / withdrawn    : ${vault.lifetimeDeposited.toFixed(2)} / ${vault.lifetimeWithdrawn.toFixed(2)}`);

  console.log('\nOPERATOR / ALICE wallet:', op);
  console.log(`  loose dUSDC (not in vault)        : ${fmt(opDusdc)}`);
  console.log(`  FLP shares held                   : ${fmt(opFlp)}`);
  console.log(`  PLP tokens held                   : ${fmt(opPlp)}  (~${opPlpVal.toFixed(2)} dUSDC @ rate ${plpRate.toFixed(6)})`);
  console.log(`  SUI (gas)                         : ${opSui.toFixed(4)}`);

  if (bob) {
    const bobDusdc = (await getDusdcCoins(bob)).totalHuman;
    const bobFlp = await bal(bob, FLP_TYPE);
    const bobSui = Number((await client.getBalance({ owner: bob, coinType: '0x2::sui::SUI' })).totalBalance) / 1e9;
    console.log('\nBOB (demo depositor):', bob);
    console.log(`  loose dUSDC                       : ${fmt(bobDusdc)}`);
    console.log(`  FLP shares held                   : ${fmt(bobFlp)}`);
    console.log(`  SUI (gas)                         : ${bobSui.toFixed(4)}`);
  }

  const totalKnown = vault.reserve + opDusdc + opPlpVal;
  console.log('\n━━━━━━━━━━━━━━━ TOTALS ━━━━━━━━━━━━━━━');
  console.log(`  vault reserve + op loose + op PLP : ${totalKnown.toFixed(2)} dUSDC`);
  console.log(`  (PLP val is the real home of "deployed" capital)`);
  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });
