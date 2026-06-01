/**
 * Step 1 of 5: Connect to Sui testnet and print the full state of one BTC Predict market.
 * Run with: npm run market
 */

import 'dotenv/config';
import { SuiClient } from '@mysten/sui/client';
import {
  SUI_RPC_URL,
  PREDICT_PACKAGE,
  PREDICT_OBJECT,
  PREDICT_REGISTRY,
  DUSDC_TYPE,
  PLP_TYPE,
  priceToHuman,
} from './config.js';
import { getActiveOracles, getLatestPrice, getNearestActiveOracle } from './indexer.js';

const client = new SuiClient({ url: SUI_RPC_URL });

async function printNetworkInfo() {
  const chainId = await client.getChainIdentifier();
  console.log(`\n--- Sui Testnet ---`);
  console.log(`Chain ID  : ${chainId}`);
}

async function printContractAddresses() {
  console.log(`\n--- Contract Addresses ---`);
  console.log(`Package   : ${PREDICT_PACKAGE}`);
  console.log(`Predict   : ${PREDICT_OBJECT}`);
  console.log(`Registry  : ${PREDICT_REGISTRY}`);
  console.log(`dUSDC     : ${DUSDC_TYPE}`);
  console.log(`PLP       : ${PLP_TYPE}`);
}

async function printVaultState() {
  const obj = await client.getObject({
    id: PREDICT_OBJECT,
    options: { showContent: true, showType: true },
  });

  console.log(`\n--- Vault State (on-chain) ---`);
  if (!obj.data) {
    console.log('Predict object not found.');
    return;
  }
  console.log(`Type      : ${obj.data.type}`);
  // Content is a Move struct — print fields if available
  const content = obj.data.content;
  if (content?.dataType === 'moveObject') {
    const fields = content.fields as Record<string, unknown>;
    console.log(`Trading paused : ${fields.trading_paused ?? 'N/A'}`);
  }
}

async function printActiveMarkets() {
  console.log(`\n--- Active BTC Markets ---`);
  const oracles = await getActiveOracles();
  const now = Date.now();
  const active = oracles.filter(o => o.expiry > now).sort((a, b) => a.expiry - b.expiry);

  for (const o of active.slice(0, 8)) {
    const minsToExpiry = ((o.expiry - now) / 60_000).toFixed(0);
    console.log(`  ${o.oracle_id.slice(0, 10)}…  +${minsToExpiry}min  status:${o.status}`);
  }
  if (active.length > 8) console.log(`  … and ${active.length - 8} more`);
  console.log(`  Total active: ${active.length}`);
}

async function printNearestMarketDetail() {
  const oracle = await getNearestActiveOracle();
  if (!oracle) {
    console.log('\nNo active oracle found.');
    return;
  }

  const price = await getLatestPrice(oracle.oracle_id);
  const now = Date.now();
  const minsToExpiry = ((oracle.expiry - now) / 60_000).toFixed(1);
  const spotUSD = priceToHuman(price.spot);
  const fwdUSD  = priceToHuman(price.forward);

  // Strike grid: 3 below ATM, 3 above (tick_size = 1e9 = $1)
  const tickRaw  = BigInt(oracle.tick_size);
  const minRaw   = BigInt(oracle.min_strike);
  const spotRaw  = BigInt(Math.round(spotUSD)) * 1_000_000_000n;
  const atkStrike = ((spotRaw - minRaw) / tickRaw) * tickRaw + minRaw;
  const strikes  = [-3n, -2n, -1n, 0n, 1n, 2n, 3n].map(d => atkStrike + d * tickRaw);

  console.log(`\n--- Nearest BTC Market ---`);
  console.log(`Oracle ID  : ${oracle.oracle_id}`);
  console.log(`Expiry     : ${new Date(oracle.expiry).toISOString()}  (in ${minsToExpiry} min)`);
  console.log(`Spot       : $${spotUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Forward    : $${fwdUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Min strike : $${priceToHuman(oracle.min_strike).toLocaleString()}`);
  console.log(`Tick size  : $${priceToHuman(oracle.tick_size)}`);
  console.log(`Updated    : ${new Date(price.checkpoint_timestamp_ms).toISOString()}`);

  console.log(`\n  Strike grid (7 around spot):`);
  for (const s of strikes) {
    const sUSD = priceToHuman(s);
    const label = s === atkStrike ? ' ← ATM' : '';
    console.log(`  $${sUSD.toLocaleString('en-US', { minimumFractionDigits: 0 })}${label}`);
  }
}

async function main() {
  console.log('FairLine — DeepBook Predict Vault');
  await printNetworkInfo();
  await printContractAddresses();
  await printVaultState();
  await printActiveMarkets();
  await printNearestMarketDetail();
  console.log('\nDone.');
}

main().catch(console.error);
