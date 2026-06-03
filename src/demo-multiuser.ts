/**
 * Multi-user demo — proves FairLine Vault works with a distinct second depositor
 * and that funds can be withdrawn (full lifecycle), all on-chain.
 *
 *   npm run demo-multiuser
 *
 * 1. Generates/loads a second wallet "Bob" (logs/demo-wallet.json, gitignored).
 * 2. Operator funds Bob with dUSDC + a little SUI for gas.
 * 3. Bob deposits dUSDC → FLP shares (a genuinely separate depositor).
 * 4. Bob withdraws part of his shares → dUSDC (proves funds aren't trapped).
 */

import 'dotenv/config';
import * as fs from 'fs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { client, getAddress, execute } from './wallet.js';
import { getDusdcCoins } from './coins.js';
import { buildVaultDeposit, buildVaultWithdraw, getVaultState } from './vault.js';
import { DUSDC_TYPE, FLP_TYPE, humanToDusdc } from './config.js';

const WALLET_FILE = 'logs/demo-wallet.json';
const DEPOSIT = 50;     // dUSDC Bob deposits
const WITHDRAW_FLP = 20; // FLP Bob redeems
const GAS_SUI = 50_000_000; // 0.05 SUI to Bob for gas

function loadBob(): Ed25519Keypair {
  try {
    const sk = JSON.parse(fs.readFileSync(WALLET_FILE, 'utf-8')).secretKey;
    return Ed25519Keypair.fromSecretKey(sk);
  } catch {
    const kp = Ed25519Keypair.generate();
    fs.mkdirSync('logs', { recursive: true });
    fs.writeFileSync(WALLET_FILE, JSON.stringify({ secretKey: kp.getSecretKey(), address: kp.toSuiAddress() }, null, 2));
    return kp;
  }
}

async function signExec(tx: Transaction, kp: Ed25519Keypair): Promise<string> {
  tx.setSender(kp.toSuiAddress());
  tx.setGasBudget(15_000_000);
  const r = await client.signAndExecuteTransaction({ transaction: tx, signer: kp, options: { showEffects: true } });
  await client.waitForTransaction({ digest: r.digest });
  if (r.effects?.status.status !== 'success') throw new Error(`tx failed: ${r.effects?.status.error}`);
  return r.digest;
}

async function bobDusdc(bob: string) {
  return (await getDusdcCoins(bob)).coins;
}

async function main() {
  const op = getAddress();
  const bob = loadBob();
  const bobAddr = bob.toSuiAddress();
  console.log(`\n━━━ FairLine Multi-User Demo ━━━`);
  console.log(`Operator (Alice): ${op}`);
  console.log(`Second depositor (Bob): ${bobAddr}\n`);
  console.log('Vault before:', JSON.stringify(await getVaultState()));

  const heldFlp = Number((await client.getBalance({ owner: bobAddr, coinType: FLP_TYPE })).totalBalance) / 1e6;

  if (heldFlp < DEPOSIT) {
    // 1. Fund Bob with dUSDC + SUI (one PTB, operator-signed).
    const opCoins = await getDusdcCoins(op);
    const fund = new Transaction();
    const [dusdcOut] = fund.splitCoins(fund.object(opCoins.coins[0].coinObjectId), [fund.pure.u64(humanToDusdc(DEPOSIT))]);
    const [suiOut] = fund.splitCoins(fund.gas, [fund.pure.u64(GAS_SUI)]);
    fund.transferObjects([dusdcOut, suiOut], bobAddr);
    console.log(`\n[1] Funding Bob ${DEPOSIT} dUSDC + 0.05 SUI… tx ${await execute(fund).then(r => r.digest)}`);

    // 2. Bob deposits → FLP.
    const bobCoins = await bobDusdc(bobAddr);
    const depTx = buildVaultDeposit(bobCoins, humanToDusdc(DEPOSIT), bobAddr);
    console.log(`[2] Bob deposits ${DEPOSIT} dUSDC → FLP… tx ${await signExec(depTx, bob)}`);
    const flp = await client.getBalance({ owner: bobAddr, coinType: FLP_TYPE });
    console.log(`    Bob now holds ${(Number(flp.totalBalance) / 1e6).toFixed(2)} FLP`);
    console.log('    Vault:', JSON.stringify(await getVaultState()));
  } else {
    console.log(`\n[1–2] Bob already holds ${heldFlp.toFixed(2)} FLP — skipping fund/deposit.`);
  }

  // 3. Bob withdraws part of his shares → dUSDC (lifecycle proof).
  const flpCoins = (await client.getCoins({ owner: bobAddr, coinType: FLP_TYPE })).data;
  const wTx = buildVaultWithdraw(flpCoins, humanToDusdc(WITHDRAW_FLP), bobAddr);
  console.log(`\n[3] Bob withdraws ${WITHDRAW_FLP} FLP → dUSDC… tx ${await signExec(wTx, bob)}`);
  const bobD = await getDusdcCoins(bobAddr);
  const flp2 = await client.getBalance({ owner: bobAddr, coinType: FLP_TYPE });
  console.log(`    Bob now: ${(Number(bobD.totalRaw) / 1e6).toFixed(2)} dUSDC + ${(Number(flp2.totalBalance) / 1e6).toFixed(2)} FLP`);
  console.log('    Vault after:', JSON.stringify(await getVaultState()));
  console.log('\n━━━ done — vault now has 2 depositors (Alice + Bob) ━━━\n');
}

main().catch(e => { console.error(String(e)); process.exit(1); });
