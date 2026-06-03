/**
 * FairLine Vault — PTB builders + reads for the on-chain multi-user share vault.
 *
 *   deposit  (user)     dUSDC  → FLP shares
 *   withdraw (user)     FLP    → dUSDC (pro-rata, from idle reserve)
 *   deploy   (operator) move idle reserve out to run the LP strategy
 *   settle   (operator) return capital + report remaining deployed value
 *   mark     (operator) mark-to-market the deployed value (no cash move)
 */

import { CoinStruct } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { client } from './wallet.js';
import { splitDusdc } from './coins.js';
import {
  VAULT_PACKAGE, VAULT_OBJECT, VAULT_ADMIN_CAP, DUSDC_TYPE, DUSDC_SCALE,
  PREDICT_PACKAGE, PREDICT_OBJECT,
} from './config.js';

const MOD = `${VAULT_PACKAGE}::vault`;
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

/** Deposit `amountRaw` dUSDC into the vault; FLP shares are returned to `sender`. */
export function buildVaultDeposit(coins: CoinStruct[], amountRaw: bigint, sender: string): Transaction {
  const tx = new Transaction();
  const coin = splitDusdc(tx, coins, amountRaw);
  const shares = tx.moveCall({
    target: `${MOD}::deposit`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(VAULT_OBJECT), coin],
  });
  tx.transferObjects([shares], sender);
  return tx;
}

/** Burn `sharesRaw` FLP for a pro-rata dUSDC claim, returned to `sender`. */
export function buildVaultWithdraw(flpCoins: CoinStruct[], sharesRaw: bigint, sender: string): Transaction {
  const tx = new Transaction();
  if (flpCoins.length === 0) throw new Error('No FLP shares in wallet');
  const primary = tx.object(flpCoins[0].coinObjectId);
  if (flpCoins.length > 1) tx.mergeCoins(primary, flpCoins.slice(1).map(c => tx.object(c.coinObjectId)));
  const [exact] = tx.splitCoins(primary, [tx.pure.u64(sharesRaw)]);
  const out = tx.moveCall({
    target: `${MOD}::withdraw`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(VAULT_OBJECT), exact],
  });
  tx.transferObjects([out], sender);
  return tx;
}

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

/** Operator: return `amountRaw` dUSDC to the vault and report remaining deployed value. */
export function buildVaultSettle(coins: CoinStruct[], amountRaw: bigint, newDeployedRaw: bigint): Transaction {
  const tx = new Transaction();
  const coin = splitDusdc(tx, coins, amountRaw);
  tx.moveCall({
    target: `${MOD}::settle`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(VAULT_ADMIN_CAP), tx.object(VAULT_OBJECT), coin, tx.pure.u64(newDeployedRaw)],
  });
  return tx;
}

/** Operator: mark-to-market the deployed value (no cash movement). */
export function buildVaultMark(newDeployedRaw: bigint): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${MOD}::mark`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(VAULT_ADMIN_CAP), tx.object(VAULT_OBJECT), tx.pure.u64(newDeployedRaw)],
  });
  return tx;
}

export interface VaultState {
  reserve: number;      // idle dUSDC
  deployed: number;     // reported deployed value (dUSDC)
  nav: number;          // reserve + deployed
  totalShares: number;  // FLP supply
  sharePrice: number;   // nav / totalShares (1.0 if empty)
  lifetimeDeposited: number;
  lifetimeWithdrawn: number;
}

/** Read the on-chain Vault state. */
export async function getVaultState(): Promise<VaultState> {
  const o = await client.getObject({ id: VAULT_OBJECT, options: { showContent: true } });
  const f: any = (o.data?.content as any)?.fields ?? {};
  const S = Number(DUSDC_SCALE);
  const reserve = Number(BigInt(f.reserve ?? 0)) / S;
  const deployed = Number(BigInt(f.deployed ?? 0)) / S;
  const nav = reserve + deployed;

  // FLP supply is held by the TreasuryCap nested inside the vault object — read it
  // directly from the object content (suix_getTotalSupply can't find a cap that
  // lives inside another object).
  const supplyRaw = BigInt(f.treasury?.fields?.total_supply?.fields?.value ?? 0);
  const totalShares = Number(supplyRaw) / S;

  return {
    reserve, deployed, nav, totalShares,
    sharePrice: totalShares > 0 ? nav / totalShares : 1,
    lifetimeDeposited: Number(f.lifetime_deposited ?? 0) / S,
    lifetimeWithdrawn: Number(f.lifetime_withdrawn ?? 0) / S,
  };
}
