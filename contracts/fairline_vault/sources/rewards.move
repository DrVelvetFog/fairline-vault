/// FairLine House Flywheel — a predictor rebate pool funded from the house edge.
///
/// FairLine is the *house* of a prediction market: it earns a spread as predictors
/// trade. This module closes the loop into a two-sided flywheel — the operator
/// routes a slice of that realized edge into a `RewardPool`, and pays it back out
/// as rebates to predictors active in the markets FairLine backs. More rebates →
/// more trading volume → more house edge → more rebates.
///
/// Honest model: the pool balance and every payout are on-chain and auditable.
/// Rebate *amounts* are computed off-chain from public on-chain trading volume
/// (the operator has no discretion to mint — it can only pay out what was funded).
module fairline_vault::rewards;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::event;

/// Shared rebate pool, generic over the quote asset `T` (e.g. dUSDC).
public struct RewardPool<phantom T> has key {
    id: UID,
    balance: Balance<T>,
    lifetime_funded: u64,
    lifetime_rebated: u64,
    rebate_count: u64,
}

/// Operator capability — required to pay rebates out of the pool.
public struct RewardAdminCap has key, store { id: UID }

// ── Errors ──────────────────────────────────────────────────────────────────
const EZeroAmount: u64 = 0;
const EInsufficientPool: u64 = 1;

// ── Events ──────────────────────────────────────────────────────────────────
public struct Funded has copy, drop { amount: u64, pool_balance: u64 }
public struct Rebated has copy, drop { recipient: address, amount: u64, pool_balance: u64 }

/// Create the shared reward pool and hand the admin cap to the caller.
public fun create_pool<T>(ctx: &mut TxContext) {
    transfer::transfer(RewardAdminCap { id: object::new(ctx) }, ctx.sender());
    transfer::share_object(RewardPool<T> {
        id: object::new(ctx),
        balance: balance::zero<T>(),
        lifetime_funded: 0,
        lifetime_rebated: 0,
        rebate_count: 0,
    });
}

/// Fund the pool (permissionless — the operator routes a slice of house edge in).
public fun fund<T>(pool: &mut RewardPool<T>, coin: Coin<T>) {
    let amount = coin::value(&coin);
    assert!(amount > 0, EZeroAmount);
    balance::join(&mut pool.balance, coin::into_balance(coin));
    pool.lifetime_funded = pool.lifetime_funded + amount;
    event::emit(Funded { amount, pool_balance: balance::value(&pool.balance) });
}

/// Operator: pay a rebate to a predictor. Amounts are computed off-chain from
/// public trading volume; the operator can only pay out what the pool holds.
public fun reward<T>(_: &RewardAdminCap, pool: &mut RewardPool<T>, recipient: address, amount: u64, ctx: &mut TxContext) {
    assert!(amount > 0, EZeroAmount);
    assert!(amount <= balance::value(&pool.balance), EInsufficientPool);
    let c = coin::take(&mut pool.balance, amount, ctx);
    transfer::public_transfer(c, recipient);
    pool.lifetime_rebated = pool.lifetime_rebated + amount;
    pool.rebate_count = pool.rebate_count + 1;
    event::emit(Rebated { recipient, amount, pool_balance: balance::value(&pool.balance) });
}

// ── Views ─────────────────────────────────────────────────────────────────────
public fun pool_balance<T>(p: &RewardPool<T>): u64 { balance::value(&p.balance) }
public fun lifetime_funded<T>(p: &RewardPool<T>): u64 { p.lifetime_funded }
public fun lifetime_rebated<T>(p: &RewardPool<T>): u64 { p.lifetime_rebated }
public fun rebate_count<T>(p: &RewardPool<T>): u64 { p.rebate_count }
