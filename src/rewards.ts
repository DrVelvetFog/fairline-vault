/**
 * House Flywheel — fund the predictor rebate pool from the house edge and
 * distribute rebates to predictors by their on-chain trading volume.
 *
 *   npx tsx src/rewards.ts status            # pool + predictor volume landscape
 *   npx tsx src/rewards.ts fund <dusdc>      # operator routes edge → pool
 *   npx tsx src/rewards.ts distribute <dusdc># pay rebates pro-rata to volume
 *
 * Rebate amounts are computed off-chain from public Predict trading volume; the
 * operator can only pay out what the on-chain pool holds (see rewards.move).
 */

import 'dotenv/config';
import { CoinStruct } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { client, getAddress, execute } from './wallet.js';
import { getDusdcCoins, splitDusdc } from './coins.js';
import { getManagers, getManagerPositions } from './indexer.js';
import {
  VAULT_PACKAGE_LATEST, REWARD_POOL, REWARD_ADMIN_CAP,
  DUSDC_TYPE, DUSDC_SCALE, MANAGER_ID, humanToDusdc, dusdcToHuman,
} from './config.js';

const RMOD = `${VAULT_PACKAGE_LATEST}::rewards`;
const MAX_MANAGERS = 60;   // cap enumeration for responsiveness

// ── Builders ──────────────────────────────────────────────────────────────────

/** Operator routes `amountRaw` dUSDC of house edge into the rebate pool. */
export function buildFundPool(coins: CoinStruct[], amountRaw: bigint): Transaction {
  const tx = new Transaction();
  const coin = splitDusdc(tx, coins, amountRaw);
  tx.moveCall({ target: `${RMOD}::fund`, typeArguments: [DUSDC_TYPE], arguments: [tx.object(REWARD_POOL), coin] });
  return tx;
}

/** Pay a batch of rebates from the pool in one PTB. */
export function buildRewardBatch(payouts: { recipient: string; amountRaw: bigint }[]): Transaction {
  const tx = new Transaction();
  for (const p of payouts) {
    tx.moveCall({
      target: `${RMOD}::reward`,
      typeArguments: [DUSDC_TYPE],
      arguments: [tx.object(REWARD_ADMIN_CAP), tx.object(REWARD_POOL), tx.pure.address(p.recipient), tx.pure.u64(p.amountRaw)],
    });
  }
  return tx;
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export interface RewardPoolState {
  balance: number;
  lifetimeFunded: number;
  lifetimeRebated: number;
  rebateCount: number;
}

export async function getRewardPool(): Promise<RewardPoolState> {
  const o = await client.getObject({ id: REWARD_POOL, options: { showContent: true } });
  const f: any = (o.data?.content as any)?.fields ?? {};
  const S = Number(DUSDC_SCALE);
  return {
    balance: Number(BigInt(f.balance ?? 0)) / S,
    lifetimeFunded: Number(BigInt(f.lifetime_funded ?? 0)) / S,
    lifetimeRebated: Number(BigInt(f.lifetime_rebated ?? 0)) / S,
    rebateCount: Number(BigInt(f.rebate_count ?? 0)),
  };
}

/** Aggregate predictor trading volume by owner from on-chain Predict positions. */
export async function getPredictorVolumes(): Promise<{ owner: string; volume: number }[]> {
  const managers = (await getManagers()).slice(0, MAX_MANAGERS);
  const byOwner = new Map<string, number>();
  for (const m of managers) {
    if (m.manager_id === MANAGER_ID) continue;          // exclude FairLine's own house manager
    try {
      const pos = await getManagerPositions(m.manager_id);
      const vol = pos.minted.reduce((s, p) => s + Number(p.quantity), 0);
      if (vol > 0) byOwner.set(m.owner, (byOwner.get(m.owner) ?? 0) + vol);
    } catch { /* skip unreadable managers */ }
  }
  return [...byOwner.entries()].map(([owner, volume]) => ({ owner, volume })).sort((a, b) => b.volume - a.volume);
}

/** Pro-rata rebate plan for a `budgetHuman` dUSDC distribution. */
export async function computeRebates(budgetHuman: number): Promise<{ recipient: string; volume: number; amountRaw: bigint }[]> {
  const vols = await getPredictorVolumes();
  const total = vols.reduce((s, v) => s + v.volume, 0);
  if (total === 0) return [];
  const budgetRaw = humanToDusdc(budgetHuman);
  return vols
    .map(v => ({ recipient: v.owner, volume: v.volume, amountRaw: (budgetRaw * BigInt(Math.floor(v.volume))) / BigInt(Math.floor(total)) }))
    .filter(r => r.amountRaw > 0n);
}

// ── CLI ─────────────────────────────────────────────────────────────────────
async function main() {
  const cmd = process.argv[2];
  const arg = Number(process.argv[3]);

  if (cmd === 'fund') {
    const op = getAddress();
    const tx = buildFundPool((await getDusdcCoins(op)).coins, humanToDusdc(arg));
    console.log(`Funding rebate pool ${arg} dUSDC…`);
    const r = await execute(tx);
    console.log(`  ✓ ${r.digest}`);
    console.log('Pool:', JSON.stringify(await getRewardPool()));
    return;
  }

  if (cmd === 'distribute') {
    const pool = await getRewardPool();
    const budget = Math.min(arg, pool.balance);
    const plan = await computeRebates(budget);
    if (plan.length === 0) { console.log('No external predictor volume found — nothing to distribute.'); return; }
    console.log(`Distributing ${budget.toFixed(2)} dUSDC across ${plan.length} predictors…`);
    plan.forEach(p => console.log(`  ${p.recipient.slice(0, 12)}… ← ${dusdcToHuman(p.amountRaw).toFixed(4)} dUSDC (vol ${p.volume})`));
    const r = await execute(buildRewardBatch(plan));
    console.log(`  ✓ ${r.digest}`);
    console.log('Pool:', JSON.stringify(await getRewardPool()));
    return;
  }

  if (cmd === 'daily') {
    // Autonomous daily flywheel turn: route a slice of house edge into the
    // pool, then rebate it to predictors pro-rata — the loop runs, not a demo.
    const amt = isNaN(arg) ? 1 : arg;
    const op = getAddress();
    console.log(`\n━━━ Flywheel daily turn — ${new Date().toISOString()} ━━━`);
    const f = await execute(buildFundPool((await getDusdcCoins(op)).coins, humanToDusdc(amt)));
    console.log(`  ✓ funded ${amt} dUSDC (edge → pool)  ${f.digest}`);
    const pool = await getRewardPool();
    const plan = await computeRebates(Math.min(amt, pool.balance));
    if (plan.length === 0) { console.log('  no external predictor volume — pool keeps the funding'); return; }
    const r = await execute(buildRewardBatch(plan));
    console.log(`  ✓ rebated ${Math.min(amt, pool.balance).toFixed(2)} dUSDC across ${plan.length} predictors (pool → traders)  ${r.digest}`);
    console.log('Pool:', JSON.stringify(await getRewardPool()));
    return;
  }

  // status
  const [pool, vols] = await Promise.all([getRewardPool(), getPredictorVolumes()]);
  console.log('\n━━━ House Flywheel ━━━');
  console.log(`Pool balance     : ${pool.balance.toFixed(2)} dUSDC`);
  console.log(`Lifetime funded  : ${pool.lifetimeFunded.toFixed(2)} | rebated ${pool.lifetimeRebated.toFixed(2)} (${pool.rebateCount} payouts)`);
  console.log(`Predictors w/ vol: ${vols.length}`);
  vols.slice(0, 8).forEach(v => console.log(`  ${v.owner.slice(0, 12)}… vol ${v.volume}`));
}

main().catch(e => { console.error(String(e)); process.exit(1); });
