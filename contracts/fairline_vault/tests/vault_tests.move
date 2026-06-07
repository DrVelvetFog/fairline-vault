#[test_only]
module fairline_vault::vault_tests;

use sui::test_scenario as ts;
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::clock;
use fairline_vault::vault::{Self, Vault, AdminCap};
use fairline_vault::flp_s::{Self, FLP_S, HolderS};
use fairline_vault::flp_j::{Self, FLP_J, HolderJ};

const OP: address = @0xA;
const ALICE: address = @0xB;   // senior depositor
const BOB: address = @0xC;     // junior depositor

const ONE_YEAR_MS: u64 = 31_536_000_000;

// Publish the three modules and create the typed tranched vault.
fun bootstrap(sc: &mut ts::Scenario, clock: &clock::Clock) {
    vault::init_for_testing(sc.ctx());
    flp_s::init_for_testing(sc.ctx());
    flp_j::init_for_testing(sc.ctx());
    sc.next_tx(OP);
    let hs = sc.take_from_sender<HolderS>();
    let hj = sc.take_from_sender<HolderJ>();
    vault::create<SUI>(hs, hj, clock, sc.ctx());
}

#[test]
fun tranche_profit_waterfall_and_withdraw() {
    let mut sc = ts::begin(OP);
    let mut clk = clock::create_for_testing(sc.ctx());
    bootstrap(&mut sc, &clk);

    // Alice → senior 1000 (bootstrap 1:1). Bob → junior 1000 (bootstrap 1:1).
    sc.next_tx(ALICE);
    {
        let mut v = sc.take_shared<Vault<SUI>>();
        let s = vault::deposit_senior(&mut v, coin::mint_for_testing<SUI>(1000, sc.ctx()), sc.ctx());
        assert!(coin::value(&s) == 1000, 0);
        transfer::public_transfer(s, ALICE);
        ts::return_shared(v);
    };
    sc.next_tx(BOB);
    {
        let mut v = sc.take_shared<Vault<SUI>>();
        let j = vault::deposit_junior(&mut v, coin::mint_for_testing<SUI>(1000, sc.ctx()), sc.ctx());
        assert!(coin::value(&j) == 1000, 1);
        assert!(vault::nav(&v) == 2000, 2);
        assert!(vault::senior_value(&v) == 1000, 3);
        assert!(vault::junior_value(&v) == 1000, 4);
        transfer::public_transfer(j, BOB);
        ts::return_shared(v);
    };

    // Operator deploys all 2000 to the strategy.
    sc.next_tx(OP);
    {
        let cap = sc.take_from_sender<AdminCap>();
        let mut v = sc.take_shared<Vault<SUI>>();
        let d = vault::deploy(&cap, &mut v, 2000, sc.ctx());
        transfer::public_transfer(d, OP);
        ts::return_shared(v);
        sc.return_to_sender(cap);
    };

    // One year later, settle back 2100 (100 profit). Senior target = 1000 × 8% × 1yr
    // = 80, so senior takes 80, junior the remaining 20.
    clock::set_for_testing(&mut clk, ONE_YEAR_MS);
    sc.next_tx(OP);
    {
        let cap = sc.take_from_sender<AdminCap>();
        let mut v = sc.take_shared<Vault<SUI>>();
        vault::settle(&cap, &mut v, coin::mint_for_testing<SUI>(2100, sc.ctx()), 0, &clk);
        assert!(vault::nav(&v) == 2100, 5);
        assert!(vault::senior_value(&v) == 1080, 6);   // 1000 + 80 (capped)
        assert!(vault::junior_value(&v) == 1020, 7);   // 1000 + 20 (residual)
        assert!(vault::marked_at(&v) == ONE_YEAR_MS, 8);
        ts::return_shared(v);
        sc.return_to_sender(cap);
    };

    // Bob (junior) withdraws all → 1020. Alice (senior) withdraws all → 1080.
    sc.next_tx(BOB);
    {
        let mut v = sc.take_shared<Vault<SUI>>();
        let j = sc.take_from_sender<Coin<FLP_J>>();
        let out = vault::withdraw_junior(&mut v, j, sc.ctx());
        assert!(coin::value(&out) == 1020, 9);
        transfer::public_transfer(out, BOB);
        ts::return_shared(v);
    };
    sc.next_tx(ALICE);
    {
        let mut v = sc.take_shared<Vault<SUI>>();
        let s = sc.take_from_sender<Coin<FLP_S>>();
        let out = vault::withdraw_senior(&mut v, s, sc.ctx());
        assert!(coin::value(&out) == 1080, 10);
        assert!(vault::nav(&v) == 0, 11);
        assert!(vault::senior_shares(&v) == 0, 12);
        assert!(vault::junior_shares(&v) == 0, 13);
        transfer::public_transfer(out, ALICE);
        ts::return_shared(v);
    };

    clock::destroy_for_testing(clk);
    sc.end();
}

#[test]
fun junior_absorbs_loss_then_wipes() {
    let mut sc = ts::begin(OP);
    let mut clk = clock::create_for_testing(sc.ctx());
    bootstrap(&mut sc, &clk);

    // Senior 1000 + junior 1000, all deployed.
    sc.next_tx(ALICE);
    { let mut v = sc.take_shared<Vault<SUI>>(); let s = vault::deposit_senior(&mut v, coin::mint_for_testing<SUI>(1000, sc.ctx()), sc.ctx()); transfer::public_transfer(s, ALICE); ts::return_shared(v); };
    sc.next_tx(BOB);
    { let mut v = sc.take_shared<Vault<SUI>>(); let j = vault::deposit_junior(&mut v, coin::mint_for_testing<SUI>(1000, sc.ctx()), sc.ctx()); transfer::public_transfer(j, BOB); ts::return_shared(v); };
    sc.next_tx(OP);
    { let cap = sc.take_from_sender<AdminCap>(); let mut v = sc.take_shared<Vault<SUI>>(); let d = vault::deploy(&cap, &mut v, 2000, sc.ctx()); transfer::public_transfer(d, OP); ts::return_shared(v); sc.return_to_sender(cap); };

    // Mark a 200 loss (deployed 2000 → 1800). Junior absorbs all of it; senior intact.
    sc.next_tx(OP);
    {
        let cap = sc.take_from_sender<AdminCap>();
        let mut v = sc.take_shared<Vault<SUI>>();
        vault::mark(&cap, &mut v, 1800, &clk);
        assert!(vault::nav(&v) == 1800, 0);
        assert!(vault::senior_value(&v) == 1000, 1);   // protected
        assert!(vault::junior_value(&v) == 800, 2);    // took the hit
        ts::return_shared(v);
        sc.return_to_sender(cap);
    };

    // Mark a catastrophic loss (deployed → 900, below senior). Junior wiped to 0,
    // senior takes the residual loss.
    sc.next_tx(OP);
    {
        let cap = sc.take_from_sender<AdminCap>();
        let mut v = sc.take_shared<Vault<SUI>>();
        vault::mark(&cap, &mut v, 900, &clk);
        assert!(vault::nav(&v) == 900, 3);
        assert!(vault::senior_value(&v) == 900, 4);    // residual loss
        assert!(vault::junior_value(&v) == 0, 5);      // wiped
        ts::return_shared(v);
        sc.return_to_sender(cap);
    };

    clock::destroy_for_testing(clk);
    sc.end();
}

#[test, expected_failure(abort_code = fairline_vault::vault::ECapacityFull)]
fun deposit_over_capacity_aborts() {
    let mut sc = ts::begin(OP);
    let clk = clock::create_for_testing(sc.ctx());
    bootstrap(&mut sc, &clk);

    sc.next_tx(ALICE);
    {
        let mut v = sc.take_shared<Vault<SUI>>();
        // capacity() is 3,000,000,000 — one over it must abort.
        let cap = vault::capacity(&v);
        let j = vault::deposit_junior(&mut v, coin::mint_for_testing<SUI>(cap + 1, sc.ctx()), sc.ctx());
        transfer::public_transfer(j, ALICE);
        ts::return_shared(v);
    };

    clock::destroy_for_testing(clk);
    sc.end();
}

#[test, expected_failure(abort_code = fairline_vault::vault::EInsufficientReserve)]
fun withdraw_blocked_when_deployed() {
    let mut sc = ts::begin(OP);
    let clk = clock::create_for_testing(sc.ctx());
    bootstrap(&mut sc, &clk);

    sc.next_tx(ALICE);
    { let mut v = sc.take_shared<Vault<SUI>>(); let s = vault::deposit_senior(&mut v, coin::mint_for_testing<SUI>(1000, sc.ctx()), sc.ctx()); transfer::public_transfer(s, ALICE); ts::return_shared(v); };
    sc.next_tx(OP);
    { let cap = sc.take_from_sender<AdminCap>(); let mut v = sc.take_shared<Vault<SUI>>(); let d = vault::deploy(&cap, &mut v, 1000, sc.ctx()); transfer::public_transfer(d, OP); ts::return_shared(v); sc.return_to_sender(cap); };
    sc.next_tx(ALICE);
    {
        let mut v = sc.take_shared<Vault<SUI>>();
        let s = sc.take_from_sender<Coin<FLP_S>>();
        let out = vault::withdraw_senior(&mut v, s, sc.ctx());   // reserve empty → abort
        transfer::public_transfer(out, ALICE);
        ts::return_shared(v);
    };

    clock::destroy_for_testing(clk);
    sc.end();
}
