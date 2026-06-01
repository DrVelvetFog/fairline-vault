/**
 * First live trade — runs the moment dUSDC arrives.
 *
 * Sequence:
 *   1. Check wallet has dUSDC
 *   2. devInspect deposit+mint to confirm PTB structure with real coins
 *   3. If inspect passes, execute deposit + mint (LIVE)
 *   4. Wait for settlement, then redeem
 *   5. Print all tx digests (proof of end-to-end execution)
 *
 * Run: npm run first-trade
 */

import 'dotenv/config';
import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  getNearestActiveOracle, getLatestPrice, getManagerSummary,
} from './indexer.js';
import { getDusdcCoins, formatBalance } from './coins.js';
import { buildDepositAndMint, buildGetTradeAmounts } from './transactions.js';
import { execute, inspect, getAddress, client } from './wallet.js';
import {
  MANAGER_ID, DUSDC_SCALE, humanToDusdc, priceToHuman, WALLET_PRIVATE_KEY,
} from './config.js';

const TRADE_QTY_USDC = 2; // start small: 2 dUSDC max payout

async function main() {
  console.log('\n━━━ FairLine — First Live Trade ━━━\n');

  // 1. Wallet check
  const address = getAddress();
  console.log('Wallet:', address);

  const dusdc = await getDusdcCoins(address);
  const sui   = await client.getBalance({ owner: address });

  console.log('SUI   :', (Number(sui.totalBalance) / 1e9).toFixed(4), 'SUI');
  console.log('dUSDC :', formatBalance(dusdc));

  if (dusdc.coins.length === 0) {
    console.log('\n⏳ No dUSDC yet — check back after tokens arrive.');
    process.exit(0);
  }
  if (dusdc.totalRaw < humanToDusdc(TRADE_QTY_USDC)) {
    console.log(`\n❌ Need at least ${TRADE_QTY_USDC} dUSDC, have ${dusdc.totalHuman.toFixed(4)}`);
    process.exit(1);
  }

  // 2. Pick nearest oracle with ≥ 5 min to expiry
  const oracle = await getNearestActiveOracle();
  if (!oracle) { console.log('No active oracle'); process.exit(1); }

  const minsLeft = (oracle.expiry - Date.now()) / 60_000;
  if (minsLeft < 5) {
    console.log(`Oracle expires in ${minsLeft.toFixed(1)} min — too soon, wait for next cycle`);
    process.exit(0);
  }

  const price     = await getLatestPrice(oracle.oracle_id);
  const spot      = priceToHuman(price.spot);
  const atmStrike = BigInt(Math.round(spot)) * 1_000_000_000n;
  const expiry    = BigInt(oracle.expiry);
  const qty       = humanToDusdc(TRADE_QTY_USDC);

  console.log(`\nOracle : ${oracle.oracle_id.slice(0, 14)}…`);
  console.log(`Expiry : ${minsLeft.toFixed(1)} min`);
  console.log(`Spot   : $${spot.toFixed(2)}`);
  console.log(`Strike : $${Math.round(spot)} (ATM UP)`);
  console.log(`Qty    : ${TRADE_QTY_USDC} dUSDC max payout\n`);

  // 3. Preview cost via devInspect
  console.log('Previewing trade cost…');
  const previewTx = buildGetTradeAmounts(oracle.oracle_id, expiry, atmStrike, true, qty);
  const preview   = await inspect(previewTx) as any;
  const tradeVals = preview?.results?.[1]?.returnValues ?? [];

  if (tradeVals.length >= 2) {
    const costRaw   = Buffer.from(tradeVals[0][0]).readBigUInt64LE(0);
    const payoutRaw = Buffer.from(tradeVals[1][0]).readBigUInt64LE(0);
    const costH     = Number(costRaw) / Number(DUSDC_SCALE);
    const askPct    = Number(costRaw) / Number(qty) * 100;
    console.log(`  Cost   : ${costH.toFixed(4)} dUSDC`);
    console.log(`  Ask    : ${askPct.toFixed(2)}% (probability BTC > $${Math.round(spot)})`);
    console.log(`  Payout : ${Number(payoutRaw) / Number(DUSDC_SCALE)} dUSDC if wins\n`);
  }

  // 4. devInspect the actual deposit+mint PTB with real coins
  console.log('Validating deposit+mint PTB with real coins…');
  const mintTx = buildDepositAndMint(
    MANAGER_ID, dusdc.coins, qty, oracle.oracle_id, expiry, atmStrike, true, qty,
  );
  const mintInspect = await inspect(mintTx) as any;
  const mintStatus  = mintInspect?.effects?.status?.status;
  const mintErr     = mintInspect?.effects?.status?.error ?? '';
  console.log(`  devInspect: ${mintStatus} ${mintErr ? '— ' + mintErr.slice(0, 100) : ''}`);

  if (mintStatus !== 'success') {
    console.log('\n❌ PTB validation failed — do not execute. Error:', mintErr);
    process.exit(1);
  }

  // 5. Execute live
  console.log('\n✅ PTB validated. Executing live deposit + mint…');
  const result = await execute(mintTx);

  console.log('\n━━━ TRADE EXECUTED ━━━');
  console.log('Tx digest :', result.digest);
  console.log('Explorer  : https://suiexplorer.com/txblock/' + result.digest + '?network=testnet');

  // 6. Manager summary post-trade
  await new Promise(r => setTimeout(r, 2000));
  const summary = await getManagerSummary(MANAGER_ID);
  const bal     = (summary.balances.find(b => b.quote_asset.includes('dusdc'))?.balance ?? 0) / Number(DUSDC_SCALE);
  console.log('\nManager after trade:');
  console.log('  Balance     :', bal.toFixed(6), 'dUSDC');
  console.log('  Open pos    :', summary.open_positions);
  console.log('\nWait for oracle to settle, then run: npm run redeem');
  console.log(`Oracle settles at: ${new Date(oracle.expiry).toISOString()}`);
}

main().catch(e => { console.error(e); process.exit(1); });
