/**
 * PTB builders for all Predict protocol interactions.
 *
 * Each builder produces a complete, self-contained Transaction that can be
 * passed to execute() or inspect(). Coin selection/merging/splitting is
 * handled inside the PTB so callers just pass CoinStruct[] from the wallet.
 *
 * Scaling:
 *   strikes / oracle prices : 1e9 (PRICE_SCALE)
 *   dUSDC amounts           : 1e6 (DUSDC_SCALE)
 *   position quantities     : 1e6 (max payout in raw dUSDC)
 */

import { CoinStruct } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { PREDICT_PACKAGE, PREDICT_OBJECT, DUSDC_TYPE, PLP_TYPE } from './config.js';
import { splitDusdc } from './coins.js';

const PKG   = PREDICT_PACKAGE;
const PRED  = PREDICT_OBJECT;
const CLOCK = '0x6';

// ── Internal helpers ──────────────────────────────────────────────────────────

function mkMarketKey(
  tx: Transaction,
  oracleId: string,
  expiry: bigint,
  strike: bigint,
  isUp: boolean,
) {
  return tx.moveCall({
    target: `${PKG}::market_key::${isUp ? 'up' : 'down'}`,
    arguments: [tx.pure.id(oracleId), tx.pure.u64(expiry), tx.pure.u64(strike)],
  });
}

function mkRangeKey(
  tx: Transaction,
  oracleId: string,
  expiry: bigint,
  lowerStrike: bigint,
  higherStrike: bigint,
) {
  return tx.moveCall({
    target: `${PKG}::range_key::new`,
    arguments: [
      tx.pure.id(oracleId),
      tx.pure.u64(expiry),
      tx.pure.u64(lowerStrike),
      tx.pure.u64(higherStrike),
    ],
  });
}

// ── Manager setup ─────────────────────────────────────────────────────────────

/** Create a new PredictManager for the caller. */
export function buildCreateManager(): Transaction {
  const tx = new Transaction();
  tx.moveCall({ target: `${PKG}::predict::create_manager`, arguments: [] });
  return tx;
}

// ── Deposit ───────────────────────────────────────────────────────────────────

/**
 * Deposit exact dUSDC amount into PredictManager from wallet coins.
 * Merges all dUSDC coins, splits the exact amount, deposits it.
 */
export function buildDeposit(
  managerId:   string,
  coins:       CoinStruct[],
  amountRaw:   bigint,
): Transaction {
  const tx   = new Transaction();
  const coin = splitDusdc(tx, coins, amountRaw);
  tx.moveCall({
    target:        `${PKG}::predict_manager::deposit`,
    typeArguments: [DUSDC_TYPE],
    arguments:     [tx.object(managerId), coin],
  });
  return tx;
}

// ── Deposit + Mint (single PTB) ───────────────────────────────────────────────

/**
 * Deposit dUSDC into manager and immediately mint a binary position — one PTB.
 *
 * depositRaw: amount to deposit (should cover cost = quantity × ask_price).
 *   Safe to deposit the full quantity as max-possible cost; leftover stays in manager.
 * quantity:   max payout in raw dUSDC (1e6 units).
 * strike:     in 1e9-scaled price units.
 */
export function buildDepositAndMint(
  managerId:   string,
  coins:       CoinStruct[],
  depositRaw:  bigint,
  oracleId:    string,
  expiry:      bigint,
  strike:      bigint,
  isUp:        boolean,
  quantity:    bigint,
): Transaction {
  const tx   = new Transaction();
  const coin = splitDusdc(tx, coins, depositRaw);

  // Deposit into manager
  tx.moveCall({
    target:        `${PKG}::predict_manager::deposit`,
    typeArguments: [DUSDC_TYPE],
    arguments:     [tx.object(managerId), coin],
  });

  // Mint position (cost withdrawn from manager internally)
  const key = mkMarketKey(tx, oracleId, expiry, strike, isUp);
  tx.moveCall({
    target:        `${PKG}::predict::mint`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(PRED),
      tx.object(managerId),
      tx.object(oracleId),
      key,
      tx.pure.u64(quantity),
      tx.object(CLOCK),
    ],
  });

  return tx;
}

/**
 * Deposit dUSDC and mint a vertical range position — one PTB.
 */
export function buildDepositAndMintRange(
  managerId:    string,
  coins:        CoinStruct[],
  depositRaw:   bigint,
  oracleId:     string,
  expiry:       bigint,
  lowerStrike:  bigint,
  higherStrike: bigint,
  quantity:     bigint,
): Transaction {
  const tx   = new Transaction();
  const coin = splitDusdc(tx, coins, depositRaw);

  tx.moveCall({
    target:        `${PKG}::predict_manager::deposit`,
    typeArguments: [DUSDC_TYPE],
    arguments:     [tx.object(managerId), coin],
  });

  const key = mkRangeKey(tx, oracleId, expiry, lowerStrike, higherStrike);
  tx.moveCall({
    target:        `${PKG}::predict::mint_range`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(PRED),
      tx.object(managerId),
      tx.object(oracleId),
      key,
      tx.pure.u64(quantity),
      tx.object(CLOCK),
    ],
  });

  return tx;
}

// ── Supply (PLP) ──────────────────────────────────────────────────────────────

/**
 * Supply dUSDC to the vault, receive PLP tokens back to wallet.
 * Merges coins, splits exact amount, calls supply, transfers PLP to sender.
 */
export function buildSupply(
  coins:      CoinStruct[],
  amountRaw:  bigint,
  sender:     string,
): Transaction {
  const tx   = new Transaction();
  const coin = splitDusdc(tx, coins, amountRaw);

  const plpCoin = tx.moveCall({
    target:        `${PKG}::predict::supply`,
    typeArguments: [DUSDC_TYPE],
    arguments:     [tx.object(PRED), coin, tx.object(CLOCK)],
  });

  tx.transferObjects([plpCoin], sender);
  return tx;
}

// ── Withdraw PLP ──────────────────────────────────────────────────────────────

/**
 * Burn PLP tokens, receive dUSDC back to wallet.
 * plpCoinId: object ID of the Coin<PLP> to burn.
 */
export function buildWithdrawLiquidity(
  plpCoinId: string,
  sender:    string,
): Transaction {
  const tx = new Transaction();
  const dusdcCoin = tx.moveCall({
    target:        `${PKG}::predict::withdraw`,
    typeArguments: [DUSDC_TYPE],
    arguments:     [tx.object(PRED), tx.object(plpCoinId), tx.object(CLOCK)],
  });
  tx.transferObjects([dusdcCoin], sender);
  return tx;
}

// ── Redeem (post-settlement) ──────────────────────────────────────────────────

/** Redeem a settled position permissionlessly. */
export function buildRedeemPermissionless(
  managerId: string,
  oracleId:  string,
  expiry:    bigint,
  strike:    bigint,
  isUp:      boolean,
  quantity:  bigint,
): Transaction {
  const tx  = new Transaction();
  const key = mkMarketKey(tx, oracleId, expiry, strike, isUp);
  tx.moveCall({
    target:        `${PKG}::predict::redeem_permissionless`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(PRED),
      tx.object(managerId),
      tx.object(oracleId),
      key,
      tx.pure.u64(quantity),
      tx.object(CLOCK),
    ],
  });
  return tx;
}

// ── Preview (devInspect only) ─────────────────────────────────────────────────

/** Preview mint cost + redeem payout for a binary position. */
export function buildGetTradeAmounts(
  oracleId: string,
  expiry:   bigint,
  strike:   bigint,
  isUp:     boolean,
  quantity: bigint,
): Transaction {
  const tx  = new Transaction();
  const key = mkMarketKey(tx, oracleId, expiry, strike, isUp);
  tx.moveCall({
    target:    `${PKG}::predict::get_trade_amounts`,
    arguments: [
      tx.object(PRED),
      tx.object(oracleId),
      key,
      tx.pure.u64(quantity),
      tx.object(CLOCK),
    ],
  });
  return tx;
}
