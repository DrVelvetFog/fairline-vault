#!/usr/bin/env bash
# Rebuild the self-hosted dApp SDK bundle (web/app/vendor/sui-sdk.js).
#
# The dApp imports @mysten/sui + @mysten/wallet-standard from a same-origin
# bundle instead of a third-party CDN, so a poisoned CDN can't inject a
# wallet-drainer into the signing path (audit finding M1). We build in an
# ISOLATED temp dir so we never change the backend's pinned @mysten/sui version.
#
#   bash scripts/build-dapp-sdk.sh
set -euo pipefail

SUI_VER="1.18.0"          # keep in sync with the version the dApp was tested against
WS_VER="0.13.0"
OUT="$(cd "$(dirname "$0")/.." && pwd)/web/app/vendor/sui-sdk.js"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
cat > entry.js <<EOF
export { SuiClient } from '@mysten/sui/client';
export { Transaction } from '@mysten/sui/transactions';
export { getWallets } from '@mysten/wallet-standard';
EOF
echo "{}" > package.json
npm install --silent --no-audit --no-fund "@mysten/sui@${SUI_VER}" "@mysten/wallet-standard@${WS_VER}"
npx esbuild entry.js --bundle --format=esm --minify --outfile=sui-sdk.js
mkdir -p "$(dirname "$OUT")"
cp sui-sdk.js "$OUT"
echo "✓ wrote $OUT ($(wc -c < "$OUT") bytes)"
