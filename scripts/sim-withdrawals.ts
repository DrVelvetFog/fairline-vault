/** Complete the sim's withdrawal phase: 10 users withdraw ~40% of their tranche
 *  shares, with a gas budget that fits their post-deposit balance. */
import 'dotenv/config';
import * as fs from 'fs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { client } from '../src/wallet.js';
import { buildWithdrawSenior, buildWithdrawJunior, getVaultState } from '../src/vault.js';
import { FLP_S_TYPE, FLP_J_TYPE, dusdcToHuman } from '../src/config.js';

const isSenior = (i: number) => (i % 5) < 3;
const WITHDRAW_FRAC = 0.4;
const N = 10;

async function signExec(tx: Transaction, kp: Ed25519Keypair) {
  tx.setSender(kp.toSuiAddress());
  tx.setGasBudget(8_000_000);
  const r = await client.signAndExecuteTransaction({ transaction: tx, signer: kp, options: { showEffects: true } });
  await client.waitForTransaction({ digest: r.digest });
  if (r.effects?.status.status !== 'success') throw new Error(`tx failed: ${r.effects?.status.error}`);
}

async function main() {
  const wallets = JSON.parse(fs.readFileSync('logs/sim-wallets.json', 'utf-8'))
    .map((w: any) => Ed25519Keypair.fromSecretKey(w.secretKey));
  const idxs = [...Array(wallets.length).keys()].sort(() => Math.random() - 0.5).slice(0, N);
  console.log(`Withdrawing ~${WITHDRAW_FRAC * 100}% from ${N} users…`);
  for (const i of idxs) {
    const u = wallets[i];
    const addr = u.toSuiAddress();
    const sType = isSenior(i) ? FLP_S_TYPE : FLP_J_TYPE;
    const flp = (await client.getBalance({ owner: addr, coinType: sType })).totalBalance;
    const amt = (BigInt(flp) * BigInt(Math.round(WITHDRAW_FRAC * 100))) / 100n;
    if (amt === 0n) { console.log(`  user ${i + 1}: no shares, skip`); continue; }
    const coins = (await client.getCoins({ owner: addr, coinType: sType })).data;
    const tx = isSenior(i) ? buildWithdrawSenior(coins, amt, addr) : buildWithdrawJunior(coins, amt, addr);
    await signExec(tx, u);
    console.log(`  ✓ user ${i + 1} (${isSenior(i) ? 'senior' : 'junior'}) withdrew ${dusdcToHuman(amt).toFixed(2)}`);
  }
  const v = await getVaultState();
  console.log(`\nVault: NAV ${v.nav.toFixed(2)} | senior ${v.seniorValue.toFixed(2)} (${v.seniorShares.toFixed(2)} S) | junior ${v.juniorValue.toFixed(2)} (${v.juniorShares.toFixed(2)} J) | lifetime wd ${v.lifetimeWithdrawn.toFixed(2)}`);
}

main().catch(e => { console.error(String(e)); process.exit(1); });
