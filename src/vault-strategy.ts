/**
 * Vault ↔ strategy bridge (operator-run).
 *
 *   npm run vault-deploy        # deploy idle vault reserve into PLP (the house)
 *   npm run vault-mark          # mark vault NAV up by PLP appreciation since deploy
 *
 * Deploy records {principal, entryRate} so NAV can be marked to the current PLP
 * redemption rate: value = Σ principal_i · rate_now / entryRate_i. This keeps the
 * vault's share price honest and verifiable from on-chain PLP state.
 */

import 'dotenv/config';
import * as fs from 'fs';
import { buildVaultDeployToPlp, buildVaultMark, getVaultState, getPlpRate } from './vault.js';
import { execute, inspect, getAddress } from './wallet.js';
import { humanToDusdc, DUSDC_SCALE } from './config.js';

const STATE = 'logs/vault-strategy.json';
interface Lot { principal: number; entryRate: number; ts: string }
const load = (): Lot[] => { try { return JSON.parse(fs.readFileSync(STATE, 'utf-8')); } catch { return []; } };
const save = (l: Lot[]) => { fs.mkdirSync('logs', { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(l, null, 2)); };

async function deploy() {
  const addr = getAddress();
  const v = await getVaultState();
  console.log(`Vault reserve: ${v.reserve.toFixed(2)} dUSDC | deployed: ${v.deployed.toFixed(2)} | NAV: ${v.nav.toFixed(2)}`);
  if (v.reserve < 1) { console.log('Nothing to deploy (reserve < 1 dUSDC).'); return; }

  const rate = await getPlpRate();
  const amountRaw = humanToDusdc(v.reserve);
  console.log(`Deploying ${v.reserve.toFixed(2)} dUSDC → PLP at rate ${rate.toFixed(6)}…`);

  const ins: any = await inspect(buildVaultDeployToPlp(amountRaw, addr));
  if (ins?.effects?.status?.status !== 'success') { console.log('devInspect failed:', ins?.effects?.status?.error); process.exit(1); }

  const r = await execute(buildVaultDeployToPlp(amountRaw, addr));
  console.log(`✓ deploy→supply tx: ${r.digest}`);

  const lots = load();
  lots.push({ principal: v.reserve, entryRate: rate, ts: new Date().toISOString() });
  save(lots);
  console.log(`Recorded lot. Total lots: ${lots.length}`);
}

// Skip a mark tx unless the NAV has moved by at least this much (dUSDC) — avoids
// wasting gas re-marking sub-cent changes when run autonomously on a cron.
const MARK_DEADBAND = 0.01;

async function mark() {
  const lots = load();
  if (lots.length === 0) { console.log('No deployed lots to mark.'); return; }
  const [rate, state] = await Promise.all([getPlpRate(), getVaultState()]);
  const value = lots.reduce((s, l) => s + l.principal * rate / l.entryRate, 0);
  const principal = lots.reduce((s, l) => s + l.principal, 0);
  const drift = Math.abs(value - state.deployed);
  console.log(`Principal ${principal.toFixed(2)} → value ${value.toFixed(4)} (rate ${rate.toFixed(6)}) | on-chain deployed ${state.deployed.toFixed(4)} | drift ${drift.toFixed(4)} | gain ${(value - principal).toFixed(4)}`);

  if (drift < MARK_DEADBAND) {
    console.log(`No material change (< ${MARK_DEADBAND} dUSDC) — skipping mark (no tx).`);
    return;
  }

  const r = await execute(buildVaultMark(BigInt(Math.round(value * Number(DUSDC_SCALE)))));
  console.log(`✓ mark tx: ${r.digest}`);
  console.log('New vault state:', JSON.stringify(await getVaultState()));
}

const cmd = process.argv[2];
const fn = cmd === 'mark' ? mark : deploy;
fn().catch(e => { console.error(String(e)); process.exit(1); });
