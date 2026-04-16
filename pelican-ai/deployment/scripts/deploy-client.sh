#!/bin/bash
# deploy-client.sh — Deploy a new client agent to Fly.io
#
# Usage:
#   ./scripts/deploy-client.sh <client-name> <region>
#
# Example:
#   ./scripts/deploy-client.sh rural-skin syd
#   ./scripts/deploy-client.sh talbot-advisory syd

set -euo pipefail

CLIENT_NAME="${1:?Usage: deploy-client.sh <client-name> <region>}"
REGION="${2:-syd}"
APP_NAME="agent-${CLIENT_NAME}"

echo "=== Deploying client: ${CLIENT_NAME} ==="
echo "App: ${APP_NAME}"
echo "Region: ${REGION}"
echo ""

# Create the app
echo "Creating Fly.io app..."
fly apps create "${APP_NAME}" || echo "App may already exist, continuing..."

# Create persistent volume
echo "Creating persistent storage..."
fly volumes create agent_data --size 1 --region "${REGION}" --app "${APP_NAME}" || echo "Volume may already exist, continuing..."

# Generate a secure gateway token
GATEWAY_TOKEN=$(openssl rand -hex 32)

# Set the gateway token
echo "Setting gateway token..."
fly secrets set OPENCLAW_GATEWAY_TOKEN="${GATEWAY_TOKEN}" --app "${APP_NAME}"

# Deploy
echo "Deploying..."
fly deploy --app "${APP_NAME}" --region "${REGION}"

echo ""
echo "=== Deployment complete ==="
echo ""
echo "Next steps:"
echo ""
echo "1. Set AI provider key:"
echo "   fly secrets set ANTHROPIC_API_KEY=<key> --app ${APP_NAME}"
echo ""
echo "2. Set channel token:"
echo "   fly secrets set TELEGRAM_BOT_TOKEN=<token> --app ${APP_NAME}"
echo ""
echo "3. SSH in and configure:"
echo "   fly ssh console --app ${APP_NAME}"
echo ""
echo "4. Verify:"
echo "   fly logs --app ${APP_NAME}"
echo ""
echo "Gateway token (save this): ${GATEWAY_TOKEN}"
