/**
 * Judge faucet — one click of testnet funds so anyone can try the vault dApp
 * without filling the Mysten dUSDC request form.
 *
 *   POST /.netlify/functions/faucet   { "address": "0x…" }
 *   → sends 10 dUSDC + 0.05 SUI (gas) from a SEPARATE, limited faucet wallet
 *
 * Guards: refuses if the requester already holds ≥ 5 dUSDC (already funded),
 * or if the faucet is dry. Testnet-only tokens; blast radius = faucet balance.
 * FAUCET_PRIVATE_KEY is set in the Netlify environment (never in the repo).
 */
import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';

const RPC = 'https://fullnode.testnet.sui.io:443';
const DUSDC = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
const DRIP_DUSDC = 10_000_000n;   // 10 dUSDC (1e6 scale)
const DRIP_SUI = 50_000_000n;     // 0.05 SUI (1e9 scale) — enough gas to deposit & withdraw
const ALREADY_FUNDED_DUSDC = 5_000_000n;
// Global daily cap: the per-address check is bypassable with fresh addresses, so
// also bound total drips/24h from the faucet's own on-chain send history. Caps
// the worst-case daily drain (e.g. a Sybil drain right before judging).
const MAX_DRIPS_PER_DAY = 25;     // ≤ 250 dUSDC + 1.25 SUI / day
const DAY_MS = 24 * 60 * 60 * 1000;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export default async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const key = process.env.FAUCET_PRIVATE_KEY;
  if (!key) return json(500, { error: 'faucet not configured' });

  let address: string;
  try { ({ address } = await req.json()); } catch { return json(400, { error: 'bad JSON' }); }
  if (!/^0x[0-9a-fA-F]{64}$/.test(address ?? '')) return json(400, { error: 'invalid Sui address' });

  const client = new SuiClient({ url: RPC });
  const kp = Ed25519Keypair.fromSecretKey(key);
  const faucet = kp.toSuiAddress();

  const [theirs, mine] = await Promise.all([
    client.getBalance({ owner: address, coinType: DUSDC }),
    client.getBalance({ owner: faucet, coinType: DUSDC }),
  ]);
  if (BigInt(theirs.totalBalance) >= ALREADY_FUNDED_DUSDC)
    return json(409, { error: 'address already has test dUSDC — go deposit it!' });
  if (BigInt(mine.totalBalance) < DRIP_DUSDC)
    return json(503, { error: 'faucet is dry — ping the team' });

  // Global daily-cap check: count the faucet's own sends in the last 24h.
  const recent = await client.queryTransactionBlocks({
    filter: { FromAddress: faucet },
    options: { showEffects: true },
    limit: 50, order: 'descending',
  });
  const dayAgo = Date.now() - DAY_MS;
  const dripsToday = recent.data.filter(t => Number(t.timestampMs ?? 0) >= dayAgo).length;
  if (dripsToday >= MAX_DRIPS_PER_DAY)
    return json(429, { error: 'faucet daily limit reached — try again tomorrow' });

  const coins = (await client.getCoins({ owner: faucet, coinType: DUSDC })).data;
  const tx = new Transaction();
  const primary = tx.object(coins[0].coinObjectId);
  if (coins.length > 1) tx.mergeCoins(primary, coins.slice(1).map(c => tx.object(c.coinObjectId)));
  const [dusdc] = tx.splitCoins(primary, [tx.pure.u64(DRIP_DUSDC)]);
  const [sui] = tx.splitCoins(tx.gas, [tx.pure.u64(DRIP_SUI)]);
  tx.transferObjects([dusdc, sui], address);
  tx.setSender(faucet);
  tx.setGasBudget(20_000_000);

  const r = await client.signAndExecuteTransaction({ transaction: tx, signer: kp, options: { showEffects: true } });
  await client.waitForTransaction({ digest: r.digest });
  if (r.effects?.status.status !== 'success') return json(500, { error: `tx failed: ${r.effects?.status.error}` });

  return json(200, { digest: r.digest, dusdc: 10, sui: 0.05 });
};
