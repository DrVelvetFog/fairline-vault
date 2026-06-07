import 'dotenv/config';

export const PREDICT_SERVER = process.env.PREDICT_SERVER ?? 'https://predict-server.testnet.mystenlabs.com';
export const SUI_RPC_URL = process.env.SUI_RPC_URL ?? 'https://fullnode.testnet.sui.io:443';

// ── Deployed contract addresses (predict-testnet-4-16) ──────────────────────

export const PREDICT_PACKAGE  = '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';
export const PREDICT_OBJECT   = '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';
export const PREDICT_REGISTRY = '0x43af14fed5480c20ff77e2263d5f794c35b9fab7e2212903127062f4fe2a6e64';

// dUSDC — quote asset (6 decimals)
export const DUSDC_PACKAGE     = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a';
export const DUSDC_TYPE        = `${DUSDC_PACKAGE}::dusdc::DUSDC`;
export const DUSDC_CURRENCY_ID = '0xf3000dff421833d4bb8ed58fac146d691a3aaba2785aa1989af65a7089ca3e9c';
export const DUSDC_DECIMALS    = 6;

// PLP — liquidity provider token (same package as Predict)
export const PLP_TYPE = `${PREDICT_PACKAGE}::plp::PLP`;

// ── FairLine Vault (our own Move contract — tranched multi-user share vault) ──
// Published to testnet; users deposit dUSDC into the SENIOR (FLP-S, protected)
// or JUNIOR (FLP-J, first-loss/leveraged) tranche → pro-rata withdraw.
// VAULT_PACKAGE = original publish id — defines the FLP-S/FLP-J/Vault *types*.
// VAULT_PACKAGE_LATEST = newest upgraded id — target for *function calls* (new code).
export const VAULT_PACKAGE        = process.env.VAULT_PACKAGE        ?? '0x8c5c7e1205468970100265c17a8c9a80fe43d67bfed0230cb807f1f75e7029e4';
export const VAULT_PACKAGE_LATEST = process.env.VAULT_PACKAGE_LATEST ?? '0x686d8d1609d259b751dca545f99d5e186fd3d7e7f59cdd3838e79ecdf457c7bd';
export const VAULT_OBJECT    = process.env.VAULT_OBJECT    ?? '0x6f50a5439ef6df079f5807c93ac5bf14aa14f39841448395eb7ac8e40287d71e';
export const VAULT_ADMIN_CAP = process.env.VAULT_ADMIN_CAP ?? '0xc0e47b0700b566ca4d02e974a3739a645d668a823ffbf8bc2c1c88bd755e2196';
export const FLP_S_TYPE      = `${VAULT_PACKAGE}::flp_s::FLP_S`;   // senior share (original id)
export const FLP_J_TYPE      = `${VAULT_PACKAGE}::flp_j::FLP_J`;   // junior share (original id)

// ── House Flywheel — predictor rebate pool (rewards module) ───────────────────
export const REWARD_POOL      = process.env.REWARD_POOL      ?? '0x18e4b06c83aa7a4f2fde24989bdbbc94c5ebbfc78d9416fb10eafad2f0b3e5ee';
export const REWARD_ADMIN_CAP = process.env.REWARD_ADMIN_CAP ?? '0xf6463bb2461006999ca0ff1676727462a72f7c63bd3b1bdb709fb59a290ff5ce';
export const REBATE_EDGE_PCT  = 0.20;   // share of realized house edge routed to predictor rebates

// On-chain deposit capacity (mirror of VAULT_CAPACITY in vault.move) — the vault
// refuses deposits past this so the house edge isn't diluted past what it absorbs.
export const VAULT_CAPACITY  = 3000;   // dUSDC

// Old single-tranche vault (pre-2026-06-07), left intact on-chain, no longer wired:
//   pkg 0xfe5abfde…ccfb · vault 0x71a3…fb7e · adminCap 0xd92a…c9b2 · FLP <pkg>::vault::VAULT

// ── Vault policy ─────────────────────────────────────────────────────────────

// ── Liquidity provision (primary strategy) ───────────────────────────────────
// FairLine is LP-primary: it earns the vault's house edge by supplying PLP,
// and uses the ML/vol signal defensively to gate that exposure (LP's only real
// risk is a large directional move). Directional bets are a small capped sleeve.

// Target share of total capital to hold in PLP under normal conditions.
export const LP_TARGET_PCT  = 0.70;

// Absolute ceiling on PLP exposure (hard safety cap, dUSDC).
export const MAX_PLP_DUSDC  = 5000;

// Only rebalance LP when the target/current gap exceeds this (dUSDC) — avoids churn.
export const LP_REBALANCE_BAND = 20;

// Volatility thresholds — bypass hermes3 above these levels.
// 15-30%: supply to PLP (wide spread = LP earns more); >30%: skip entirely.
export const HIGH_VOL_THRESHOLD     = 15;   // vol% → supply only, no directional
export const EXTREME_VOL_THRESHOLD  = 30;   // vol% → skip entirely

// Position sizing as a fraction of total balance.
export const MIN_POSITION_PCT   = 0.01;  // 1%  — floor enforced in parseDecision
export const MAX_POSITION_PCT   = 0.05;  // 5%  — per-position ceiling
export const MAX_CYCLE_DEPLOY   = 0.15;  // 15% — total per cycle (3 × 5%)

// Absolute risk caps (dUSDC). These bound sizing regardless of balance, so bet
// size never scales off trapped/idle Manager capital. Effective size is
// min(% of balance, these caps). Tighten/loosen to change live risk exposure.
export const MAX_POSITION_USDC  = 15;    // hard ceiling per position
export const MAX_CYCLE_USDC     = 45;    // hard ceiling per cycle

// ── Scaling ──────────────────────────────────────────────────────────────────

// Oracle prices and strikes: 1e9 float scaling (DeepBook math convention)
export const PRICE_SCALE = 1_000_000_000n;

// dUSDC on-chain amounts: 1e6 (6 decimal token)
export const DUSDC_SCALE = 1_000_000n;

// Convert raw oracle price/strike → human USD
export const priceToHuman = (raw: bigint | number): number =>
  Number(BigInt(raw)) / Number(PRICE_SCALE);

// Convert raw dUSDC amount → human USDC
export const dusdcToHuman = (raw: bigint | number): number =>
  Number(BigInt(raw)) / Number(DUSDC_SCALE);

// Convert human USDC → raw dUSDC
export const humanToDusdc = (usd: number): bigint =>
  BigInt(Math.round(usd * Number(DUSDC_SCALE)));

// Your PredictManager object ID (created by npm run setup)
export const MANAGER_ID = process.env.MANAGER_ID ?? '';

// Wallet private key (testnet only — never put mainnet key here)
export const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY ?? '';

// Public wallet address — used for read-only views (dashboard) when no private
// key is configured. This is public on-chain info, never the private key.
export const WALLET_ADDRESS = process.env.WALLET_ADDRESS
  ?? '0x43a5782881f7ae4584fb7a3d9d9b3cd3440ed634a67301de5e45f734505e8e7d';
