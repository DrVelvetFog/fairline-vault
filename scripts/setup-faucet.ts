/**
 * One-time setup for the judge faucet — generates a SEPARATE, limited wallet
 * (the operator key never leaves this machine; blast radius = faucet balance)
 * and funds it from the operator.
 *
 *   npx tsx scripts/setup-faucet.ts [dusdc] [sui]     # default 300 dUSDC, 1.0 SUI
 *
 * Writes logs/faucet-wallet.json (gitignored). Set the key in Netlify with:
 *   npx netlify-cli env:set FAUCET_PRIVATE_KEY "$(jq -r .privateKey logs/faucet-wallet.json)"
 */
import 'dotenv/config';
import * as fs from 'fs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { getAddress, execute } from '../src/wallet.js';
import { getDusdcCoins, splitDusdc } from '../src/coins.js';
import { humanToDusdc } from '../src/config.js';

const OUT = 'logs/faucet-wallet.json';
const dusdcAmt = Number(process.argv[2] ?? 300);
const suiAmt = Number(process.argv[3] ?? 1.0);

async function main() {
  let kp: Ed25519Keypair;
  if (fs.existsSync(OUT)) {
    const saved = JSON.parse(fs.readFileSync(OUT, 'utf-8'));
    kp = Ed25519Keypair.fromSecretKey(saved.privateKey);
    console.log(`Using existing faucet wallet ${kp.toSuiAddress()}`);
  } else {
    kp = new Ed25519Keypair();
    fs.writeFileSync(OUT, JSON.stringify({
      address: kp.toSuiAddress(),
      privateKey: kp.getSecretKey(),
      createdAt: new Date().toISOString(),
    }, null, 2), { mode: 0o600 });
    console.log(`Generated faucet wallet ${kp.toSuiAddress()} → ${OUT}`);
  }
  const faucet = kp.toSuiAddress();
  const op = getAddress();

  const tx = new Transaction();
  const coins = await getDusdcCoins(op);
  const dusdc = splitDusdc(tx, coins.coins, humanToDusdc(dusdcAmt));
  const [sui] = tx.splitCoins(tx.gas, [tx.pure.u64(BigInt(Math.round(suiAmt * 1e9)))]);
  tx.transferObjects([dusdc, sui], faucet);
  const r = await execute(tx);
  console.log(`✓ Funded faucet with ${dusdcAmt} dUSDC + ${suiAmt} SUI — tx ${r.digest}`);
}

main().catch(e => { console.error(String(e)); process.exit(1); });
