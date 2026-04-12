#!/bin/bash
# update-all-clients.sh — Redeploy all client apps to latest OpenClaw
#
# Usage:
#   ./scripts/update-all-clients.sh

set -euo pipefail

echo "=== Updating all client apps ==="
echo ""

# List all apps with the agent- prefix
APPS=$(fly apps list --json 2>/dev/null | python3 -c "
import json, sys
apps = json.load(sys.stdin)
for app in apps:
    name = app.get('Name', app.get('name', ''))
    if name.startswith('agent-'):
        print(name)
" 2>/dev/null || echo "")

if [ -z "$APPS" ]; then
    echo "No client apps found (looking for apps starting with 'agent-')"
    exit 0
fi

echo "Found apps:"
echo "$APPS"
echo ""

for APP in $APPS; do
    echo "--- Deploying ${APP} ---"
    fly deploy --app "${APP}" || echo "FAILED: ${APP}"
    echo ""
done

echo "=== All updates complete ==="
