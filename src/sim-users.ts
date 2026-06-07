/**
 * Multi-user platform simulation — scale FairLine to N synthetic depositors.
 *
 *   npx tsx src/sim-users.ts            # PREFLIGHT (read-only): plan + exact SUI needed
 *   npx tsx src/sim-users.ts --live     # EXECUTE: redeem PLP, fund, deposit, withdraw
 *
 * Lifecycle (mirrors demo-multiuser.ts, generalised to N users):
 *   1. Redeem ~REDEEM_PLP_DUSDC of operator PLP → dUSDC (only if loose < need).
 *   2. Generate N keypairs (logs/sim-wallets.json, gitignored).
 *   3. Operator funds each user dUSDC + SUI gas (chunked PTBs).
 *   4. Each user signs a deposit → FLP shares (genuinely distinct depositors).
 *   5. N_WITHDRAWERS random users withdraw part of their FLP (pro-rata proof).
 */

import 'dotenv/config';
import * as fs from 'fs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { client, getAddress, execute } from './wallet.js';
import { getDusdcCoins, getPlpCoins } from './coins.js';
import { buildDepositSenior, buildDepositJunior, buildWithdrawSenior, buildWithdrawJunior, getVaultState, getPlpRate } from './vault.js';
import { ensureFreshMark } from './fairness.js';
import {
  DUSDC_TYPE, FLP_S_TYPE, FLP_J_TYPE, PLP_TYPE, humanToDusdc, dusdcToHuman,
  PREDICT_PACKAGE, PREDICT_OBJECT,
} from './config.js';

// Tranche split: ~60% of users go senior (protected), ~40% junior (leveraged).
const isSenior = (i: number) => (i % 5) < 3;

// ── Tunables ──────────────────────────────────────────────────────────────────
const N_USERS              = 50;
const TARGET_TOTAL_DEPOSIT = 2500;   // dUSDC across all users
const MIN_DEPOSIT          = 8;      // per-user floor
const MAX_DEPOSIT          = 90;     // per-user ceiling
const N_WITHDRAWERS        = 10;     // users who withdraw part of their FLP
const WITHDRAW_FRAC        = 0.4;    // fraction of FLP they redeem
const GAS_PER_USER_SUI     = 0.02;   // SUI funded to each user for gas (real deposit cost ~0.004)
const OPERATOR_GAS_BUFFER  = 0.15;   // SUI kept for operator's own txs (redeem + funding)
const DUSDC_BUFFER         = 50;     // loose dUSDC kept spare after funding
const FUND_CHUNK           = 25;     // users funded per PTB
const WALLET_FILE          = 'logs/sim-wallets.json';
const CLOCK                = '0x6';

const LIVE = process.argv.includes('--live');
const MIST = 1_000_000_000;

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

/** Deterministic-ish log-normal-shaped deposit sizes summing to ~TARGET. */
function genDeposits(): number[] {
  const raw: number[] = [];
  for (let i = 0; i < N_USERS; i++) {
    // log-normal-ish: most small, a few large
    const u = Math.random();
    raw.push(Math.exp(u * 2.3));               // 1 .. ~10
  }
  const scale = TARGET_TOTAL_DEPOSIT / sum(raw);
  return raw.map(r => {
    const v = Math.min(MAX_DEPOSIT, Math.max(MIN_DEPOSIT, Math.round(r * scale * 100) / 100));
    return v;
  });
}

function loadOrGenWallets(): Ed25519Keypair[] {
  try {
    const arr = JSON.parse(fs.readFileSync(WALLET_FILE, 'utf-8'));
    if (Array.isArray(arr) && arr.length >= N_USERS) {
      return arr.slice(0, N_USERS).map((w: any) => Ed25519Keypair.fromSecretKey(w.secretKey));
    }
  } catch {}
  const kps = Array.from({ length: N_USERS }, () => Ed25519Keypair.generate());
  fs.mkdirSync('logs', { recursive: true });
  fs.writeFileSync(WALLET_FILE, JSON.stringify(
    kps.map(k => ({ secretKey: k.getSecretKey(), address: k.toSuiAddress() })), null, 2));
  return kps;
}

/** Operator: split `plpAmountRaw` off a PLP coin and burn it for dUSDC. */
function buildPartialPlpRedeem(plpCoinId: string, plpAmountRaw: bigint, sender: string): Transaction {
  const tx = new Transaction();
  const [part] = tx.splitCoins(tx.object(plpCoinId), [tx.pure.u64(plpAmountRaw)]);
  const dusdc = tx.moveCall({
    target: `${PREDICT_PACKAGE}::predict::withdraw`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(PREDICT_OBJECT), part, tx.object(CLOCK)],
  });
  tx.transferObjects([dusdc], sender);
  return tx;
}

async function signExec(tx: Transaction, kp: Ed25519Keypair): Promise<void> {
  tx.setSender(kp.toSuiAddress());
  tx.setGasBudget(15_000_000);
  const r = await client.signAndExecuteTransaction({ transaction: tx, signer: kp, options: { showEffects: true } });
  await client.waitForTransaction({ digest: r.digest });
  if (r.effects?.status.status !== 'success') throw new Error(`tx failed: ${r.effects?.status.error}`);
}

async function main() {
  const op = getAddress();
  const deposits = genDeposits();
  const totalDeposit = sum(deposits);

  const opDusdc = (await getDusdcCoins(op)).totalHuman;
  const opSui   = Number((await client.getBalance({ owner: op, coinType: '0x2::sui::SUI' })).totalBalance) / MIST;
  const plpCoins = await getPlpCoins(op);
  const plpRate  = await getPlpRate();
  const opPlpDusdc = plpCoins.reduce((s, c) => s + Number(c.balance), 0) / 1e6 * plpRate;

  const dusdcNeed   = totalDeposit + DUSDC_BUFFER;
  const dusdcGap    = Math.max(0, dusdcNeed - opDusdc);            // must come from PLP redeem
  const suiNeed     = N_USERS * GAS_PER_USER_SUI + OPERATOR_GAS_BUFFER;
  const suiGap      = Math.max(0, suiNeed - opSui);

  console.log('\n━━━━━━━━━━━━━ FairLine N-user simulation — PLAN ━━━━━━━━━━━━━\n');
  console.log(`Mode               : ${LIVE ? '🔴 LIVE (will move funds)' : '🟢 PREFLIGHT (read-only)'}`);
  console.log(`Users              : ${N_USERS}  (+${N_WITHDRAWERS} will withdraw ~${WITHDRAW_FRAC * 100}% of FLP)`);
  console.log(`Total deposits     : ${totalDeposit.toFixed(2)} dUSDC`);
  console.log(`Deposit range      : ${Math.min(...deposits).toFixed(2)} – ${Math.max(...deposits).toFixed(2)} (avg ${(totalDeposit / N_USERS).toFixed(2)})`);
  console.log('');
  console.log('OPERATOR resources:');
  console.log(`  loose dUSDC      : ${opDusdc.toFixed(2)}`);
  console.log(`  PLP value        : ${opPlpDusdc.toFixed(2)}  (rate ${plpRate.toFixed(6)})`);
  console.log(`  SUI (gas)        : ${opSui.toFixed(4)}`);
  console.log('');
  console.log('REQUIREMENTS:');
  console.log(`  dUSDC need       : ${dusdcNeed.toFixed(2)}  → gap ${dusdcGap.toFixed(2)} (redeem from PLP)`);
  console.log(`  SUI need         : ${suiNeed.toFixed(4)}  → gap ${suiGap.toFixed(4)}`);
  console.log('');

  if (suiGap > 0) {
    console.log('🚨 NOT ENOUGH SUI FOR GAS.');
    console.log(`   Faucet at least ${suiGap.toFixed(2)} SUI to the operator address:`);
    console.log(`   ${op}`);
    console.log(`   (target a total balance of ~${Math.ceil(suiNeed * 10) / 10} SUI for headroom)`);
    if (LIVE) { console.log('\n   Aborting live run until SUI is topped up.\n'); process.exit(1); }
  } else {
    console.log(`✅ SUI sufficient (${opSui.toFixed(3)} ≥ ${suiNeed.toFixed(3)}).`);
  }

  if (dusdcGap > 0 && opPlpDusdc < dusdcGap) {
    console.log(`\n🚨 PLP (${opPlpDusdc.toFixed(2)}) can't cover the dUSDC gap (${dusdcGap.toFixed(2)}). Lower TARGET_TOTAL_DEPOSIT.`);
    if (LIVE) process.exit(1);
  }

  if (!LIVE) {
    console.log('\nPreflight only — re-run with --live once SUI is topped up.\n');
    return;
  }

  // ── 1. Redeem PLP to cover the dUSDC gap ──────────────────────────────────────
  if (dusdcGap > 0) {
    const plpToRedeem = (dusdcGap * 1.02) / plpRate;            // +2% slack
    const plpRaw = BigInt(Math.round(plpToRedeem * 1e6));
    console.log(`\n[1] Redeeming ~${(plpToRedeem * plpRate).toFixed(2)} dUSDC of PLP…`);
    const r = await execute(buildPartialPlpRedeem(plpCoins[0].coinObjectId, plpRaw, op));
    console.log(`    ✓ ${r.digest}`);
  }

  // ── 2. Wallets ────────────────────────────────────────────────────────────────
  const users = loadOrGenWallets();
  console.log(`\n[2] ${users.length} synthetic wallets ready (${WALLET_FILE}).`);

  // ── 3. Fund users (chunked PTBs) ──────────────────────────────────────────────
  console.log(`\n[3] Funding users (chunks of ${FUND_CHUNK})…`);
  for (let start = 0; start < N_USERS; start += FUND_CHUNK) {
    const slice = users.slice(start, start + FUND_CHUNK);
    const amts  = deposits.slice(start, start + FUND_CHUNK);
    const coins = (await getDusdcCoins(op)).coins;
    const tx = new Transaction();
    const primary = tx.object(coins[0].coinObjectId);
    if (coins.length > 1) tx.mergeCoins(primary, coins.slice(1).map(c => tx.object(c.coinObjectId)));
    const dusdcOuts = tx.splitCoins(primary, amts.map(a => tx.pure.u64(humanToDusdc(a))));
    const suiOuts   = tx.splitCoins(tx.gas, slice.map(() => tx.pure.u64(Math.round(GAS_PER_USER_SUI * MIST))));
    slice.forEach((u, i) => tx.transferObjects([dusdcOuts[i], suiOuts[i]], u.toSuiAddress()));
    const r = await execute(tx);
    console.log(`    ✓ funded ${start + 1}–${start + slice.length}  tx ${r.digest}`);
  }

  // ── 3b. Mark to fair NAV so all deposits price at honest, freshly-marked value ─
  const fm = await ensureFreshMark();
  console.log(`\n[3b] Fair-pricing guard: ${fm.marked ? `marked to fair (tx ${fm.digest})` : `already fresh (drift ${fm.fairness.driftPct.toFixed(4)}%)`}`);

  // ── 4. Each user deposits into their assigned tranche ─────────────────────────
  const nSenior = [...Array(N_USERS).keys()].filter(isSenior).length;
  console.log(`\n[4] Users depositing → ${nSenior} senior (FLP-S) / ${N_USERS - nSenior} junior (FLP-J)…`);
  for (let i = 0; i < N_USERS; i++) {
    const u = users[i];
    const addr = u.toSuiAddress();
    const coins = (await getDusdcCoins(addr)).coins;
    const bal = coins.reduce((s, c) => s + BigInt(c.balance), 0n);
    if (bal === 0n) { console.log(`    ! user ${i + 1} has no dUSDC, skipping`); continue; }
    const tx = isSenior(i) ? buildDepositSenior(coins, bal, addr) : buildDepositJunior(coins, bal, addr);
    await signExec(tx, u);
    if ((i + 1) % 10 === 0) console.log(`    …${i + 1}/${N_USERS} deposited`);
  }

  // ── 5. Some users withdraw part of their tranche shares ───────────────────────
  console.log(`\n[5] ${N_WITHDRAWERS} users withdrawing ~${WITHDRAW_FRAC * 100}% of their shares…`);
  const idxs = [...Array(N_USERS).keys()].sort(() => Math.random() - 0.5).slice(0, N_WITHDRAWERS);
  for (const i of idxs) {
    const u = users[i];
    const addr = u.toSuiAddress();
    const sType = isSenior(i) ? FLP_S_TYPE : FLP_J_TYPE;
    const flp = (await client.getBalance({ owner: addr, coinType: sType })).totalBalance;
    const amt = (BigInt(flp) * BigInt(Math.round(WITHDRAW_FRAC * 100))) / 100n;
    if (amt === 0n) continue;
    const flpCoins = (await client.getCoins({ owner: addr, coinType: sType })).data;
    const tx = isSenior(i) ? buildWithdrawSenior(flpCoins, amt, addr) : buildWithdrawJunior(flpCoins, amt, addr);
    await signExec(tx, u);
    console.log(`    ✓ user ${i + 1} (${isSenior(i) ? 'senior' : 'junior'}) withdrew ${dusdcToHuman(amt).toFixed(2)} shares`);
  }

  // ── Final report ──────────────────────────────────────────────────────────────
  const v = await getVaultState();
  console.log('\n━━━━━━━━━━━━━ RESULT ━━━━━━━━━━━━━');
  console.log(`Vault NAV          : ${v.nav.toFixed(2)} dUSDC`);
  console.log(`  reserve / deployed: ${v.reserve.toFixed(2)} / ${v.deployed.toFixed(2)}`);
  console.log(`SENIOR (FLP-S)     : ${v.seniorValue.toFixed(2)} value | ${v.seniorShares.toFixed(2)} shares @ ${v.seniorPrice.toFixed(6)}`);
  console.log(`JUNIOR (FLP-J)     : ${v.juniorValue.toFixed(2)} value | ${v.juniorShares.toFixed(2)} shares @ ${v.juniorPrice.toFixed(6)}`);
  console.log(`Lifetime dep / wd  : ${v.lifetimeDeposited.toFixed(2)} / ${v.lifetimeWithdrawn.toFixed(2)}`);
  console.log(`Depositors         : ${N_USERS} synthetic across both tranches\n`);
}

main().catch(e => { console.error(String(e)); process.exit(1); });
