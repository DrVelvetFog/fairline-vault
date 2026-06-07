#[test_only]
module fairline_vault::rewards_tests;

use sui::test_scenario as ts;
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use fairline_vault::rewards::{Self, RewardPool, RewardAdminCap};

const OP: address = @0xA;
const ALICE: address = @0xB;

#[test]
fun fund_and_rebate() {
    let mut sc = ts::begin(OP);
    rewards::create_pool<SUI>(sc.ctx());

    sc.next_tx(OP);
    {
        let mut pool = sc.take_shared<RewardPool<SUI>>();
        rewards::fund(&mut pool, coin::mint_for_testing<SUI>(1000, sc.ctx()));
        assert!(rewards::pool_balance(&pool) == 1000, 0);
        assert!(rewards::lifetime_funded(&pool) == 1000, 1);
        ts::return_shared(pool);
    };

    // Operator rebates 300 to a predictor.
    sc.next_tx(OP);
    {
        let cap = sc.take_from_sender<RewardAdminCap>();
        let mut pool = sc.take_shared<RewardPool<SUI>>();
        rewards::reward(&cap, &mut pool, ALICE, 300, sc.ctx());
        assert!(rewards::pool_balance(&pool) == 700, 2);
        assert!(rewards::lifetime_rebated(&pool) == 300, 3);
        assert!(rewards::rebate_count(&pool) == 1, 4);
        ts::return_shared(pool);
        sc.return_to_sender(cap);
    };

    // The predictor received the rebate.
    sc.next_tx(ALICE);
    {
        let c = sc.take_from_sender<Coin<SUI>>();
        assert!(coin::value(&c) == 300, 5);
        transfer::public_transfer(c, ALICE);
    };

    sc.end();
}

#[test, expected_failure(abort_code = fairline_vault::rewards::EInsufficientPool)]
fun rebate_over_balance_aborts() {
    let mut sc = ts::begin(OP);
    rewards::create_pool<SUI>(sc.ctx());

    sc.next_tx(OP);
    {
        let mut pool = sc.take_shared<RewardPool<SUI>>();
        rewards::fund(&mut pool, coin::mint_for_testing<SUI>(100, sc.ctx()));
        ts::return_shared(pool);
    };
    sc.next_tx(OP);
    {
        let cap = sc.take_from_sender<RewardAdminCap>();
        let mut pool = sc.take_shared<RewardPool<SUI>>();
        rewards::reward(&cap, &mut pool, ALICE, 101, sc.ctx());   // > pool balance → abort
        ts::return_shared(pool);
        sc.return_to_sender(cap);
    };
    sc.end();
}
