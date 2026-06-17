/// FairLine Vault — a multi-user, NAV-based share vault with SENIOR/JUNIOR
/// tranches over a single LP strategy (DeepBook Predict PLP).
///
/// Two share tokens claim one shared asset pool (NAV = reserve + deployed):
///   • FLP-S (senior)  — principal-protected by junior's first-loss buffer;
///     earns marked profit with priority **up to a modest target rate**, then
///     nothing. Lower, predictable-in-practice yield.
///   • FLP-J (junior)  — absorbs losses first (down to zero before senior takes
///     any), and earns every dollar of profit above senior's cap. Leveraged.
///
/// Waterfall (applied only on operator `mark`/`settle`, which is where P&L is
/// realized — deposits/withdrawals are capital flows, not profit):
///   profit ΔNAV ≥ 0 : senior += min(ΔNAV, senior_target_accrual); junior gets rest
///   loss   ΔNAV < 0 : junior absorbs first; senior only once junior_value hits 0
/// senior_target_accrual = senior_principal × SENIOR_TARGET_BPS × elapsed / year.
///
/// `marked_at` (set from the Clock on every mark/settle) and the `Marked` event
/// make the mark freshness provable on-chain.
///
/// Trust model (honest): cash movements are on-chain and auditable; `deployed`
/// is operator-reported but derived from the on-chain PLP redemption rate, so it
/// is independently verifiable. Early-stage, UNAUDITED.
#[allow(deprecated_usage)]
module fairline_vault::vault;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin, TreasuryCap};
use sui::clock::Clock;
use sui::event;
use sui::dynamic_field as df;
use fairline_vault::flp_s::{Self, FLP_S, HolderS};
use fairline_vault::flp_j::{Self, FLP_J, HolderJ};

/// Dynamic-field key for the emergency-pause flag. Stored as a dynamic field (not
/// a struct field) so it can be added to the already-published Vault by upgrade.
public struct PausedKey has copy, drop, store {}

/// Shared tranched vault, generic over the quote asset `T` (e.g. dUSDC).
public struct Vault<phantom T> has key {
    id: UID,
    reserve: Balance<T>,             // idle quote asset held by the vault
    deployed: u64,                   // quote asset out with the strategy, at reported value
    s_treasury: TreasuryCap<FLP_S>,  // mints / burns senior shares
    j_treasury: TreasuryCap<FLP_J>,  // mints / burns junior shares
    senior_value: u64,               // senior tranche's claim on NAV (junior = NAV − this)
    senior_principal: u64,           // senior net deposits — the accrual base
    marked_at: u64,                  // last mark/settle time (ms) — accrual + freshness
    lifetime_deposited: u64,
    lifetime_withdrawn: u64,
}

/// Operator capability — required to deploy/settle/mark strategy capital.
public struct AdminCap has key, store { id: UID }

// ── Policy constants ─────────────────────────────────────────────────────────
const SENIOR_TARGET_BPS: u64 = 800;             // senior target yield: 8% APR
const BPS_DENOM: u128        = 10_000;
const MS_PER_YEAR: u128      = 31_536_000_000;  // 365d in ms

// Honest-edge capacity: the house edge is capacity-constrained (only so much
// prediction-market spread to capture), so the vault refuses deposits past what
// it can productively deploy rather than silently diluting everyone's yield.
const VAULT_CAPACITY: u64 = 3_000_000_000;      // 3,000 dUSDC (6 decimals)

// Withdrawal-liquidity / anti-drain floor: a deploy must leave at least this
// fraction of NAV idle in reserve, so (a) depositors always have liquidity to
// withdraw and (b) a single compromised-key deploy can never pull 100% out.
const MIN_RESERVE_BPS: u64 = 1_500;             // 15% of NAV must stay liquid

// ── Errors ──────────────────────────────────────────────────────────────────
const EZeroAmount: u64 = 0;
const EInsufficientReserve: u64 = 1;
const EZeroShares: u64 = 2;
const EDeployTooLarge: u64 = 3;
const ECapacityFull: u64 = 4;
const EPaused: u64 = 5;                          // vault paused — deposits/deploys halted
const EReserveFloor: u64 = 6;                    // deploy would breach the 15% reserve floor

// ── Events ──────────────────────────────────────────────────────────────────
public struct Deposited has copy, drop { depositor: address, tranche: u8, amount: u64, shares: u64, senior_value: u64, nav: u64 }
public struct Withdrawn has copy, drop { withdrawer: address, tranche: u8, shares: u64, amount: u64, senior_value: u64, nav: u64 }
public struct Deployed has copy, drop { amount: u64, total_deployed: u64 }
public struct Settled has copy, drop { returned: u64, new_deployed: u64, senior_value: u64, nav: u64, marked_at: u64 }
public struct Marked has copy, drop { old_nav: u64, new_nav: u64, senior_value: u64, junior_value: u64, marked_at: u64 }
public struct PauseSet has copy, drop { paused: bool }

const TR_SENIOR: u8 = 0;
const TR_JUNIOR: u8 = 1;

// ── Init / create ────────────────────────────────────────────────────────────

fun init(ctx: &mut TxContext) {
    transfer::transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
}

/// Create the shared tranched Vault for quote asset `T`, consuming both tranche
/// treasury holders minted by `flp_s`/`flp_j` at publish.
public fun create<T>(hs: HolderS, hj: HolderJ, clock: &Clock, ctx: &mut TxContext) {
    transfer::share_object(Vault<T> {
        id: object::new(ctx),
        reserve: balance::zero<T>(),
        deployed: 0,
        s_treasury: flp_s::into_treasury(hs),
        j_treasury: flp_j::into_treasury(hj),
        senior_value: 0,
        senior_principal: 0,
        marked_at: clock.timestamp_ms(),
        lifetime_deposited: 0,
        lifetime_withdrawn: 0,
    });
}

// ── Views ─────────────────────────────────────────────────────────────────────

/// Total assets under management = idle reserve + deployed (reported) value.
public fun nav<T>(v: &Vault<T>): u64 { balance::value(&v.reserve) + v.deployed }
public fun reserve_value<T>(v: &Vault<T>): u64 { balance::value(&v.reserve) }
public fun deployed<T>(v: &Vault<T>): u64 { v.deployed }
public fun senior_value<T>(v: &Vault<T>): u64 { v.senior_value }
public fun junior_value<T>(v: &Vault<T>): u64 { nav(v) - v.senior_value }
public fun senior_principal<T>(v: &Vault<T>): u64 { v.senior_principal }
public fun senior_shares<T>(v: &Vault<T>): u64 { coin::total_supply(&v.s_treasury) }
public fun junior_shares<T>(v: &Vault<T>): u64 { coin::total_supply(&v.j_treasury) }
public fun marked_at<T>(v: &Vault<T>): u64 { v.marked_at }
public fun capacity<T>(_v: &Vault<T>): u64 { VAULT_CAPACITY }
/// Emergency-pause state. When true, deposits and deploys are halted; withdrawals
/// are NEVER pausable so depositors can always exit.
public fun is_paused<T>(v: &Vault<T>): bool {
    df::exists_(&v.id, PausedKey {}) && *df::borrow<PausedKey, bool>(&v.id, PausedKey {})
}

fun min_u64(a: u64, b: u64): u64 { if (a < b) a else b }

// ── User: deposit ────────────────────────────────────────────────────────────

/// Deposit into the SENIOR tranche; receive FLP-S at the senior share price.
public fun deposit_senior<T>(v: &mut Vault<T>, coin: Coin<T>, ctx: &mut TxContext): Coin<FLP_S> {
    assert!(!is_paused(v), EPaused);
    let amount = coin::value(&coin);
    assert!(amount > 0, EZeroAmount);
    assert!(nav(v) + amount <= VAULT_CAPACITY, ECapacityFull);

    let supply = coin::total_supply(&v.s_treasury);
    let shares = if (supply == 0 || v.senior_value == 0) amount
        else { (((amount as u128) * (supply as u128)) / (v.senior_value as u128)) as u64 };
    assert!(shares > 0, EZeroShares);

    balance::join(&mut v.reserve, coin::into_balance(coin));
    v.senior_value = v.senior_value + amount;
    v.senior_principal = v.senior_principal + amount;
    v.lifetime_deposited = v.lifetime_deposited + amount;

    let out = coin::mint(&mut v.s_treasury, shares, ctx);
    event::emit(Deposited { depositor: ctx.sender(), tranche: TR_SENIOR, amount, shares, senior_value: v.senior_value, nav: nav(v) });
    out
}

/// Deposit into the JUNIOR tranche; receive FLP-J at the junior share price.
public fun deposit_junior<T>(v: &mut Vault<T>, coin: Coin<T>, ctx: &mut TxContext): Coin<FLP_J> {
    assert!(!is_paused(v), EPaused);
    let amount = coin::value(&coin);
    assert!(amount > 0, EZeroAmount);
    assert!(nav(v) + amount <= VAULT_CAPACITY, ECapacityFull);

    let jv_before = nav(v) - v.senior_value;   // junior value before this deposit
    let supply = coin::total_supply(&v.j_treasury);
    let shares = if (supply == 0 || jv_before == 0) amount
        else { (((amount as u128) * (supply as u128)) / (jv_before as u128)) as u64 };
    assert!(shares > 0, EZeroShares);

    balance::join(&mut v.reserve, coin::into_balance(coin));   // NAV up by amount; senior_value unchanged → junior up by amount
    v.lifetime_deposited = v.lifetime_deposited + amount;

    let out = coin::mint(&mut v.j_treasury, shares, ctx);
    event::emit(Deposited { depositor: ctx.sender(), tranche: TR_JUNIOR, amount, shares, senior_value: v.senior_value, nav: nav(v) });
    out
}

// ── User: withdraw ───────────────────────────────────────────────────────────

/// Burn FLP-S for a pro-rata claim on the senior tranche, paid from reserve.
public fun withdraw_senior<T>(v: &mut Vault<T>, shares: Coin<FLP_S>, ctx: &mut TxContext): Coin<T> {
    let n = coin::value(&shares);
    assert!(n > 0, EZeroShares);
    let supply = coin::total_supply(&v.s_treasury);

    let amount = (((n as u128) * (v.senior_value as u128)) / (supply as u128)) as u64;
    assert!(amount <= balance::value(&v.reserve), EInsufficientReserve);

    // Retire senior principal pro-rata to the shares burned (gains sit above principal).
    let prin_red = (((n as u128) * (v.senior_principal as u128)) / (supply as u128)) as u64;
    v.senior_principal = v.senior_principal - min_u64(v.senior_principal, prin_red);
    v.senior_value = v.senior_value - amount;
    v.lifetime_withdrawn = v.lifetime_withdrawn + amount;

    coin::burn(&mut v.s_treasury, shares);
    let out = coin::take(&mut v.reserve, amount, ctx);
    event::emit(Withdrawn { withdrawer: ctx.sender(), tranche: TR_SENIOR, shares: n, amount, senior_value: v.senior_value, nav: nav(v) });
    out
}

/// Burn FLP-J for a pro-rata claim on the junior tranche, paid from reserve.
public fun withdraw_junior<T>(v: &mut Vault<T>, shares: Coin<FLP_J>, ctx: &mut TxContext): Coin<T> {
    let n = coin::value(&shares);
    assert!(n > 0, EZeroShares);
    let supply = coin::total_supply(&v.j_treasury);

    let jv = nav(v) - v.senior_value;
    let amount = (((n as u128) * (jv as u128)) / (supply as u128)) as u64;
    assert!(amount <= balance::value(&v.reserve), EInsufficientReserve);

    v.lifetime_withdrawn = v.lifetime_withdrawn + amount;
    coin::burn(&mut v.j_treasury, shares);
    let out = coin::take(&mut v.reserve, amount, ctx);   // NAV down by amount; senior_value unchanged → junior down by amount
    event::emit(Withdrawn { withdrawer: ctx.sender(), tranche: TR_JUNIOR, shares: n, amount, senior_value: v.senior_value, nav: nav(v) });
    out
}

// ── Waterfall ────────────────────────────────────────────────────────────────

/// Allocate the NAV change since the last mark between the tranches and stamp
/// `marked_at`. Profit goes to senior up to its target accrual, then to junior;
/// losses hit junior first, senior only once junior is wiped.
fun apply_pnl<T>(v: &mut Vault<T>, old_nav: u64, new_nav: u64, now_ms: u64) {
    let elapsed = if (now_ms > v.marked_at) ((now_ms - v.marked_at) as u128) else 0;
    if (new_nav >= old_nav) {
        let profit = (new_nav - old_nav) as u128;
        // senior target accrual over the elapsed window on senior principal
        let target = (v.senior_principal as u128) * (SENIOR_TARGET_BPS as u128) * elapsed / BPS_DENOM / MS_PER_YEAR;
        let senior_gain = if (profit < target) profit else target;
        v.senior_value = v.senior_value + (senior_gain as u64);
    } else {
        // loss: junior absorbs first; senior only takes the residual once junior = 0
        if (new_nav < v.senior_value) { v.senior_value = new_nav; };
    };
    v.marked_at = now_ms;
}

// ── Operator: deploy / settle / mark ─────────────────────────────────────────

/// Move `amount` of idle reserve out to run the LP strategy. Value is conserved
/// (reserve down, deployed up), so NAV and both tranches are unchanged.
public fun deploy<T>(_: &AdminCap, v: &mut Vault<T>, amount: u64, ctx: &mut TxContext): Coin<T> {
    assert!(!is_paused(v), EPaused);
    assert!(amount > 0, EZeroAmount);
    let reserve_bal = balance::value(&v.reserve);
    assert!(amount <= reserve_bal, EInsufficientReserve);
    // Must leave ≥ MIN_RESERVE_BPS of NAV idle (NAV is invariant across deploy):
    // guarantees withdrawal liquidity and caps a single deploy below 100% drain.
    assert!(((reserve_bal - amount) as u128) * BPS_DENOM >= (nav(v) as u128) * (MIN_RESERVE_BPS as u128), EReserveFloor);
    v.deployed = v.deployed + amount;
    let out = coin::take(&mut v.reserve, amount, ctx);
    event::emit(Deployed { amount, total_deployed: v.deployed });
    out
}

/// Operator: set or clear the emergency pause (halts deposits + deploys).
/// Withdrawals are never gated, so depositors can always exit even while paused.
public fun set_paused<T>(_: &AdminCap, v: &mut Vault<T>, paused: bool) {
    if (df::exists_(&v.id, PausedKey {})) {
        *df::borrow_mut<PausedKey, bool>(&mut v.id, PausedKey {}) = paused;
    } else {
        df::add(&mut v.id, PausedKey {}, paused);
    };
    event::emit(PauseSet { paused });
}

/// Return strategy capital and report remaining deployed value; runs the
/// waterfall over the realized P&L and stamps the mark time.
public fun settle<T>(_: &AdminCap, v: &mut Vault<T>, coin: Coin<T>, new_deployed: u64, clock: &Clock) {
    let returned = coin::value(&coin);
    assert!(new_deployed <= v.deployed + returned, EDeployTooLarge);
    let old_nav = nav(v);
    balance::join(&mut v.reserve, coin::into_balance(coin));
    v.deployed = new_deployed;
    let new_nav = nav(v);
    apply_pnl(v, old_nav, new_nav, clock.timestamp_ms());
    event::emit(Settled { returned, new_deployed, senior_value: v.senior_value, nav: new_nav, marked_at: v.marked_at });
}

/// Mark-to-market the deployed value (no cash move); runs the waterfall over the
/// NAV change and stamps `marked_at` so freshness is provable on-chain.
public fun mark<T>(_: &AdminCap, v: &mut Vault<T>, new_deployed: u64, clock: &Clock) {
    let old_nav = nav(v);
    v.deployed = new_deployed;
    let new_nav = nav(v);
    apply_pnl(v, old_nav, new_nav, clock.timestamp_ms());
    event::emit(Marked { old_nav, new_nav, senior_value: v.senior_value, junior_value: new_nav - v.senior_value, marked_at: v.marked_at });
}

// ── Test-only init ──────────────────────────────────────────────────────────────
#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }

// Test-only: move reserve→deployed without the reserve-floor/pause checks, so the
// waterfall/withdrawal tests can set up 100%-deployed scenarios. The real `deploy`
// (with floor + pause) is exercised by the dedicated floor/pause tests.
#[test_only]
public fun deploy_unchecked<T>(_: &AdminCap, v: &mut Vault<T>, amount: u64, ctx: &mut TxContext): Coin<T> {
    v.deployed = v.deployed + amount;
    coin::take(&mut v.reserve, amount, ctx)
}
