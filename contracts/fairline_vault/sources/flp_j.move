/// FLP-J — the FairLine Junior tranche share token.
///
/// Sibling of `flp_s`: its own one-time witness for the junior share currency.
/// Junior absorbs losses first and earns the leveraged upside tail.
#[allow(deprecated_usage)]
module fairline_vault::flp_j;

use sui::coin::{Self, TreasuryCap};

/// One-time witness; also the junior share-coin type.
public struct FLP_J has drop {}

/// Transient holder so the publisher can hand the treasury to `vault::create`.
public struct HolderJ has key { id: UID, treasury: TreasuryCap<FLP_J> }

fun init(witness: FLP_J, ctx: &mut TxContext) {
    let (treasury, metadata) = coin::create_currency(
        witness,
        6,                       // decimals — match dUSDC
        b"FLP-J",
        b"FairLine Junior",
        b"Junior (first-loss, leveraged) tranche share of the FairLine vault",
        option::none(),
        ctx,
    );
    transfer::public_freeze_object(metadata);
    transfer::transfer(HolderJ { id: object::new(ctx), treasury }, ctx.sender());
}

/// Package-internal: unwrap the holder into the treasury (used by vault::create).
public(package) fun into_treasury(h: HolderJ): TreasuryCap<FLP_J> {
    let HolderJ { id, treasury } = h;
    object::delete(id);
    treasury
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(FLP_J {}, ctx) }
