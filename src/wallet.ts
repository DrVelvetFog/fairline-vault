/**
 * Wallet — sign and execute transactions on Sui testnet.
 */

import { SuiClient, SuiTransactionBlockResponse } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { SUI_RPC_URL, WALLET_PRIVATE_KEY } from './config.js';

const client = new SuiClient({ url: SUI_RPC_URL });

function getKeypair(): Ed25519Keypair {
  if (!WALLET_PRIVATE_KEY) throw new Error('WALLET_PRIVATE_KEY not set in .env');
  return Ed25519Keypair.fromSecretKey(WALLET_PRIVATE_KEY);
}

export function getAddress(): string {
  return getKeypair().toSuiAddress();
}

export { client };

/** Execute a transaction and wait for it to be indexed. */
export async function execute(tx: Transaction): Promise<SuiTransactionBlockResponse> {
  const kp = getKeypair();
  tx.setSender(kp.toSuiAddress());
  tx.setGasBudget(50_000_000);

  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: kp,
    options: { showEffects: true, showEvents: true, showObjectChanges: true },
  });

  await client.waitForTransaction({ digest: result.digest });

  if (result.effects?.status.status !== 'success') {
    throw new Error(`Transaction failed: ${result.effects?.status.error}`);
  }

  return result;
}

/** devInspect a transaction — free, no gas, no state change. */
export async function inspect(tx: Transaction): Promise<unknown> {
  const kp = getKeypair();
  return client.devInspectTransactionBlock({
    transactionBlock: tx,
    sender: kp.toSuiAddress(),
  });
}

/** Extract the ID of the first created object of a given type substring. */
export function extractCreatedId(
  result: SuiTransactionBlockResponse,
  typeMatch: string,
): string | null {
  const created = result.objectChanges?.filter(
    c => c.type === 'created' && c.objectType?.includes(typeMatch),
  );
  return (created?.[0] as { objectId?: string })?.objectId ?? null;
}
