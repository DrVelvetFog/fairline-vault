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

// ── Vault policy ─────────────────────────────────────────────────────────────

// Maximum dUSDC that may sit in PLP at any time.
export const MAX_PLP_DUSDC = 500;

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
