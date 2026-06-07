/** Capstone: verify junior withdraw + clock-arg mark against the live contract. */
import 'dotenv/config';
import { client, getAddress, execute } from '../src/wallet.js';
import { buildWithdrawJunior, buildVaultMark, getVaultState } from '../src/vault.js';
import { humanToDusdc, FLP_J_TYPE } from '../src/config.js';

async function main() {
  const op = getAddress();
  console.log('Before:', JSON.stringify(await getVaultState(), null, 0).slice(0, 200));

  // 1. Junior withdraw 10 FLP-J → ~10 dUSDC (verifies buildWithdrawJunior live).
  const jCoins = (await client.getCoins({ owner: op, coinType: FLP_J_TYPE })).data;
  console.log('\n[1] Operator withdraws 10 FLP-J…');
  const r1 = await execute(buildWithdrawJunior(jCoins, humanToDusdc(10), op));
  console.log(`    ✓ ${r1.digest}`);

  // 2. Mark to current deployed (honest no-op profit) — verifies clock-arg mark
  //    integration and that marked_at refreshes.
  const v1 = await getVaultState();
  console.log(`\n[2] Mark to live deployed (${v1.deployed.toFixed(2)})…`);
  const r2 = await execute(buildVaultMark(humanToDusdc(v1.deployed)));
  console.log(`    ✓ ${r2.digest}`);

  const v = await getVaultState();
  console.log('\n━━━ After ━━━');
  console.log(`NAV ${v.nav.toFixed(2)} | senior ${v.seniorValue.toFixed(2)} (${v.seniorShares.toFixed(2)} S) | junior ${v.juniorValue.toFixed(2)} (${v.juniorShares.toFixed(2)} J)`);
  console.log(`markAge ${v.markAgeSec.toFixed(0)}s (should be ~0 after fresh mark)`);
}

main().catch(e => { console.error(String(e)); process.exit(1); });
