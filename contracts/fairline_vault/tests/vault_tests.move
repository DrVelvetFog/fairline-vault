#[test_only]
module fairline_vault::vault_tests;

use sui::test_scenario as ts;
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use fairline_vault::vault::{Self, Vault, AdminCap, VAULT, TreasuryHolder};

const OP: address = @0xA;
const ALICE: address = @0xB;
const BOB: address = @0xC;

#[test]
fun deposit_deploy_settle_withdraw() {
    let mut sc = ts::begin(OP);

    // Publish + create the typed vault.
    vault::init_for_testing(sc.ctx());
    sc.next_tx(OP);
    {
        let holder = sc.take_from_sender<TreasuryHolder>();
        vault::create<SUI>(holder, sc.ctx());
    };

    // Alice deposits 1000 → 1000 shares (bootstrap 1:1).
    sc.next_tx(ALICE);
    {
        let mut v = sc.take_shared<Vault<SUI>>();
        let shares = vault::deposit(&mut v, coin::mint_for_testing<SUI>(1000, sc.ctx()), sc.ctx());
        assert!(coin::value(&shares) == 1000, 0);
        assert!(vault::nav(&v) == 1000, 1);
        transfer::public_transfer(shares, ALICE);
        ts::return_shared(v);
    };

    // Operator deploys 1000 to the strategy (NAV unchanged, value conserved).
    sc.next_tx(OP);
    {
        let cap = sc.take_from_sender<AdminCap>();
        let mut v = sc.take_shared<Vault<SUI>>();
        let deployed = vault::deploy(&cap, &mut v, 1000, sc.ctx());
        assert!(vault::nav(&v) == 1000, 2);
        assert!(vault::reserve_value(&v) == 0, 3);
        assert!(vault::deployed(&v) == 1000, 4);
        transfer::public_transfer(deployed, OP);
        ts::return_shared(v);
        sc.return_to_sender(cap);
    };

    // Operator settles: returns 1100 (100 profit), new_deployed 0 → NAV 1100.
    sc.next_tx(OP);
    {
        let cap = sc.take_from_sender<AdminCap>();
        let mut v = sc.take_shared<Vault<SUI>>();
        vault::settle(&cap, &mut v, coin::mint_for_testing<SUI>(1100, sc.ctx()), 0);
        assert!(vault::nav(&v) == 1100, 5);
        ts::return_shared(v);
        sc.return_to_sender(cap);
    };

    // Bob deposits 550 at share price 1.1 → 500 shares (fewer, as expected).
    sc.next_tx(BOB);
    {
        let mut v = sc.take_shared<Vault<SUI>>();
        let shares = vault::deposit(&mut v, coin::mint_for_testing<SUI>(550, sc.ctx()), sc.ctx());
        assert!(coin::value(&shares) == 500, 6);
        assert!(vault::nav(&v) == 1650, 7);
        assert!(vault::total_shares(&v) == 1500, 8);
        transfer::public_transfer(shares, BOB);
        ts::return_shared(v);
    };

    // Alice withdraws her 1000 shares → 1100 (principal + her share of profit).
    sc.next_tx(ALICE);
    {
        let mut v = sc.take_shared<Vault<SUI>>();
        let shares = sc.take_from_sender<Coin<VAULT>>();
        let out = vault::withdraw(&mut v, shares, sc.ctx());
        assert!(coin::value(&out) == 1100, 9);
        transfer::public_transfer(out, ALICE);
        ts::return_shared(v);
    };

    // Bob withdraws his 500 shares → 550 (break-even; deposited after the profit).
    sc.next_tx(BOB);
    {
        let mut v = sc.take_shared<Vault<SUI>>();
        let shares = sc.take_from_sender<Coin<VAULT>>();
        let out = vault::withdraw(&mut v, shares, sc.ctx());
        assert!(coin::value(&out) == 550, 10);
        assert!(vault::total_shares(&v) == 0, 11);
        transfer::public_transfer(out, BOB);
        ts::return_shared(v);
    };

    sc.end();
}

#[test, expected_failure(abort_code = fairline_vault::vault::EInsufficientReserve)]
fun withdraw_blocked_when_deployed() {
    let mut sc = ts::begin(OP);
    vault::init_for_testing(sc.ctx());
    sc.next_tx(OP);
    { let h = sc.take_from_sender<TreasuryHolder>(); vault::create<SUI>(h, sc.ctx()); };

    sc.next_tx(ALICE);
    {
        let mut v = sc.take_shared<Vault<SUI>>();
        let shares = vault::deposit(&mut v, coin::mint_for_testing<SUI>(1000, sc.ctx()), sc.ctx());
        transfer::public_transfer(shares, ALICE);
        ts::return_shared(v);
    };
    // Operator deploys everything → reserve empty.
    sc.next_tx(OP);
    {
        let cap = sc.take_from_sender<AdminCap>();
        let mut v = sc.take_shared<Vault<SUI>>();
        let d = vault::deploy(&cap, &mut v, 1000, sc.ctx());
        transfer::public_transfer(d, OP);
        ts::return_shared(v);
        sc.return_to_sender(cap);
    };
    // Alice tries to withdraw — must abort (funds deployed, reserve can't cover).
    sc.next_tx(ALICE);
    {
        let mut v = sc.take_shared<Vault<SUI>>();
        let shares = sc.take_from_sender<Coin<VAULT>>();
        let out = vault::withdraw(&mut v, shares, sc.ctx());
        transfer::public_transfer(out, ALICE);
        ts::return_shared(v);
    };
    sc.end();
}
