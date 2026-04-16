# Pelican AI — Agent Deployment Repo

This repo manages all Pelican AI client deployments on Fly.io using OpenClaw.

## How It Works

One repo, many clients. Each client gets their own Fly.io app running OpenClaw in a Docker container. Client configs, system prompts, and skills live in this repo. Claude Code handles deployments, configuration, and troubleshooting via the Fly.io CLI.

## Repo Structure

```
clients/           — one folder per client (config, prompts, skills, notes)
skills-shared/     — reusable skills across clients (Cliniko, Xero, etc.)
scripts/           — deploy, update, and status scripts
Dockerfile         — builds the OpenClaw container
fly.toml           — Fly.io base config
CLAUDE.md          — instructions for Claude Code
```

## Quick Reference

```bash
# Deploy a new client
./scripts/deploy-client.sh <client-name> <region>

# Update all clients to latest OpenClaw
./scripts/update-all-clients.sh

# Check status of all clients
./scripts/client-status.sh

# View a client's logs
fly logs --app agent-<client-name>

# SSH into a client
fly ssh console --app agent-<client-name>

# Restart a client
fly apps restart agent-<client-name>
```

## Managing Clients with Claude Code

Open Claude Code in this repo and describe what you want:

- "Set up a new client called Peak Physio — physiotherapy clinic in Brunswick"
- "Update Rural Skin's system prompt — add a new location in Clare"
- "Check why Talbot Advisory's agent isn't responding"
- "Write a Cliniko booking skill"

Claude Code reads the CLAUDE.md, understands the process, and executes.
