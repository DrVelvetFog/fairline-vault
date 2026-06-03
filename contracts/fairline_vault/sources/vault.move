/// FairLine Vault — a multi-user, NAV-based share vault for the LP strategy.
///
/// Users deposit a quote asset (dUSDC) and receive fungible FLP share tokens
/// priced at the vault's current net asset value (NAV). They withdraw by
/// burning shares for a pro-rata claim on assets. The operator holds an
/// `AdminCap` and uses it to deploy idle reserve into the off-chain LP strategy
/// (DeepBook Predict PLP) and to settle realized value back, which moves the
/// share price.
///
/// NAV = idle reserve + deployed (operator-reported current value of the
/// strategy's position). Share price = NAV / total FLP supply.
///
/// Trust model (honest): cash movements are on-chain and permissionless to
/// audit; the `deployed` figure is operator-reported but is derived from the
/// on-chain Predict redemption rate, so it is independently verifiable. This is
/// an early-stage, UNAUDITED design.
#[allow(deprecated_usage)]
module fairline_vault::vault;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin, TreasuryCap};
use sui::event;

/// One-time witness; also the FLP share-coin type.
public struct VAULT has drop {}

/// Shared vault object, generic over the quote asset `T` (e.g. dUSDC).
public struct Vault<phantom T> has key {
    id: UID,
    reserve: Balance<T>,          // idle quote asset held by the vault
    treasury: TreasuryCap<VAULT>, // mints / burns FLP shares
    deployed: u64,                // quote asset out with the strategy, at reported value
    lifetime_deposited: u64,      // cumulative deposits (stats)
    lifetime_withdrawn: u64,      // cumulative withdrawals (stats)
}

/// Operator capability — required to deploy/settle strategy capital.
public struct AdminCap has key, store { id: UID }

// ── Errors ──────────────────────────────────────────────────────────────────
const EZeroAmount: u64 = 0;
const EInsufficientReserve: u64 = 1;
const EZeroShares: u64 = 2;
const EDeployTooLarge: u64 = 3;

// ── Events ──────────────────────────────────────────────────────────────────
public struct Deposited has copy, drop { depositor: address, amount: u64, shares: u64, nav: u64 }
public struct Withdrawn has copy, drop { withdrawer: address, shares: u64, amount: u64, nav: u64 }
public struct Deployed has copy, drop { amount: u64, total_deployed: u64 }
public struct Settled has copy, drop { returned: u64, new_deployed: u64, nav: u64 }

// ── Init ──────────────────────────────────────────────────────────────────────

fun init(witness: VAULT, ctx: &mut TxContext) {
    let (treasury, metadata) = coin::create_currency(
        witness,
        6,                       // decimals — match dUSDC
        b"FLP",
        b"FairLine LP",
        b"Share token for the FairLine liquidity vault",
        option::none(),
        ctx,
    );
    transfer::public_freeze_object(metadata);
    transfer::transfer(AdminCap { id: object::new(ctx) }, ctx.sender());

    // The Vault itself is created lazily by `create` so its quote type `T` is
    // chosen at deploy time. Hand the treasury to the creator via a hot-potato
    // would over-complicate; instead store it in a one-shot holder.
    transfer::transfer(TreasuryHolder { id: object::new(ctx), treasury }, ctx.sender());
}

/// Transient holder so the publisher can create the typed Vault in a follow-up tx.
public struct TreasuryHolder has key { id: UID, treasury: TreasuryCap<VAULT> }

/// Create the shared Vault for quote asset `T`, consuming the treasury holder.
public fun create<T>(holder: TreasuryHolder, ctx: &mut TxContext) {
    let TreasuryHolder { id, treasury } = holder;
    object::delete(id);
    transfer::share_object(Vault<T> {
        id: object::new(ctx),
        reserve: balance::zero<T>(),
        treasury,
        deployed: 0,
        lifetime_deposited: 0,
        lifetime_withdrawn: 0,
    });
}

// ── Views ──────────────────────────────────────────────────────────────────────

/// Total assets under management = idle reserve + deployed (reported) value.
public fun nav<T>(v: &Vault<T>): u64 {
    balance::value(&v.reserve) + v.deployed
}

public fun total_shares<T>(v: &Vault<T>): u64 { coin::total_supply(&v.treasury) }
public fun reserve_value<T>(v: &Vault<T>): u64 { balance::value(&v.reserve) }
public fun deployed<T>(v: &Vault<T>): u64 { v.deployed }

/// Shares minted for `amount` at current NAV (bootstraps 1:1 on an empty vault).
public fun shares_for<T>(v: &Vault<T>, amount: u64): u64 {
    let supply = total_shares(v);
    let aum = nav(v);
    if (supply == 0 || aum == 0) { amount }
    else { (((amount as u128) * (supply as u128)) / (aum as u128)) as u64 }
}

// ── User: deposit / withdraw ────────────────────────────────────────────────────

/// Deposit `coin` of quote asset, receive FLP shares at current NAV.
public fun deposit<T>(v: &mut Vault<T>, coin: Coin<T>, ctx: &mut TxContext): Coin<VAULT> {
    let amount = coin::value(&coin);
    assert!(amount > 0, EZeroAmount);

    let shares = shares_for(v, amount);
    assert!(shares > 0, EZeroShares);

    balance::join(&mut v.reserve, coin::into_balance(coin));
    v.lifetime_deposited = v.lifetime_deposited + amount;

    let out = coin::mint(&mut v.treasury, shares, ctx);
    event::emit(Deposited { depositor: ctx.sender(), amount, shares, nav: nav(v) });
    out
}

/// Burn FLP `shares` for a pro-rata claim, paid from idle reserve.
/// Reverts if the reserve can't cover the claim (operator must `settle` first).
public fun withdraw<T>(v: &mut Vault<T>, shares: Coin<VAULT>, ctx: &mut TxContext): Coin<T> {
    let n = coin::value(&shares);
    assert!(n > 0, EZeroShares);

    let supply = total_shares(v);
    let amount = (((n as u128) * (nav(v) as u128)) / (supply as u128)) as u64;
    assert!(amount <= balance::value(&v.reserve), EInsufficientReserve);

    coin::burn(&mut v.treasury, shares);
    v.lifetime_withdrawn = v.lifetime_withdrawn + amount;

    let out = coin::take(&mut v.reserve, amount, ctx);
    event::emit(Withdrawn { withdrawer: ctx.sender(), shares: n, amount, nav: nav(v) });
    out
}

// ── Operator: deploy / settle strategy capital ──────────────────────────────────

/// Move `amount` of idle reserve out to run the LP strategy. Value is conserved
/// (reserve down, deployed up), so NAV and share price are unchanged.
public fun deploy<T>(_: &AdminCap, v: &mut Vault<T>, amount: u64, ctx: &mut TxContext): Coin<T> {
    assert!(amount > 0, EZeroAmount);
    assert!(amount <= balance::value(&v.reserve), EInsufficientReserve);
    v.deployed = v.deployed + amount;
    let out = coin::take(&mut v.reserve, amount, ctx);
    event::emit(Deployed { amount, total_deployed: v.deployed });
    out
}

/// Return strategy capital and report the remaining deployed value.
/// Realized P&L (returned coin minus the drop in `deployed`) flows into the
/// reserve and moves the share price. `new_deployed` is the operator's current
/// valuation of the still-deployed position (verifiable from on-chain PLP rate).
public fun settle<T>(_: &AdminCap, v: &mut Vault<T>, coin: Coin<T>, new_deployed: u64) {
    let returned = coin::value(&coin);
    assert!(new_deployed <= v.deployed + returned, EDeployTooLarge);
    balance::join(&mut v.reserve, coin::into_balance(coin));
    v.deployed = new_deployed;
    event::emit(Settled { returned, new_deployed, nav: nav(v) });
}

/// Update only the reported value of the deployed position (mark-to-market),
/// without moving cash — lets NAV reflect PLP accrual between settlements.
public fun mark<T>(_: &AdminCap, v: &mut Vault<T>, new_deployed: u64) {
    v.deployed = new_deployed;
}

// ── Test-only init ──────────────────────────────────────────────────────────────
#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(VAULT {}, ctx) }
