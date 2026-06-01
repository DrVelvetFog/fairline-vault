import { PREDICT_SERVER, PREDICT_OBJECT } from './config.js';

// ── Response types ────────────────────────────────────────────────────────────

export interface OracleRecord {
  predict_id:          string;
  oracle_id:           string;
  oracle_cap_id:       string;
  underlying_asset:    string;
  expiry:              number;   // ms timestamp
  min_strike:          number;   // 1e9-scaled
  tick_size:           number;   // 1e9-scaled
  status:              'created' | 'active' | 'settled';
  activated_at:        number | null;
  settlement_price:    number | null;
  settled_at:          number | null;
  created_checkpoint:  number;
}

export interface PriceEvent {
  event_digest:           string;
  oracle_id:              string;
  spot:                   number;  // 1e9-scaled
  forward:                number;  // 1e9-scaled
  onchain_timestamp:      number;
  checkpoint_timestamp_ms: number;
  checkpoint:             number;
}

export interface PredictState {
  predict_id:    string;
  pricing:       unknown | null;
  risk:          unknown | null;
  trading_paused: boolean | null;
  quote_assets:  string[];
}

export interface ManagerSummary {
  manager_id:                     string;
  owner:                          string;
  balances: {
    quote_asset: string;
    balance:     number;          // raw dUSDC units (1e6)
  }[];
  trading_balance:                number;
  open_exposure:                  number;
  redeemable_value:               number;
  realized_pnl:                   number;
  unrealized_pnl:                 number;
  account_value:                  number;
  open_positions:                 number;
  awaiting_settlement_positions:  number;
}

export interface ManagerPosition {
  manager_id:  string;
  oracle_id:   string;
  expiry:      number;
  strike:      number;   // 1e9-scaled
  is_up:       boolean;
  quantity:    number;   // raw dUSDC units
  [key: string]: unknown;
}

export interface ManagerPositions {
  minted:   ManagerPosition[];
  redeemed: ManagerPosition[];
}

export interface ManagerRecord {
  manager_id: string;
  owner:      string;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${PREDICT_SERVER}${path}`);
  if (!res.ok) throw new Error(`Indexer ${path}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// ── Oracle endpoints ──────────────────────────────────────────────────────────

export const getOracles = (status?: 'active' | 'settled' | 'created'): Promise<OracleRecord[]> =>
  get<OracleRecord[]>(status ? `/oracles?status=${status}` : '/oracles');

export const getActiveOracles  = (): Promise<OracleRecord[]> => getOracles('active');
export const getSettledOracles = (): Promise<OracleRecord[]> => getOracles('settled');

export const getLatestPrice = (oracleId: string): Promise<PriceEvent> =>
  get<PriceEvent>(`/oracles/${oracleId}/prices/latest`);

export const getPriceHistory = (oracleId: string): Promise<PriceEvent[]> =>
  get<PriceEvent[]>(`/oracles/${oracleId}/prices`);

// ── Vault / Predict endpoints ─────────────────────────────────────────────────

export const getPredictState = (predictId = PREDICT_OBJECT): Promise<PredictState> =>
  get<PredictState>(`/predicts/${predictId}/state`);

// ── Manager endpoints ─────────────────────────────────────────────────────────

export const getManagers = (): Promise<ManagerRecord[]> =>
  get<ManagerRecord[]>('/managers');

export const getManagerSummary = (managerId: string): Promise<ManagerSummary> =>
  get<ManagerSummary>(`/managers/${managerId}/summary`);

export const getManagerPositions = (managerId: string): Promise<ManagerPositions> =>
  get<ManagerPositions>(`/managers/${managerId}/positions`);

/** Find a manager by owner address (returns null if none created yet). */
export const getManagerByOwner = async (ownerAddress: string): Promise<ManagerRecord | null> => {
  const all = await getManagers();
  return all.find(m => m.owner === ownerAddress) ?? null;
};

// ── Convenience helpers ───────────────────────────────────────────────────────

/** Active oracles with future expiry, sorted nearest-first. */
export async function getFutureOracles(): Promise<OracleRecord[]> {
  const all = await getActiveOracles();
  const now = Date.now();
  return all.filter(o => o.expiry > now).sort((a, b) => a.expiry - b.expiry);
}

/** The single nearest active BTC oracle. */
export async function getNearestActiveOracle(): Promise<OracleRecord | null> {
  const future = await getFutureOracles();
  return future[0] ?? null;
}
