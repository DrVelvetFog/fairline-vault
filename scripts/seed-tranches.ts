/** Seed the tranched vault with an operator senior + junior deposit, to prove
 *  the on-chain deposit path and give the dashboard real tranche data.
 *    npx tsx scripts/seed-tranches.ts [seniorDusdc] [juniorDusdc]
 */
import 'dotenv/config';
import { client, getAddress, execute } from '../src/wallet.js';
import { getDusdcCoins } from '../src/coins.js';
import { buildDepositSenior, buildDepositJunior, getVaultState } from '../src/vault.js';
import { humanToDusdc, FLP_S_TYPE, FLP_J_TYPE } from '../src/config.js';

const SENIOR = Number(process.argv[2] ?? 100);
const JUNIOR = Number(process.argv[3] ?? 50);

async function bal(owner: string, type: string) {
  return Number((await client.getBalance({ owner, coinType: type })).totalBalance) / 1e6;
}

async function main() {
  const op = getAddress();
  console.log(`Seeding tranched vault from ${op}`);

  console.log(`\n[1] Deposit ${SENIOR} dUSDC → SENIOR (FLP-S)…`);
  const r1 = await execute(buildDepositSenior((await getDusdcCoins(op)).coins, humanToDusdc(SENIOR), op));
  console.log(`    ✓ ${r1.digest}`);

  console.log(`[2] Deposit ${JUNIOR} dUSDC → JUNIOR (FLP-J)…`);
  const r2 = await execute(buildDepositJunior((await getDusdcCoins(op)).coins, humanToDusdc(JUNIOR), op));
  console.log(`    ✓ ${r2.digest}`);

  const v = await getVaultState();
  console.log('\n━━━ Vault after seed ━━━');
  console.log(`  NAV ${v.nav.toFixed(2)} | reserve ${v.reserve.toFixed(2)} | deployed ${v.deployed.toFixed(2)}`);
  console.log(`  SENIOR: value ${v.seniorValue.toFixed(2)} | ${v.seniorShares.toFixed(2)} FLP-S @ ${v.seniorPrice.toFixed(6)} | principal ${v.seniorPrincipal.toFixed(2)}`);
  console.log(`  JUNIOR: value ${v.juniorValue.toFixed(2)} | ${v.juniorShares.toFixed(2)} FLP-J @ ${v.juniorPrice.toFixed(6)}`);
  console.log(`  operator holds: ${(await bal(op, FLP_S_TYPE)).toFixed(2)} FLP-S · ${(await bal(op, FLP_J_TYPE)).toFixed(2)} FLP-J`);
}

main().catch(e => { console.error(String(e)); process.exit(1); });
