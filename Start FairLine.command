#!/bin/bash
# FairLine launcher — double-click from Finder/Desktop to start the vault.
# Starts the watcher, dashboard, and hourly summary via pm2, then opens the dashboard.

cd "$(dirname "$0")" || exit 1

echo "━━━ Starting FairLine ━━━"
echo "Project: $(pwd)"
echo ""

# Ensure pm2 is on PATH (Homebrew node location)
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"

# Start (or restart) all FairLine processes from the ecosystem config
pm2 start ecosystem.config.cjs 2>/dev/null
pm2 restart fairline-watcher fairline-dashboard 2>/dev/null
pm2 save 2>/dev/null

echo ""
echo "✅ FairLine is running:"
pm2 list | grep -E "fairline|name"

echo ""
echo "Opening dashboard at http://localhost:3002 …"
sleep 2
open "http://localhost:3002"

echo ""
echo "━━━ Done. You can close this window. ━━━"
echo "To stop: run 'pm2 stop fairline-watcher fairline-dashboard' in Terminal."
echo ""
read -n 1 -s -r -p "Press any key to close…"
