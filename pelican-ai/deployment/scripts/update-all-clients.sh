#!/bin/bash
# update-all-clients.sh — Redeploy all client apps to latest Docker image
#
# IMPORTANT: Update the Dockerfile version first, test on agent-test,
# then run this script.

set -euo pipefail

echo "=== Updating all client apps ==="
echo ""

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
read -p "Deploy to all? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

for APP in $APPS; do
    echo "--- Deploying ${APP} ---"
    fly deploy --app "${APP}" || echo "FAILED: ${APP}"
    echo ""
done

echo "=== All updates complete ==="
