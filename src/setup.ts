/**
 * One-time setup: create a PredictManager for this wallet on testnet.
 * Run with: npm run setup
 *
 * Prints the manager ID to save in .env as MANAGER_ID.
 */

import 'dotenv/config';
import { buildCreateManager } from './transactions.js';
import { execute, getAddress, extractCreatedId } from './wallet.js';
import { getManagerByOwner } from './indexer.js';

async function main() {
  const address = getAddress();
  console.log('Wallet:', address);

  // Check if manager already exists
  const existing = await getManagerByOwner(address);
  if (existing) {
    console.log('\nManager already exists:');
    console.log('  Manager ID:', existing.manager_id);
    console.log('\nAdd to .env:');
    console.log(`  MANAGER_ID=${existing.manager_id}`);
    return;
  }

  console.log('Creating PredictManager on testnet...');
  const tx = buildCreateManager();
  const result = await execute(tx);

  console.log('Transaction:', result.digest);

  const managerId = extractCreatedId(result, 'PredictManager');
  if (!managerId) {
    // Fall back to indexer — shared objects may not appear in objectChanges
    await new Promise(r => setTimeout(r, 3000));
    const found = await getManagerByOwner(address);
    if (found) {
      console.log('\nManager created:');
      console.log('  Manager ID:', found.manager_id);
      console.log('\nAdd to .env:');
      console.log(`  MANAGER_ID=${found.manager_id}`);
    } else {
      console.log('Manager ID not found in result — check explorer for tx:', result.digest);
    }
    return;
  }

  console.log('\nManager created:');
  console.log('  Manager ID:', managerId);
  console.log('\nAdd to .env:');
  console.log(`  MANAGER_ID=${managerId}`);
}

main().catch(console.error);
