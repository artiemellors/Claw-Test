# Agent Deployment Repo

Deploy and manage AI agents for clients using OpenClaw on Fly.io.

## Prerequisites

- [Fly.io CLI](https://fly.io/docs/hands-on/install-flyctl/) installed
- Fly.io account with billing set up
- AI provider API key (Anthropic, OpenAI, etc.)

## Quick Start — Deploy a New Client

### 1. Create a Telegram bot

1. Open Telegram, message @BotFather
2. Send `/newbot`
3. Give it a name (e.g. "Dr Chen's Dental")
4. Give it a username (e.g. `DrChenDentalBot`)
5. Save the token BotFather gives you

### 2. Run the deploy script

```bash
chmod +x scripts/deploy-client.sh
./scripts/deploy-client.sh drchen syd
```

### 3. Set secrets

```bash
fly secrets set ANTHROPIC_API_KEY=sk-ant-xxx --app agent-drchen
fly secrets set TELEGRAM_BOT_TOKEN=71234567:AAHxxx --app agent-drchen
```

### 4. Configure the agent

```bash
fly ssh console --app agent-drchen

# Inside the container:
openclaw config set agent.model anthropic/claude-haiku-4-5
openclaw config set agent.systemPrompt "Your prompt here"
exit
```

### 5. Restart to apply config

```bash
fly apps restart agent-drchen
```

### 6. Verify

```bash
fly logs --app agent-drchen
# Look for: [telegram] Listening...
```

## Managing Clients

```bash
# Check all clients
./scripts/client-status.sh

# View a client's logs
fly logs --app agent-drchen

# SSH into a client's container
fly ssh console --app agent-drchen

# Restart a client
fly apps restart agent-drchen

# Update all clients to latest OpenClaw
./scripts/update-all-clients.sh
```

## Client Configs

Store client configurations in `client-configs/`. These are reference files
for your records — they don't get deployed automatically.

- `template.json` — blank template
- `example-dental.json` — single agent, dental practice
- `example-realestate.json` — multi-agent, real estate

## Multi-Agent Setup

For clients who need multiple agents, SSH in and configure:

```bash
fly ssh console --app agent-clientname

# Add agents
openclaw agents add lead-manager --workspace ~/.openclaw/workspace-leads --model anthropic/claude-haiku-4-5
openclaw agents add email-assistant --workspace ~/.openclaw/workspace-email --model anthropic/claude-sonnet-4-6

# Bind channels to agents
openclaw agents bind --agent lead-manager --bind telegram

# Add scheduled tasks
openclaw cron add --name "Morning Briefing" --cron "30 7 * * 1-5" --tz "Australia/Melbourne" --agent admin --session isolated --message "Generate morning briefing"

# Verify
openclaw agents list
openclaw agents bindings
openclaw cron list
```

## Cost Structure

| Component | Cost |
|-----------|------|
| Fly.io per client | ~$5-10/mo |
| AI API (Haiku, light use) | ~$5-10/mo |
| AI API (Sonnet, heavy use) | ~$15-30/mo |
| Your time | Setup: 30 min, Ongoing: 1-2 hrs/mo |

## Regions

Common Fly.io regions:
- `syd` — Sydney
- `mel` — Melbourne
- `sin` — Singapore
- `nrt` — Tokyo
- `lax` — Los Angeles
- `iad` — Washington DC
- `lhr` — London

Pick the closest region to your client for lowest latency.
