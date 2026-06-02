/**
 * Allocation model — powered by hermes3 via local Ollama.
 *
 * Input:  MarketFeatures + manager balance + recent P&L history
 * Output: AllocationDecision — what to supply and mint this cycle
 *
 * hermes3 is used because it's specifically trained for structured JSON output
 * and is already installed in TonyAI's Ollama instance.
 */

import { MarketFeatures } from './features.js';
import { predict as mlPredict, formatPrediction, MLPrediction } from './ml-model.js';

const OLLAMA_URL  = 'http://127.0.0.1:11434';
const MODEL       = 'hermes3:latest';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PositionAllocation {
  type:           'up' | 'down' | 'range';
  strike?:        number;   // USD — for up/down
  lower_strike?:  number;   // USD — for range
  higher_strike?: number;   // USD — for range
  quantity_usdc:  number;   // max payout in dUSDC (cost = quantity × ask_price)
}

export interface AllocationDecision {
  reasoning:    string;
  supply_usdc:  number;               // dUSDC to supply as PLP
  positions:    PositionAllocation[]; // positions to mint
  confidence:   'high' | 'medium' | 'low';
  skip:         boolean;              // true = do nothing this cycle
  skip_reason?: string;
}

export interface CycleContext {
  features:       MarketFeatures;
  balance_usdc:   number;             // current manager balance (human dUSDC)
  realized_pnl:   number;             // cumulative realized P&L (human dUSDC)
  recent_history: string;             // summary of last N cycle outcomes
  ml_prediction?: MLPrediction;       // trained model signal (injected by cycle.ts)
}

// ── Prompt builders ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the allocation brain for FairLine, a DeepBook Predict vault on Sui testnet.

Each cycle you analyze BTC prediction market data and decide how to allocate capital.

PROTOCOL RULES:
- DeepBook Predict has rolling BTC binary options expiring every 15 minutes
- UP position: pays $1/unit if BTC settles ABOVE the strike at expiry
- DOWN position: pays $1/unit if BTC settles BELOW the strike at expiry
- RANGE position: pays $1/unit if BTC settles BETWEEN lower and higher strike
- Supply PLP: provide liquidity to the vault, earn spread income as counterparty
- quantity_usdc is the MAX PAYOUT — actual cost = quantity × ask_price (ask is 0 to 1)
- Strike must be a whole dollar amount, minimum $50,000

ALLOCATION CONSTRAINTS:
- Deploy at most 70% of balance per cycle (keep 30% reserve for gas + future cycles)
- Minimum position size: 1.0 dUSDC quantity
- Maximum 3 positions per cycle to keep it clean
- Skip the cycle if time_to_expiry < 3 minutes (too late to enter safely)
- Skip if balance < 2.0 dUSDC

WHEN TO USE EACH ALLOCATION TYPE:
- supply_usdc > 0  : when vol is HIGH (>10%) or trend is FLAT — earn the spread as counterparty instead of taking direction
- mint UP/DOWN     : when vol is LOW-MODERATE (<10%) and trend is clear — directional conviction play
- mint RANGE       : when vol is MODERATE and price has been ranging — bet on BTC staying within a $10 band
- Mix supply + position is valid — e.g. supply 5 dUSDC for passive yield while minting 3 dUSDC directional

GUIDANCE:
- Flat trend + any vol → prefer supply over skipping (earn spread passively)
- Vol > 10% → lean toward supply (wider spread = more LP income)
- Vol < 5% + clear trend → directional mint
- Vol 5-10% + trend → split: some supply, some direction

OUTPUT: Return ONLY valid JSON, no other text. Schema:
{
  "reasoning": "one clear sentence explaining the decision",
  "supply_usdc": 0.0,
  "positions": [
    { "type": "up", "strike": 71400, "quantity_usdc": 5.0 },
    { "type": "range", "lower_strike": 71000, "higher_strike": 72000, "quantity_usdc": 3.0 }
  ],
  "confidence": "high" | "medium" | "low",
  "skip": false,
  "skip_reason": null
}`;

function buildUserPrompt(ctx: CycleContext): string {
  const f = ctx.features;
  const deployable = Math.floor(ctx.balance_usdc * 0.7 * 100) / 100;

  // Snap ATM strike to nearest dollar
  const atm = Math.round(f.spot_usd);

  const mlLine = ctx.ml_prediction
    ? `\nML MODEL SIGNAL  : ${formatPrediction(ctx.ml_prediction)} — trust this signal, it has ${(ctx.ml_prediction.cv_accuracy * 100).toFixed(1)}% cross-validated accuracy`
    : '';

  return `MARKET STATE — ${new Date().toISOString()}${mlLine}
Asset          : ${f.underlying}
Spot           : $${f.spot_usd.toFixed(2)}
Forward        : $${f.forward_usd.toFixed(2)}
Time to expiry : ${f.time_to_expiry_min.toFixed(1)} minutes
Realized vol   : ${f.realized_vol_pct.toFixed(2)}% annualized  ← USE THIS EXACT NUMBER in your reasoning
Price trend    : ${f.price_trend} (${f.price_change_pct > 0 ? '+' : ''}${f.price_change_pct.toFixed(4)}% over last ${f.n_prices} prices)
Momentum       : ${f.momentum_pct.toFixed(4)}% (2nd half vs 1st half of window)
Range (window) : $${f.price_low_usd.toFixed(2)} – $${f.price_high_usd.toFixed(2)} (${f.range_pct.toFixed(4)}% of spot)
Basis          : ${f.basis_bps.toFixed(1)} bps (forward vs spot)

MANAGER STATE
Balance        : ${ctx.balance_usdc.toFixed(6)} dUSDC
Deployable     : ${deployable.toFixed(2)} dUSDC (70% of balance)
Realized P&L   : ${ctx.realized_pnl >= 0 ? '+' : ''}${ctx.realized_pnl.toFixed(6)} dUSDC

STRIKE REFERENCE — use one of these exact values, do NOT use round numbers unless they appear here
ATM            : $${atm}    ← preferred strike for directional positions
ATM-1          : $${atm - 1}
ATM+1          : $${atm + 1}
ATM-5          : $${atm - 5}
ATM+5          : $${atm + 5}

RECENT CYCLE HISTORY
${ctx.recent_history || 'No prior cycles this session.'}

Decide the allocation for this cycle. IMPORTANT: use the exact vol/trend numbers above in your reasoning. Skip if < 3 min to expiry or balance < 2 dUSDC. For directional positions use strikes from the STRIKE REFERENCE above.`;
}

// ── Ollama call ───────────────────────────────────────────────────────────────

async function callOllama(userPrompt: string): Promise<string> {
  const body = {
    model:  MODEL,
    stream: false,
    format: 'json',
    options: { temperature: 0.1, num_ctx: 8192 },
    messages: [
      { role: 'system',  content: SYSTEM_PROMPT },
      { role: 'user',    content: userPrompt },
    ],
  };

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json() as { message?: { content?: string } };
  return data.message?.content ?? '';
}

// ── Parse & validate ──────────────────────────────────────────────────────────

function parseDecision(raw: string, ctx: CycleContext): AllocationDecision {
  let parsed: Partial<AllocationDecision>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('[model] Failed to parse JSON:', raw.slice(0, 200));
    return safeSkip('model returned invalid JSON');
  }

  const skip = parsed.skip === true;
  if (skip) {
    return {
      reasoning:   parsed.reasoning   ?? 'model chose to skip',
      supply_usdc: 0,
      positions:   [],
      confidence:  parsed.confidence  ?? 'low',
      skip:        true,
      skip_reason: parsed.skip_reason ?? undefined,
    };
  }

  // Safety rails — never let model exceed deployable budget
  const maxDeploy = ctx.balance_usdc * 0.7;
  const supply    = Math.min(parsed.supply_usdc ?? 0, maxDeploy);
  let   spent     = supply;

  const positions: PositionAllocation[] = [];
  for (const p of (parsed.positions ?? [])) {
    if (spent >= maxDeploy) break;
    const qty = Math.min(p.quantity_usdc ?? 0, maxDeploy - spent);
    if (qty < 1.0) continue;

    // Validate strike fields
    if ((p.type === 'up' || p.type === 'down') && !p.strike) continue;
    if (p.type === 'range' && (!p.lower_strike || !p.higher_strike)) continue;
    if (p.type === 'range' && p.lower_strike! >= p.higher_strike!) continue;

    // Snap wildly OTM strikes back to ATM (>2% from spot is likely a model error)
    const spot = ctx.features.spot_usd;
    const atm  = Math.round(spot);
    const MAX_STRIKE_DRIFT = 0.02;  // 2% of spot
    let   correctedPos = { ...p, quantity_usdc: qty };
    if ((p.type === 'up' || p.type === 'down') && p.strike) {
      const drift = Math.abs(p.strike - spot) / spot;
      if (drift > MAX_STRIKE_DRIFT) {
        console.log(`  [model] strike $${p.strike} is ${(drift * 100).toFixed(1)}% from spot — snapping to ATM $${atm}`);
        correctedPos = { ...correctedPos, strike: atm };
      }
    }

    positions.push(correctedPos);
    spent += qty;
  }

  return {
    reasoning:   parsed.reasoning  ?? '',
    supply_usdc: supply,
    positions,
    confidence:  parsed.confidence ?? 'medium',
    skip:        false,
  };
}

function safeSkip(reason: string): AllocationDecision {
  return { reasoning: reason, supply_usdc: 0, positions: [], confidence: 'low', skip: true, skip_reason: reason };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function decide(ctx: CycleContext): Promise<AllocationDecision> {
  // Hard skip rules before even calling the model
  if (ctx.features.time_to_expiry_min < 3) {
    return safeSkip(`Only ${ctx.features.time_to_expiry_min.toFixed(1)} min to expiry — too late to enter`);
  }
  if (ctx.balance_usdc < 2) {
    return safeSkip(`Balance too low: ${ctx.balance_usdc.toFixed(4)} dUSDC`);
  }

  const prompt = buildUserPrompt(ctx);
  const raw    = await callOllama(prompt);
  return parseDecision(raw, ctx);
}

/** Test that Ollama + hermes3 are reachable. */
export async function ping(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return false;
    const data = await res.json() as { models?: { name: string }[] };
    return (data.models ?? []).some(m => m.name.startsWith('hermes3'));
  } catch {
    return false;
  }
}
