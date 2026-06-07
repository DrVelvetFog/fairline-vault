/**
 * FairLine Vault — PTB builders + reads for the on-chain TRANCHED share vault.
 *
 *   deposit_senior  (user)     dUSDC  → FLP-S shares (protected tranche)
 *   deposit_junior  (user)     dUSDC  → FLP-J shares (first-loss, leveraged)
 *   withdraw_senior (user)     FLP-S  → dUSDC (pro-rata of senior value)
 *   withdraw_junior (user)     FLP-J  → dUSDC (pro-rata of junior value)
 *   deploy   (operator) move idle reserve out to run the LP strategy
 *   settle   (operator) return capital + report deployed value (runs waterfall)
 *   mark     (operator) mark-to-market deployed value (runs waterfall, stamps time)
 *
 * settle/mark now take the Clock (0x6): the contract splits the marked P&L
 * between tranches (senior up to its target, junior the rest / first loss) and
 * records `marked_at` for provable freshness.
 */

import { CoinStruct } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { client } from './wallet.js';
import { splitDusdc } from './coins.js';
import {
  VAULT_PACKAGE_LATEST, VAULT_OBJECT, VAULT_ADMIN_CAP, DUSDC_TYPE, DUSDC_SCALE,
  VAULT_CAPACITY, PREDICT_PACKAGE, PREDICT_OBJECT,
} from './config.js';

// Function calls target the latest (upgraded) package id; the Vault/FLP types
// are still identified by the original publish id.
const MOD = `${VAULT_PACKAGE_LATEST}::vault`;
const CLOCK = '0x6';

/**
 * Operator: deploy `amountRaw` of vault reserve directly into DeepBook Predict
 * PLP in one atomic PTB (vault.deploy → predict.supply → PLP to operator).
 */
export function buildVaultDeployToPlp(amountRaw: bigint, sender: string): Transaction {
  const tx = new Transaction();
  const coin = tx.moveCall({
    target: `${MOD}::deploy`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(VAULT_ADMIN_CAP), tx.object(VAULT_OBJECT), tx.pure.u64(amountRaw)],
  });
  const plp = tx.moveCall({
    target: `${PREDICT_PACKAGE}::predict::supply`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(PREDICT_OBJECT), coin, tx.object(CLOCK)],
  });
  tx.transferObjects([plp], sender);
  return tx;
}

/** Current PLP redemption rate (dUSDC per PLP) from the on-chain Predict object. */
export async function getPlpRate(): Promise<number> {
  const o = await client.getObject({ id: PREDICT_OBJECT, options: { showContent: true } });
  const f: any = (o.data?.content as any)?.fields ?? {};
  const reserves = Number(BigInt(f.vault?.fields?.balance ?? 0));
  const supply = Number(BigInt(f.treasury_cap?.fields?.total_supply?.fields?.value ?? 0));
  return supply > 0 ? reserves / supply : 1;
}

// ── User: deposit (per tranche) ───────────────────────────────────────────────

function buildDeposit(coins: CoinStruct[], amountRaw: bigint, sender: string, fn: 'deposit_senior' | 'deposit_junior'): Transaction {
  const tx = new Transaction();
  const coin = splitDusdc(tx, coins, amountRaw);
  const shares = tx.moveCall({
    target: `${MOD}::${fn}`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(VAULT_OBJECT), coin],
  });
  tx.transferObjects([shares], sender);
  return tx;
}

/** Deposit dUSDC into the SENIOR tranche; FLP-S shares returned to `sender`. */
export function buildDepositSenior(coins: CoinStruct[], amountRaw: bigint, sender: string): Transaction {
  return buildDeposit(coins, amountRaw, sender, 'deposit_senior');
}

/** Deposit dUSDC into the JUNIOR tranche; FLP-J shares returned to `sender`. */
export function buildDepositJunior(coins: CoinStruct[], amountRaw: bigint, sender: string): Transaction {
  return buildDeposit(coins, amountRaw, sender, 'deposit_junior');
}

// ── User: withdraw (per tranche) ──────────────────────────────────────────────

function buildWithdraw(flpCoins: CoinStruct[], sharesRaw: bigint, sender: string, fn: 'withdraw_senior' | 'withdraw_junior'): Transaction {
  const tx = new Transaction();
  if (flpCoins.length === 0) throw new Error(`No ${fn === 'withdraw_senior' ? 'FLP-S' : 'FLP-J'} shares in wallet`);
  const primary = tx.object(flpCoins[0].coinObjectId);
  if (flpCoins.length > 1) tx.mergeCoins(primary, flpCoins.slice(1).map(c => tx.object(c.coinObjectId)));
  const [exact] = tx.splitCoins(primary, [tx.pure.u64(sharesRaw)]);
  const out = tx.moveCall({
    target: `${MOD}::${fn}`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(VAULT_OBJECT), exact],
  });
  tx.transferObjects([out], sender);
  return tx;
}

/** Burn `sharesRaw` FLP-S for a pro-rata senior claim, returned to `sender`. */
export function buildWithdrawSenior(flpCoins: CoinStruct[], sharesRaw: bigint, sender: string): Transaction {
  return buildWithdraw(flpCoins, sharesRaw, sender, 'withdraw_senior');
}

/** Burn `sharesRaw` FLP-J for a pro-rata junior claim, returned to `sender`. */
export function buildWithdrawJunior(flpCoins: CoinStruct[], sharesRaw: bigint, sender: string): Transaction {
  return buildWithdraw(flpCoins, sharesRaw, sender, 'withdraw_junior');
}

// ── Operator: deploy / settle / mark ─────────────────────────────────────────

/** Operator: move `amountRaw` of idle reserve out; returned dUSDC goes to `sender`. */
export function buildVaultDeploy(amountRaw: bigint, sender: string): Transaction {
  const tx = new Transaction();
  const coin = tx.moveCall({
    target: `${MOD}::deploy`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(VAULT_ADMIN_CAP), tx.object(VAULT_OBJECT), tx.pure.u64(amountRaw)],
  });
  tx.transferObjects([coin], sender);
  return tx;
}

/** Operator: return `amountRaw` dUSDC and report remaining deployed value (runs the waterfall). */
export function buildVaultSettle(coins: CoinStruct[], amountRaw: bigint, newDeployedRaw: bigint): Transaction {
  const tx = new Transaction();
  const coin = splitDusdc(tx, coins, amountRaw);
  tx.moveCall({
    target: `${MOD}::settle`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(VAULT_ADMIN_CAP), tx.object(VAULT_OBJECT), coin, tx.pure.u64(newDeployedRaw), tx.object(CLOCK)],
  });
  return tx;
}

/** Operator: mark-to-market the deployed value (no cash move; runs waterfall + stamps time). */
export function buildVaultMark(newDeployedRaw: bigint): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${MOD}::mark`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(VAULT_ADMIN_CAP), tx.object(VAULT_OBJECT), tx.pure.u64(newDeployedRaw), tx.object(CLOCK)],
  });
  return tx;
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export interface VaultState {
  reserve: number;            // idle dUSDC
  deployed: number;           // reported deployed value (dUSDC)
  nav: number;                // reserve + deployed
  seniorValue: number;        // senior tranche claim on NAV
  juniorValue: number;        // nav − seniorValue
  seniorPrincipal: number;    // senior net deposits (accrual base)
  seniorShares: number;       // FLP-S supply
  juniorShares: number;       // FLP-J supply
  seniorPrice: number;        // seniorValue / seniorShares (1 if empty)
  juniorPrice: number;        // juniorValue / juniorShares (1 if empty)
  markedAt: number;           // last mark/settle time (ms)
  markAgeSec: number;         // seconds since last mark
  capacity: number;           // deposit ceiling (dUSDC) — on-chain enforced
  pctFull: number;            // nav / capacity × 100
  roomRemaining: number;      // capacity − nav (≥0)
  coverage: number;           // senior / junior (subordination ratio; ∞ if no junior)
  lifetimeDeposited: number;
  lifetimeWithdrawn: number;
  // Aggregate (legacy/blended) — total NAV across both tranches.
  totalShares: number;        // seniorShares + juniorShares (display only)
  sharePrice: number;         // nav / totalShares (blended; tranche prices differ)
}

/** Read the on-chain tranched Vault state. */
export async function getVaultState(): Promise<VaultState> {
  const o = await client.getObject({ id: VAULT_OBJECT, options: { showContent: true } });
  const f: any = (o.data?.content as any)?.fields ?? {};
  const S = Number(DUSDC_SCALE);

  const reserve = Number(BigInt(f.reserve ?? 0)) / S;
  const deployed = Number(BigInt(f.deployed ?? 0)) / S;
  const nav = reserve + deployed;
  const seniorValue = Number(BigInt(f.senior_value ?? 0)) / S;
  const juniorValue = Math.max(0, nav - seniorValue);
  const seniorPrincipal = Number(BigInt(f.senior_principal ?? 0)) / S;

  const seniorShares = Number(BigInt(f.s_treasury?.fields?.total_supply?.fields?.value ?? 0)) / S;
  const juniorShares = Number(BigInt(f.j_treasury?.fields?.total_supply?.fields?.value ?? 0)) / S;

  const markedAt = Number(BigInt(f.marked_at ?? 0));
  const totalShares = seniorShares + juniorShares;

  return {
    reserve, deployed, nav,
    seniorValue, juniorValue, seniorPrincipal,
    seniorShares, juniorShares,
    seniorPrice: seniorShares > 0 ? seniorValue / seniorShares : 1,
    juniorPrice: juniorShares > 0 ? juniorValue / juniorShares : 1,
    markedAt,
    markAgeSec: markedAt > 0 ? Math.max(0, (Date.now() - markedAt) / 1000) : 0,
    capacity: VAULT_CAPACITY,
    pctFull: VAULT_CAPACITY > 0 ? (nav / VAULT_CAPACITY) * 100 : 0,
    roomRemaining: Math.max(0, VAULT_CAPACITY - nav),
    coverage: juniorValue > 0 ? seniorValue / juniorValue : (seniorValue > 0 ? Infinity : 0),
    lifetimeDeposited: Number(f.lifetime_deposited ?? 0) / S,
    lifetimeWithdrawn: Number(f.lifetime_withdrawn ?? 0) / S,
    totalShares,
    sharePrice: totalShares > 0 ? nav / totalShares : 1,
  };
}
