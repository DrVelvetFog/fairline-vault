/// FLP-S — the FairLine Senior tranche share token.
///
/// Its own module so it can own a one-time witness (each `Coin` currency needs
/// one). `init` mints the currency and hands the `TreasuryCap` to the publisher
/// inside a `HolderS`; `vault::create` consumes it to build the tranched vault.
#[allow(deprecated_usage)]
module fairline_vault::flp_s;

use sui::coin::{Self, TreasuryCap};

/// One-time witness; also the senior share-coin type.
public struct FLP_S has drop {}

/// Transient holder so the publisher can hand the treasury to `vault::create`.
public struct HolderS has key { id: UID, treasury: TreasuryCap<FLP_S> }

fun init(witness: FLP_S, ctx: &mut TxContext) {
    let (treasury, metadata) = coin::create_currency(
        witness,
        6,                       // decimals — match dUSDC
        b"FLP-S",
        b"FairLine Senior",
        b"Senior (principal-protected) tranche share of the FairLine vault",
        option::none(),
        ctx,
    );
    transfer::public_freeze_object(metadata);
    transfer::transfer(HolderS { id: object::new(ctx), treasury }, ctx.sender());
}

/// Package-internal: unwrap the holder into the treasury (used by vault::create).
public(package) fun into_treasury(h: HolderS): TreasuryCap<FLP_S> {
    let HolderS { id, treasury } = h;
    object::delete(id);
    treasury
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(FLP_S {}, ctx) }
