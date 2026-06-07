/** Sweep leftover SUI from the 50 sim wallets back to the operator (tests done). */
import 'dotenv/config';
import * as fs from 'fs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { client, getAddress } from '../src/wallet.js';

const RESERVE = 2_500_000n;   // leave 0.0025 SUI per wallet to pay its own sweep gas
const MIN = 4_000_000n;       // skip wallets with < 0.004 SUI

async function main() {
  const op = getAddress();
  const wallets: Ed25519Keypair[] = JSON.parse(fs.readFileSync('logs/sim-wallets.json', 'utf-8'))
    .map((w: any) => Ed25519Keypair.fromSecretKey(w.secretKey));

  const before = Number((await client.getBalance({ owner: op, coinType: '0x2::sui::SUI' })).totalBalance) / 1e9;
  console.log(`Operator SUI before: ${before.toFixed(4)}\nSweeping ${wallets.length} wallets…`);

  let swept = 0n, n = 0;
  for (const kp of wallets) {
    const addr = kp.toSuiAddress();
    const bal = BigInt((await client.getBalance({ owner: addr, coinType: '0x2::sui::SUI' })).totalBalance);
    if (bal <= MIN) continue;
    const send = bal - RESERVE;
    try {
      const tx = new Transaction();
      const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(send)]);
      tx.transferObjects([coin], op);
      tx.setSender(addr);
      tx.setGasBudget(2_000_000);
      const r = await client.signAndExecuteTransaction({ transaction: tx, signer: kp, options: { showEffects: true } });
      await client.waitForTransaction({ digest: r.digest });
      if (r.effects?.status.status === 'success') { swept += send; n++; }
    } catch { /* skip */ }
  }

  const after = Number((await client.getBalance({ owner: op, coinType: '0x2::sui::SUI' })).totalBalance) / 1e9;
  console.log(`\nSwept ~${(Number(swept) / 1e9).toFixed(4)} SUI from ${n} wallets.`);
  console.log(`Operator SUI after: ${after.toFixed(4)}`);
}

main().catch(e => { console.error(String(e)); process.exit(1); });
