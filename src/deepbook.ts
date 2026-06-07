/**
 * DeepBook v3 CLOB — direct on-chain orderbook integration (raw PTBs, no SDK).
 *
 * FairLine provides two-sided liquidity to a DeepBook central limit order book,
 * the same "be the house, earn the spread" thesis applied to Sui's core
 * orderbook. We quote the **whitelisted DEEP/SUI pool** (zero DeepBook fees, so
 * no DEEP needed for fees) — bids lock SUI (faucetable), and as bids fill the
 * maker accrues DEEP inventory and can quote asks too. Posture-gated by the same
 * Green/Amber/Red risk signal that governs the prediction-market house.
 *
 * All addresses are DeepBook v3 testnet (from @mysten/deepbook-v3 constants).
 */
import * as fs from 'fs';
import { Transaction } from '@mysten/sui/transactions';
import { client } from './wallet.js';

export const DEEPBOOK_PKG = '0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c';
// Whitelisted DEEP/SUI pool: base = DEEP (1e6), quote = SUI (1e9), zero fees.
export const POOL  = '0x48c95963e9eac37a316b7ae04a0deb761bcdcc2b67912374d6036e7f0e9bae9f';
export const BASE  = '0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP';
export const QUOTE = '0x2::sui::SUI';
export const POOL_NAME = 'DEEP/SUI';
const BASE_SCALAR = 1e6;     // DEEP
const QUOTE_SCALAR = 1e9;    // SUI
const FLOAT_SCALAR = 1e9;
const MAX_TS = 1844674407370955161n;
const CLOCK = '0x6';
const POST_ONLY = 3;         // OrderType::POST_ONLY — never crosses (pure maker)
const SELF_MATCH_ALLOWED = 0;
const BM_FILE = 'logs/deepbook-bm.json';
// Pool trading constraints (DEEP/SUI testnet), read from pool::pool_book_params.
const TICK_RAW = 10_000_000n;   // price must be a multiple of this
const LOT_RAW  = 1_000_000n;    // quantity must be a multiple of this (1 DEEP)
const MIN_RAW  = 10_000_000n;   // minimum order size (10 DEEP)
export const MIN_DEEP = 10;     // human minimum order quantity

// ── Scaling (DeepBook cross-scalar price convention) ──────────────────────────
// price is quote-per-base (SUI per DEEP). raw = price × FLOAT × quoteScalar/baseScalar.
export const priceToRaw = (human: number): bigint => BigInt(Math.round(human * FLOAT_SCALAR * QUOTE_SCALAR / BASE_SCALAR));
export const priceFromRaw = (raw: bigint | number): number => Number(raw) / (FLOAT_SCALAR * QUOTE_SCALAR / BASE_SCALAR);
export const qtyToRaw = (human: number): bigint => BigInt(Math.round(human * BASE_SCALAR));

// ── BalanceManager persistence ────────────────────────────────────────────────
export function loadBM(): string | null {
  try { return JSON.parse(fs.readFileSync(BM_FILE, 'utf-8')).id; } catch { return null; }
}
export function saveBM(id: string) {
  fs.mkdirSync('logs', { recursive: true });
  fs.writeFileSync(BM_FILE, JSON.stringify({ id }, null, 2));
}

// ── Builders ──────────────────────────────────────────────────────────────────

/** Create + share a BalanceManager (DeepBook trading account). */
export function buildCreateBalanceManager(): Transaction {
  const tx = new Transaction();
  const manager = tx.moveCall({ target: `${DEEPBOOK_PKG}::balance_manager::new` });
  tx.moveCall({
    target: '0x2::transfer::public_share_object',
    typeArguments: [`${DEEPBOOK_PKG}::balance_manager::BalanceManager`],
    arguments: [manager],
  });
  return tx;
}

/** Deposit SUI from gas into the BalanceManager. */
export function buildDepositSui(bmId: string, amountSui: number): Transaction {
  const tx = new Transaction();
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(BigInt(Math.round(amountSui * QUOTE_SCALAR)))]);
  tx.moveCall({ target: `${DEEPBOOK_PKG}::balance_manager::deposit`, typeArguments: [QUOTE], arguments: [tx.object(bmId), coin] });
  return tx;
}

/** Place a post-only limit order. isBid=true buys DEEP (locks SUI). */
export function buildPlaceLimitOrder(bmId: string, isBid: boolean, priceHuman: number, qtyDeep: number, clientOrderId: number): Transaction {
  // Align to the pool's tick/lot/min constraints or the order is rejected.
  const priceRaw = (priceToRaw(priceHuman) / TICK_RAW) * TICK_RAW;
  let qtyRaw = (qtyToRaw(qtyDeep) / LOT_RAW) * LOT_RAW;
  if (qtyRaw < MIN_RAW) qtyRaw = MIN_RAW;
  const tx = new Transaction();
  const proof = tx.moveCall({ target: `${DEEPBOOK_PKG}::balance_manager::generate_proof_as_owner`, arguments: [tx.object(bmId)] });
  tx.moveCall({
    target: `${DEEPBOOK_PKG}::pool::place_limit_order`,
    typeArguments: [BASE, QUOTE],
    arguments: [
      tx.object(POOL), tx.object(bmId), proof,
      tx.pure.u64(clientOrderId), tx.pure.u8(POST_ONLY), tx.pure.u8(SELF_MATCH_ALLOWED),
      tx.pure.u64(priceRaw), tx.pure.u64(qtyRaw),
      tx.pure.bool(isBid), tx.pure.bool(false), tx.pure.u64(MAX_TS), tx.object(CLOCK),
    ],
  });
  return tx;
}

/** Cancel all of the BalanceManager's resting orders in this pool. */
export function buildCancelAll(bmId: string): Transaction {
  const tx = new Transaction();
  const proof = tx.moveCall({ target: `${DEEPBOOK_PKG}::balance_manager::generate_proof_as_owner`, arguments: [tx.object(bmId)] });
  tx.moveCall({
    target: `${DEEPBOOK_PKG}::pool::cancel_all_orders`,
    typeArguments: [BASE, QUOTE],
    arguments: [tx.object(POOL), tx.object(bmId), proof, tx.object(CLOCK)],
  });
  return tx;
}

// ── Reads (devInspect — free) ─────────────────────────────────────────────────

async function inspectU64(tx: Transaction, sender: string): Promise<bigint | null> {
  const r: any = await client.devInspectTransactionBlock({ transactionBlock: tx, sender });
  const rv = r?.results?.[0]?.returnValues?.[0];
  return rv ? Buffer.from(rv[0]).readBigUInt64LE(0) : null;
}

/** Current mid price (SUI per DEEP). */
export async function readMid(sender: string): Promise<number | null> {
  const tx = new Transaction();
  tx.moveCall({ target: `${DEEPBOOK_PKG}::pool::mid_price`, typeArguments: [BASE, QUOTE], arguments: [tx.object(POOL), tx.object(CLOCK)] });
  const raw = await inspectU64(tx, sender);
  return raw === null ? null : priceFromRaw(raw);
}

/** BalanceManager balance of a coin type (human units). */
export async function readBmBalance(bmId: string, coinType: string, scalar: number, sender: string): Promise<number> {
  const tx = new Transaction();
  tx.moveCall({ target: `${DEEPBOOK_PKG}::balance_manager::balance`, typeArguments: [coinType], arguments: [tx.object(bmId)] });
  const raw = await inspectU64(tx, sender);
  return raw === null ? 0 : Number(raw) / scalar;
}

export async function readBmSui(bmId: string, sender: string) { return readBmBalance(bmId, QUOTE, QUOTE_SCALAR, sender); }
export async function readBmDeep(bmId: string, sender: string) { return readBmBalance(bmId, BASE, BASE_SCALAR, sender); }

/** Count of the BalanceManager's open orders in this pool. */
export async function readOpenOrderCount(bmId: string, sender: string): Promise<number> {
  const tx = new Transaction();
  tx.moveCall({ target: `${DEEPBOOK_PKG}::pool::account_open_orders`, typeArguments: [BASE, QUOTE], arguments: [tx.object(POOL), tx.object(bmId)] });
  const r: any = await client.devInspectTransactionBlock({ transactionBlock: tx, sender });
  const rv = r?.results?.[0]?.returnValues?.[0];
  if (!rv) return 0;
  // VecSet<u128> BCS: first byte(s) ULEB128 length of the vector.
  const bytes = rv[0] as number[];
  return bytes.length ? bytes[0] : 0;
}
