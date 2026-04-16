# Pelican AI — Deployment Management

You are managing AI agent deployments for Pelican AI's small business clients.
Each client runs OpenClaw on Fly.io in a Docker container. This file tells you
how to deploy, configure, troubleshoot, and manage client agents.

## Architecture

- **Platform**: Fly.io (one app per client, named `agent-<client-name>`)
- **Runtime**: OpenClaw (installed from npm in Docker)
- **AI Models**: Default Preset A (Qwen 3.6 Plus main, Claude Sonnet for email, Claude Haiku fallback)
- **Channels**: Website chat widget + WhatsApp Business API (customer-facing), Telegram (internal/staff)
- **Memory**: Always enabled (OpenClaw built-in + optional Supabase)
- **Repo**: This repo contains all client configs, prompts, skills, and deployment scripts

## Client Folder Structure

Each client lives in `clients/<client-name>/`:

```
clients/<client-name>/
    config.json       — client metadata, tier, model preset, channel info
    system-prompt.md  — the main agent's system prompt
    agents/           — additional agent prompts (email, admin, etc.)
    skills/           — client-specific skills
    notes.md          — discovery call notes, preferences, changelog
```

## Deploying a New Client

### Step 1: Create client folder

Create `clients/<client-name>/` with config.json, system-prompt.md, and notes.md.
Use `clients/.template/` as the starting point.

### Step 2: Create Fly.io app

```bash
fly apps create agent-<client-name>
fly volumes create agent_data --size 1 --region <region> --app agent-<client-name>
```

Common regions: `syd` (Sydney), `mel` (Melbourne), `sin` (Singapore), `lhr` (London), `iad` (US East).

### Step 3: Set secrets

```bash
# Gateway security token (always required)
fly secrets set OPENCLAW_GATEWAY_TOKEN=$(openssl rand -hex 32) --app agent-<client-name>

# AI provider key (at least one required)
fly secrets set ANTHROPIC_API_KEY=<key> --app agent-<client-name>
# Or for Qwen:
fly secrets set QWEN_API_KEY=<key> --app agent-<client-name>

# Channel tokens (set whichever channels the client uses)
fly secrets set TELEGRAM_BOT_TOKEN=<token> --app agent-<client-name>
```

Record the gateway token in the client's config.json (the token value, not the key itself).

### Step 4: Deploy

```bash
fly deploy --app agent-<client-name> --region <region>
```

Wait for the build to complete (2-3 minutes).

### Step 5: Configure the agent

```bash
fly ssh console --app agent-<client-name>
```

Inside the container:

```bash
# Set the model (use config.json to determine which preset)
openclaw config set agent.model <model-from-config>

# Set the system prompt (paste from system-prompt.md)
openclaw config set agent.systemPrompt "$(cat)"
# Then paste the prompt and press Ctrl+D

# Enable memory
openclaw config set agents.defaults.memorySearch.enabled true
openclaw config set agents.defaults.memorySearch.query.maxResults 10
openclaw config set agents.defaults.memorySearch.cache.enabled true

# Session management
openclaw config set session.reset.mode daily
openclaw config set session.maintenance.pruneAfter "30d"
openclaw config set session.maintenance.maxEntries 500

# Debouncing
openclaw config set messages.inbound.debounceMs 2000

# Execution approvals (if client needs outbound email/comms)
openclaw config set approvals.exec.mode "on-miss"

# Exit container
exit
```

### Step 6: Restart and verify

```bash
fly apps restart agent-<client-name>
sleep 10
fly logs --app agent-<client-name>
```

Look for `[gateway] ready` and the channel listening message.

### Step 7: Update notes.md and commit

Record what was deployed, when, and any decisions made. Commit to git.

## Modifying a Client

### Update system prompt

1. Edit `clients/<client-name>/system-prompt.md`
2. SSH in and apply:
   ```bash
   fly ssh console --app agent-<client-name>
   openclaw config set agent.systemPrompt "new prompt here"
   exit
   ```
3. Restart: `fly apps restart agent-<client-name>`
4. Commit the change to git

### Add a skill

1. Write the skill markdown in `clients/<client-name>/skills/<skill-name>/SKILL.md`
   or use a shared skill from `skills-shared/`
2. SSH in and place the skill file in the agent's workspace
3. Restart and verify
4. Commit to git

### Change model

1. Update `clients/<client-name>/config.json` with the new model
2. SSH in: `openclaw config set agent.model <new-model>`
3. Restart
4. Commit

### Add a cron job

```bash
fly ssh console --app agent-<client-name>
openclaw cron add \
  --name "Morning Briefing" \
  --cron "30 7 * * 1-5" \
  --tz "Australia/Melbourne" \
  --agent main \
  --session isolated \
  --message "Generate the morning briefing."
exit
```

### Add an additional agent

```bash
fly ssh console --app agent-<client-name>
openclaw agents add email-assistant \
  --workspace ~/.openclaw/workspace-email \
  --model anthropic/claude-sonnet-4-6
openclaw agents set-identity --agent email-assistant --name "Email Manager"
openclaw agents bind --agent email-assistant --bind telegram
exit
```

## Troubleshooting

### Check logs
```bash
fly logs --app agent-<client-name>
fly logs --app agent-<client-name> | grep -i "error\|exit\|restart\|timeout"
```

### Check channel status
```bash
fly ssh console --app agent-<client-name>
openclaw channels status --probe
exit
```

### Gateway not responding
```bash
fly apps restart agent-<client-name>
sleep 15
fly logs --app agent-<client-name>
```

### WhatsApp disconnected
```bash
fly ssh console --app agent-<client-name>
openclaw channels status --probe
# If disconnected, may need to re-pair
openclaw gateway stop
openclaw gateway run --bind lan --port 3000
# Watch for reconnection
exit
```

### Orphaned subagent recovery loop (gateway keeps crashing)
```bash
fly ssh console --app agent-<client-name>
rm -rf ~/.openclaw/sessions/agent:main:subagent:*
openclaw gateway stop
openclaw gateway run --bind lan --port 3000 --force
exit
fly apps restart agent-<client-name>
```

### Check memory usage
```bash
fly ssh console --app agent-<client-name>
cat /proc/meminfo | head -5
exit
```

## Updating OpenClaw

To update all clients to a new OpenClaw version:

1. Update the version in `Dockerfile` (e.g., `openclaw@2026.5.1`)
2. Deploy to YOUR test instance first: `fly deploy --app agent-test`
3. Test thoroughly for 2-3 days
4. If stable, update all clients: `./scripts/update-all-clients.sh`
5. Commit the Dockerfile change to git

NEVER update client instances without testing on your own instance first.

## Model Presets

### Preset A — Best Agent Quality (default)
- Main: `qwen/qwen-3.6-plus`
- Email: `anthropic/claude-sonnet-4-6`
- Workers: `anthropic/claude-haiku-4-5`
- Fallback: `anthropic/claude-haiku-4-5`

### Preset B — Anthropic Only
- Main: `anthropic/claude-haiku-4-5`
- Email: `anthropic/claude-sonnet-4-6`
- Fallback: `mistral/mistral-small-latest`

### Preset C — Minimum Cost
- Main: `qwen/qwen-3.6-plus`
- Email: `z-ai/glm-5.1`
- Workers: `deepseek/deepseek-v3.2`
- Fallback: `google/gemini-3.1-flash`

### Preset D — Privacy First
- Main: `mistral/mistral-small-latest`
- Email: `mistral/mistral-large-latest`
- Fallback: `ollama/mistral-nemo`

## Tier Constraints

All tiers get: memory, agents, subagents, cron, approvals, conversation logging.

| | Starter ($500/mo) | Growth ($900/mo) | Scale ($1,500/mo) |
|---|---|---|---|
| Channels | 1 | Up to 3 | Unlimited |
| Sonnet access | No | Email agent only | Any agent |
| Custom skills | Built-in only | 1 custom | Multiple |
| Session cap/sender/day | 150 | 300 | 500 |
| Support | Email 48hr | Email 24hr + weekly | Priority same-day + monthly |

## Security Checklist (Every Client)

- [ ] `OPENCLAW_GATEWAY_TOKEN` set (32+ chars)
- [ ] API keys set as secrets (never in config files)
- [ ] `gateway.bind` set to `lan` (Fly.io handles external access)
- [ ] Dangerous tools denied (`exec`, `browser_navigate`) unless needed
- [ ] Session pruning configured (30 days)
- [ ] `openclaw security audit` passes clean

## Compliance (Regulated Clients Only)

For financial services, healthcare, legal clients:

- System prompt must include explicit "never give [financial/medical/legal] advice" guardrails
- Execution approvals set to "always" (`openclaw config set approvals.exec.mode always`)
- Complaint detection keywords configured in hooks
- Conversation logging retained for 7 years
- Test with 50 adversarial prompts before going live
- Monthly compliance spot-checks (review 10 random conversations)
