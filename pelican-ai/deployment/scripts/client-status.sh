#!/bin/bash
# client-status.sh — Check status of all client apps

set -euo pipefail

echo "=== Client Status ==="
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
    echo "No client apps found."
    exit 0
fi

printf "%-30s %-12s %-10s\n" "CLIENT" "STATUS" "REGION"
printf "%-30s %-12s %-10s\n" "------" "------" "------"

for APP in $APPS; do
    STATUS=$(fly status --app "${APP}" --json 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
machines = data.get('Machines', [])
if machines:
    print(machines[0].get('state', 'unknown'))
else:
    print('no-machines')
" 2>/dev/null || echo "error")

    REGION=$(fly status --app "${APP}" --json 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
machines = data.get('Machines', [])
if machines:
    print(machines[0].get('region', '?'))
else:
    print('?')
" 2>/dev/null || echo "?")

    printf "%-30s %-12s %-10s\n" "${APP}" "${STATUS}" "${REGION}"
done
