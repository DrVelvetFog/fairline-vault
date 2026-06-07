import 'dotenv/config';
import * as fs from 'fs';
import { getVaultState, getPlpRate } from '../src/vault.js';

(async () => {
  const v = await getVaultState();
  const rate = await getPlpRate();
  let lots: any[] = [];
  try { lots = JSON.parse(fs.readFileSync('logs/vault-strategy.json', 'utf-8')); } catch {}
  const liveDeployed = lots.reduce((s: number, l: any) => s + l.principal * rate / l.entryRate, 0);
  const liveNav = v.reserve + liveDeployed;
  const recSP = v.nav / v.totalShares;
  const fairSP = liveNav / v.totalShares;
  console.log('reserve        ', v.reserve.toFixed(4));
  console.log('deployed rec   ', v.deployed.toFixed(4), '| live', liveDeployed.toFixed(4));
  console.log('NAV      rec   ', v.nav.toFixed(4), '| live', liveNav.toFixed(4));
  console.log('sharePrice rec ', recSP.toFixed(6), '| fair', fairSP.toFixed(6));
  console.log('drift          ', (liveNav - v.nav).toFixed(6), 'dUSDC |', (((fairSP - recSP) / recSP) * 100).toFixed(4), '%');
  console.log('rate', rate.toFixed(6), '| lots', lots.length);
})();
