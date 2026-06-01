/**
 * Coin utilities — find, merge, and split dUSDC coins in PTBs.
 *
 * Sui coin model: a wallet may own many Coin<dUSDC> objects.
 * Before using them in a PTB we merge them into one, then split exact amounts.
 */

import { CoinStruct } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { client } from './wallet.js';
import { DUSDC_TYPE, DUSDC_SCALE, dusdcToHuman } from './config.js';

export interface CoinBalance {
  coins:        CoinStruct[];
  totalRaw:     bigint;   // sum in raw dUSDC units (1e6)
  totalHuman:   number;   // human dUSDC
}

/** Fetch all dUSDC coin objects owned by an address. */
export async function getDusdcCoins(owner: string): Promise<CoinBalance> {
  const result = await client.getCoins({ owner, coinType: DUSDC_TYPE });
  const coins  = result.data;
  const totalRaw = coins.reduce((sum, c) => sum + BigInt(c.balance), 0n);
  return { coins, totalRaw, totalHuman: dusdcToHuman(totalRaw) };
}

/**
 * Add coin-merging + splitting to a transaction.
 *
 * If the wallet has multiple dUSDC coins, merges them all into the first,
 * then splits off `amountRaw` as a separate coin object.
 *
 * Returns a TransactionArgument pointing to a Coin<dUSDC> of exactly amountRaw.
 * Throws if total balance < amountRaw.
 */
export function splitDusdc(
  tx:        Transaction,
  coins:     CoinStruct[],
  amountRaw: bigint,
) {
  if (coins.length === 0) throw new Error('No dUSDC coins in wallet');

  const totalRaw = coins.reduce((s, c) => s + BigInt(c.balance), 0n);
  if (totalRaw < amountRaw) {
    throw new Error(
      `Insufficient dUSDC: have ${dusdcToHuman(totalRaw).toFixed(6)}, need ${dusdcToHuman(amountRaw).toFixed(6)}`
    );
  }

  // Primary coin: merge all others into this one
  const primary = tx.object(coins[0].coinObjectId);
  if (coins.length > 1) {
    tx.mergeCoins(primary, coins.slice(1).map(c => tx.object(c.coinObjectId)));
  }

  // Split exact amount off the primary coin
  const [exact] = tx.splitCoins(primary, [tx.pure.u64(amountRaw)]);
  return exact;
}

/** Pretty-print coin balance for logging. */
export function formatBalance(bal: CoinBalance): string {
  return `${bal.totalHuman.toFixed(6)} dUSDC (${bal.coins.length} coin object${bal.coins.length === 1 ? '' : 's'})`;
}
