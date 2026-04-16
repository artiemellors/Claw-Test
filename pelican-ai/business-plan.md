# Pelican AI — Business Plan & Technical Notes

**Date**: 2026-04-12
**Concept**: AI agent setup and management service for small to medium businesses and working professionals.

---

## The Idea

Build a business around setting up, configuring, and managing AI agents for small businesses and working professionals. Clients get an AI assistant accessible through Telegram or WhatsApp that handles their specific workflows — reception, email, lead management, scheduling, admin.

The underlying technology is OpenClaw (open source, MIT licensed), deployed via Docker on Fly.io. Pelican AI is a service business, not a software product — the value is in the setup, prompt design, agent configuration, and ongoing support.

---

## Why This Works

1. **OpenClaw is free and fully featured** — 82 extensions, 51 skills, multi-agent, memory, scheduling, browser automation, all built and maintained by someone else
2. **Updates come for free** — `npm install -g openclaw@latest` gives you every new feature, fix, and provider
3. **90% of customization is configuration, not code** — system prompts, agent setup, cron jobs, channel config
4. **Clients can't do this themselves** — the setup process (SSH, Docker, API keys, prompt engineering) is too technical for most SMBs
5. **Recurring revenue** — infrastructure + support = monthly retainer
6. **Low marginal cost** — each client costs ~$15-35/mo to run, you charge $150-500/mo

---

## Technical Architecture

### Infrastructure

```
Fly.io (your account)
    |
    |-- agent-drchen          (client 1)
    |-- agent-smithlegal      (client 2)
    |-- agent-sarahtaylor     (client 3)
    |-- agent-peakfitness     (client 4)
    |
    Each app:
    - Docker container running OpenClaw
    - 2GB RAM, shared CPU
    - Persistent storage for config/sessions/memory
    - Auto-restart on crash
    - Health checks
    - HTTPS
```

### Per-Client Setup

Each client gets:
- Their own Fly.io app (isolated data, secrets, config)
- A Telegram bot (or WhatsApp Business API connection)
- Custom system prompt tailored to their business
- Optional: multiple agents, cron jobs, memory, email integration

### Deployment Repo

One GitHub repo, many client deployments:

```
agent-deployments/
    |-- Dockerfile              # Installs OpenClaw from npm
    |-- fly.toml                # Fly.io config template
    |-- README.md               # Full setup guide
    |-- scripts/
    |   |-- deploy-client.sh    # Deploy a new client (one command)
    |   |-- update-all-clients.sh # Update all clients at once
    |   |-- client-status.sh    # Check status of all clients
    |-- client-configs/
        |-- template.json       # Blank template
        |-- example-dental.json
        |-- example-realestate.json
```

### Dockerfile

```dockerfile
FROM node:22-slim
RUN npm install -g openclaw
RUN useradd -m -s /bin/bash openclaw
USER openclaw
RUN mkdir -p /home/openclaw/.openclaw
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=5 --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["openclaw", "gateway", "run", "--bind", "lan", "--port", "3000"]
```

### Deploy a New Client

```bash
./scripts/deploy-client.sh drchen syd
fly secrets set ANTHROPIC_API_KEY=sk-ant-xxx --app agent-drchen
fly secrets set TELEGRAM_BOT_TOKEN=71234567:AAHxxx --app agent-drchen
fly ssh console --app agent-drchen
# Set system prompt, configure agents, exit
fly apps restart agent-drchen
```

### Manage All Clients

```bash
# Check status of all clients
./scripts/client-status.sh

# View a client's logs
fly logs --app agent-drchen

# Update all clients to latest OpenClaw
./scripts/update-all-clients.sh

# SSH into a client for troubleshooting
fly ssh console --app agent-drchen
```

---

## Multi-Agent Setup

OpenClaw supports multiple agents per gateway. Each agent has a specific role:

### Example: Real Estate Agent (Sarah Taylor)

```
Fly.io App: agent-sarahtaylor
    |
    |-- Agent: lead-manager (Haiku — cheap, fast)
    |   Bound to: Telegram bot
    |   Handles: buyer inquiries, property questions, inspection bookings
    |
    |-- Agent: email-assistant (Sonnet — smarter)
    |   Triggered by: delegation from lead-manager
    |   Handles: inbox triage, draft replies, follow-ups
    |
    |-- Agent: admin (Haiku)
    |   Triggered by: cron jobs
    |   Handles: morning briefing, weekly summary, reminders
```

### Setup Commands

```bash
# Create agents
openclaw agents add lead-manager --workspace ~/.openclaw/workspace-leads --model anthropic/claude-haiku-4-5
openclaw agents add email-assistant --workspace ~/.openclaw/workspace-email --model anthropic/claude-sonnet-4-6
openclaw agents add admin --workspace ~/.openclaw/workspace-admin --model anthropic/claude-haiku-4-5

# Route Telegram to lead manager
openclaw agents bind --agent lead-manager --bind telegram

# Set identities
openclaw agents set-identity --agent lead-manager --name "Sarah's Assistant" --emoji "🏠"
openclaw agents set-identity --agent email-assistant --name "Email Manager" --emoji "📧"
openclaw agents set-identity --agent admin --name "Office Manager" --emoji "📋"

# Schedule cron jobs
openclaw cron add --name "Morning Briefing" --cron "30 7 * * 1-5" --tz "Australia/Melbourne" --agent admin --session isolated --message "Generate morning briefing"
openclaw cron add --name "Weekly Summary" --cron "0 16 * * 5" --tz "Australia/Melbourne" --agent admin --session isolated --message "Generate weekly summary"
```

### What the Client Experiences

One Telegram bot. They message it naturally. Multiple agents work behind the scenes:

```
Monday 7:30am — push notification:
    "Morning Briefing: 8 appointments today, 2 new leads 
     overnight, 1 follow-up overdue (Maria Santos, 3 days)"

During the day:
    Buyer: "Hi, looking for a 2-bed in Richmond under $900K"
    Bot: "I have a property that might suit — 15 Swan St, Cremorne, 
          $850K-$920K. Open home Saturday 11am. Can I register you?"

Sarah checks in:
    Sarah: "Any emails I need to deal with?"
    Bot: "4 new. 1 urgent — conveyancer needs docs by Wednesday. 
          I've drafted a reply. Want to see it?"
```

---

## Features to Offer Clients

### Included in All Tiers

| Feature | What it does |
|---------|-------------|
| Custom AI agent | Tailored to their business with specific knowledge and rules |
| Telegram/WhatsApp channel | Customers or staff message the bot |
| Message debouncing | Batches rapid messages into one response |
| Auto-restart | Gateway recovers from crashes automatically |
| Health monitoring | Automatic health checks every 30 seconds |
| HTTPS | Secure by default on Fly.io |

### Professional Tier Add-ons

| Feature | What it does |
|---------|-------------|
| Proactive messaging | Agent initiates messages (reminders, follow-ups, updates) |
| Memory | Agent remembers preferences, history, and context over time |
| Cron/scheduling | Morning briefings, weekly summaries, automated reminders |
| Allowlisting | Control who can message the bot |
| Quiet hours | Don't send messages outside business hours |

### Business Tier Add-ons

| Feature | What it does |
|---------|-------------|
| Multi-agent | Separate agents for reception, email, admin |
| Email integration | Read, triage, and draft replies via Gmail |
| Execution approvals | Require human sign-off before sending emails or taking actions |
| Polls | Native polls for customer feedback or staff voting |
| Send policies | Control where the agent can and can't send messages |
| Hooks | Custom actions on message events (logging, CRM updates) |

### Enterprise Add-ons

| Feature | What it does |
|---------|-------------|
| Canvas dashboards | Live HTML dashboards on iPad/Mac (reception display, queue board) |
| Browser automation | Agent can operate websites on behalf of the client |
| Custom skills | Integrations with client-specific software (CRM, booking systems) |
| Custom extensions | TypeScript plugins for deep integrations |

---

## Pricing Model

| Tier | What they get | Monthly price |
|------|---------------|---------------|
| Starter | 1 agent, 1 channel, system prompt, debouncing, quiet hours | $150/mo |
| Professional | + proactive messaging, memory, cron jobs, allowlisting | $300/mo |
| Business | + multi-agent, email, approvals, hooks, polls | $500/mo |
| Enterprise | + canvas, browser automation, custom skills, priority support | $800+/mo |

Setup fee: $300-500 (one-time)

### Cost Structure Per Client

| Component | Starter | Professional | Business |
|-----------|---------|-------------|----------|
| Fly.io hosting | $10/mo | $10/mo | $10/mo |
| AI API (Haiku) | $5/mo | $10/mo | — |
| AI API (mixed Haiku+Sonnet) | — | — | $25/mo |
| Total cost | $15/mo | $20/mo | $35/mo |
| You charge | $150/mo | $300/mo | $500/mo |
| Margin | $135/mo | $280/mo | $465/mo |

---

## Channel Strategy

### Start with Telegram (recommended)

- Free, instant setup via @BotFather
- You control everything — client effort is zero
- Users must have Telegram (smaller audience)
- Best for: internal team bots, tech-savvy client bases

### Add WhatsApp Business API when needed

- Everyone already has WhatsApp (larger audience)
- Requires Meta Business API approval (days-weeks)
- Costs ~$0.05/conversation
- Best for: customer-facing businesses (dental, retail, hospitality)

### Future channels

- Discord (communities, gaming, tech teams)
- Slack (corporate clients)
- SMS (via voice-call extension with Twilio)

---

## AI Model Selection Per Use Case

| Model | Cost | Quality | Best for |
|-------|------|---------|----------|
| Claude Haiku 4.5 | ~$0.20/1M tokens | Very good | Reception, FAQ, booking, simple tasks |
| Claude Sonnet 4.6 | ~$1/1M tokens | Excellent | Email drafting, complex reasoning, nuanced responses |
| Claude Opus 4.6 | ~$5/1M tokens | Best | Overkill for most use cases |
| GPT-5 mini | ~$0.25/1M tokens | Very good | Alternative to Haiku |
| Gemini 2.5 Flash | ~$0.10/1M tokens | Good | Budget option |

**Recommendation**: Haiku for most agents, Sonnet for email/drafting agents. Don't use Opus unless the client has complex reasoning needs.

For tool calling (which agents rely on heavily), Claude Haiku and Sonnet are best-in-class. Stick with Anthropic models for reliability.

---

## Custom Skills (How to Extend Without Code Changes)

Skills are markdown files that teach the agent how to use external tools. No TypeScript required.

### Example: Cliniko Booking Skill

```markdown
# Cliniko Booking Skill

Check availability and book appointments via the Cliniko API.

## Check available slots
curl -s -u $CLINIKO_API_KEY: \
  https://api.cliniko.com/v1/available_times?practitioner_id=123

## Book an appointment
curl -s -X POST -u $CLINIKO_API_KEY: \
  -d '{"appointment": {"starts_at": "...", "patient_id": "..."}}' \
  https://api.cliniko.com/v1/individual_appointments
```

### Workflow

1. Client says "I use Cliniko for bookings"
2. You write `skills/cliniko/SKILL.md` using Claude Code
3. Commit to your repo
4. Redeploy: `fly deploy --app agent-clientname`
5. Agent can now check and book appointments

### Skill library grows over time

Each new client potentially adds a reusable skill:
- `skills/cliniko/` — physiotherapy, allied health
- `skills/xero/` — accounting, invoicing
- `skills/square/` — retail POS
- `skills/calendly/` — scheduling
- `skills/mailchimp/` — email marketing
- `skills/stripe/` — payments

The more clients you serve, the more skills you accumulate. New clients in the same industry get set up faster because the skills already exist.

---

## Client Onboarding Playbook

### Before the Call (5 min)

- Create Telegram bot via @BotFather
- Prepare deploy script

### Discovery Call (30 min)

Ask the client:
1. "Walk me through a typical day"
2. "What tasks do you dread or waste time on?"
3. "What would you want an assistant to handle?"
4. "What software do you already use?" (booking system, CRM, email)
5. "Who would message the bot — you, your staff, or customers?"

### Build Phase (1-2 hours)

1. Write system prompt based on discovery call
2. Deploy to Fly.io
3. Configure agents, cron jobs, memory
4. Add any relevant skills
5. Test thoroughly yourself

### Handover Call (15 min)

1. Send client the Telegram bot link
2. Demo: "Try asking it to book an appointment"
3. Explain what it can and can't do
4. Set expectations on response quality and speed

### First Week

- Monitor logs daily
- Refine system prompt based on real usage
- Fix any gaps ("it didn't know our holiday hours")
- Check in with client: "How's it going?"

### Ongoing (1-2 hrs/mo per client)

- Monitor health and logs
- Update system prompt when client's info changes
- Apply OpenClaw updates
- Handle support requests

---

## Growth Path

| Phase | Clients | How you manage | Revenue |
|-------|---------|---------------|---------|
| Phase 1 | 1-5 | Manual setup, Fly.io dashboard | $750-2,500/mo |
| Phase 2 | 5-15 | Deploy scripts, skill library growing | $2,500-7,500/mo |
| Phase 3 | 15-30 | Your own management dashboard, hire support | $7,500-15,000/mo |
| Phase 4 | 30+ | Productized service, templated verticals | $15,000+/mo |

### Phase 1: Manual (now)

- Find 1-5 clients through your network
- Set up each one manually
- Learn what clients actually need
- Build your skill library

### Phase 2: Scripted (3-6 months)

- Deploy script handles 80% of setup
- Client configs are templatized by industry
- Skill library covers common integrations
- You spend more time on sales, less on setup

### Phase 3: Dashboard (6-12 months)

- Build a simple web dashboard (Flask — you know it from Blocksmith)
- Create/manage clients from a UI
- Monitoring and alerts across all clients
- Hire a support person for tier-1 issues

### Phase 4: Productized (12+ months)

- Vertical-specific packages ("AI Receptionist for Dental", "AI Lead Manager for Real Estate")
- Self-serve onboarding for simple setups
- Partner channel (other agencies resell your setup)
- Consider building your own multi-tenant SaaS at this point

---

## Key Decisions Made

1. **Use OpenClaw as npm package, don't fork** — get free updates, focus on service not code
2. **Fly.io for hosting** — cheapest always-on option, already configured in OpenClaw, scriptable
3. **One Fly.io account, one app per client** — isolated data, independent scaling, simple billing
4. **Start with Telegram** — free, instant setup, move to WhatsApp Business API when needed
5. **Claude Haiku as default model** — best cost/quality for tool-heavy agent work
6. **Skills over code** — markdown skill files for most integrations, fork only as last resort
7. **Service business first** — find clients, solve problems, build product later

---

## Lessons from Setting Up OpenClaw on DigitalOcean

### What went wrong

- 1GB RAM droplet was too small — OpenClaw uses ~500MB for the gateway alone
- SSH sessions dropping killed the gateway
- tmux detach key combo didn't work reliably
- Device pairing created a loop where gateway and CLI couldn't authenticate each other
- `openclaw onboard` wizard got stuck with no way to exit
- Manual server management is operationally heavy for one instance, let alone many

### What we learned

- **2GB RAM minimum** for stable operation
- **Swap space** (2GB) prevents OOM kills on smaller instances
- **nohup** is more reliable than tmux for background processes
- **systemd** auto-restart is good but can conflict with manual starts
- **Docker + Fly.io eliminates all of this** — auto-restart, health checks, no SSH needed
- **The product isn't the technology** — it's the outcome the client gets

### Why Fly.io over raw droplets

| Problem with droplets | Fly.io solves it |
|-----------------------|-----------------|
| SSH disconnect kills gateway | Auto-restart, always running |
| Manual memory management | 2GB allocated, no tuning needed |
| No health checks | Built-in health monitoring |
| Manual updates | `fly deploy` rebuilds everything |
| One server to manage per client | One command per client |
| tmux/nohup/systemd complexity | Zero — just deploy |

---

## Harnessing Supabase for Enhanced Memory

OpenClaw's built-in memory (file-backed + LanceDB) works for single-user personal setups, but for a multi-client business at scale, Supabase provides a more powerful, centralized, and queryable memory layer.

### Why Supabase Over Built-in Memory

| Built-in memory | Supabase memory |
|-----------------|-----------------|
| Files on disk per instance | Centralized database across all clients |
| No cross-client analytics | Query patterns across your entire client base |
| Lost if volume is deleted | Durable, backed-up PostgreSQL |
| Basic text search | Semantic vector search via pgvector |
| No structure | Typed, categorized, searchable |
| Per-instance only | Accessible from dashboard, skills, external tools |

### Schema Design

```sql
-- Core memory table
create table agent_memory (
    id uuid primary key default gen_random_uuid(),
    client_id text not null,           -- maps to Fly.io app name
    agent_id text not null,            -- which agent stored this
    category text not null,            -- 'preference', 'injury', 'equipment',
                                       -- 'contact', 'business_rule', 'feedback'
    content text not null,             -- the actual memory
    source text,                       -- 'conversation', 'manual', 'cron'
    embedding vector(1536),            -- for semantic search (OpenAI embeddings)
    metadata jsonb default '{}',       -- flexible extra data
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    expires_at timestamptz             -- optional TTL for temporary memories
);

-- Index for fast vector similarity search
create index on agent_memory using ivfflat (embedding vector_cosine_ops)
    with (lists = 100);

-- Index for client lookups
create index on agent_memory (client_id, category);

-- Conversation log table (for analytics and replay)
create table conversation_log (
    id uuid primary key default gen_random_uuid(),
    client_id text not null,
    agent_id text not null,
    session_key text,
    direction text not null,           -- 'inbound' or 'outbound'
    channel text not null,             -- 'telegram', 'whatsapp'
    sender text,                       -- phone number or username
    content text not null,
    tokens_used int,
    model text,                        -- which model handled this
    cost_estimate numeric(10,6),       -- estimated API cost
    created_at timestamptz default now()
);

-- Index for cost tracking
create index on conversation_log (client_id, created_at);

-- Client config table (backup/reference for what's deployed)
create table client_config (
    client_id text primary key,
    fly_app_name text not null,
    region text,
    tier text default 'starter',       -- 'starter', 'professional', 'business'
    primary_model text,
    system_prompt text,
    channels jsonb default '[]',
    agents jsonb default '[]',
    monthly_cost numeric(10,2),
    status text default 'active',      -- 'active', 'paused', 'churned'
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);
```

### How It Integrates with OpenClaw

Build a custom skill that the agent uses to read/write Supabase:

```markdown
# Memory Skill (skills/supabase-memory/SKILL.md)

Store and recall important information about this client's business.

## Store a memory
curl -s -X POST "$SUPABASE_URL/rest/v1/agent_memory" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"client_id": "$CLIENT_ID", "agent_id": "main",
       "category": "$CATEGORY", "content": "$CONTENT"}'

## Search memories
curl -s "$SUPABASE_URL/rest/v1/agent_memory?client_id=eq.$CLIENT_ID&content=ilike.*$QUERY*" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY"
```

### What This Enables

1. **Cross-session memory** — agent remembers "this client prefers morning appointments" across conversations
2. **Business intelligence** — query Supabase to see which clients get the most messages, what topics come up, which agents are busiest
3. **Cost tracking** — log every API call with token counts and cost estimates
4. **Client dashboard** — build a web view showing each client's memory, conversation history, and costs
5. **Memory portability** — if a client moves to a new instance, their memory comes with them
6. **Deduplication** — vector similarity search prevents storing the same fact twice
7. **Expiring memories** — temporary context ("office closed this week") auto-deletes via `expires_at`

### Implementation Path

1. Create a Supabase project (free tier handles 10-20 clients easily)
2. Run the schema SQL above
3. Write the `supabase-memory` skill
4. Add `SUPABASE_URL`, `SUPABASE_KEY`, and `CLIENT_ID` as secrets per Fly.io app
5. Agent automatically stores and recalls memories via the skill

### Cost

- Supabase free tier: 500MB database, 50K monthly active users
- Supabase Pro: $25/mo for 8GB, unlimited API calls
- pgvector embeddings: ~$0.0001 per embedding (OpenAI ada-002)

At $25/mo for Supabase Pro, it covers all your clients' memory needs.

---

## Managing Agentic Costs

Cost management is critical — AI API costs can spiral if not controlled. Here's a framework for keeping costs predictable while maintaining quality.

### Cost-Efficient Architecture

#### Complete Model Landscape

OpenClaw supports 30+ AI providers. Here's every viable model for agent work, organized by cost tier.

##### Tier 1 — Premium (best quality, highest cost)

| Provider | Model | Context | Tool Calling | Cost (input/output per 1M tokens) | Best for |
|----------|-------|---------|-------------|-----------------------------------|----------|
| Anthropic | claude-opus-4-6 | 256K | Excellent | ~$15 / $75 | Complex analysis, critical decisions |
| OpenAI | gpt-5.4-pro | 1.05M | Excellent | ~$10 / $40 | Deep reasoning, long context |
| xAI | grok-4 | 256K | Good | ~$3 / $15 | Reasoning-heavy tasks |
| Google | gemini-3.1-pro | 1M+ | Good | ~$3.50 / $10.50 | Long document analysis |

**Use for**: Tasks where mistakes are costly (legal drafts, financial analysis). Rarely needed for most SMB clients.

##### Tier 2 — Mid-range (great quality, moderate cost)

| Provider | Model | Context | Tool Calling | Cost (input/output per 1M tokens) | Best for |
|----------|-------|---------|-------------|-----------------------------------|----------|
| Anthropic | claude-sonnet-4-6 | 200K | Excellent | ~$3 / $15 | Email drafting, nuanced conversation |
| OpenAI | gpt-5.4 | 1.05M | Excellent | ~$2.50 / $10 | General intelligence, long context |
| Mistral | mistral-large-latest | 262K | Good | ~$2 / $6 | European data sovereignty |
| xAI | grok-4-fast | 2M | Good | ~$0.20 / $0.50 | Massive context window, multimodal |
| Moonshot | kimi-k2.5 | 262K | Good | ~$1.50 / $5 | Large context, Chinese + English |

**Use for**: Email drafting agents, complex customer interactions, analysis tasks.

##### Tier 3 — Value (good quality, low cost) — RECOMMENDED DEFAULT

| Provider | Model | Context | Tool Calling | Cost (input/output per 1M tokens) | Best for |
|----------|-------|---------|-------------|-----------------------------------|----------|
| Anthropic | claude-haiku-4-5 | 200K | Very good | ~$0.25 / $1.25 | **Best default for agents** |
| OpenAI | gpt-5.4-mini | 1.05M | Very good | ~$0.15 / $0.60 | Cheap OpenAI alternative |
| Mistral | mistral-small-latest | 128K | Good | ~$0.10 / $0.30 | European hosting, fast |
| Mistral | magistral-small | 128K | Good | ~$0.10 / $0.30 | Reasoning-capable, cheap |

**Use for**: Main conversation agent, reception bots, FAQ handling, routing, most tool calling tasks.

##### Tier 4 — Budget (acceptable quality, minimal cost)

| Provider | Model | Context | Tool Calling | Cost (input/output per 1M tokens) | Best for |
|----------|-------|---------|-------------|-----------------------------------|----------|
| Google | gemini-3.1-flash | 1M+ | Decent | ~$0.075 / $0.30 | Summarization, simple tasks |
| OpenAI | gpt-5.4-nano | 1.05M | Decent | ~$0.05 / $0.20 | Cheapest OpenAI, basic tasks |
| DeepSeek | deepseek-chat | 131K | Decent | ~$0.07 / $0.28 | Budget general purpose |
| MiniMax | MiniMax-M2.7 | 131K | Mediocre | ~$0.10 / $0.30 | Bulk simple tasks |

**Use for**: Subagent workers, summarization, simple automation, cron job tasks.

##### Tier 5 — Reasoning Specialists

| Provider | Model | Context | Tool Calling | Cost (input/output per 1M tokens) | Best for |
|----------|-------|---------|-------------|-----------------------------------|----------|
| DeepSeek | deepseek-reasoner | 131K | Decent | ~$0.55 / $2.19 | Step-by-step problem solving |
| OpenAI | gpt-5.4 (with reasoning) | 1.05M | Excellent | ~$2.50 / $10 | Complex multi-step tasks |
| Moonshot | kimi-k2-thinking | 262K | Good | ~$1 / $4 | Reasoning with large context |
| Mistral | magistral-small | 128K | Good | ~$0.10 / $0.30 | Budget reasoning |

**Use for**: Complex analysis, multi-step planning, debugging, financial calculations.

##### Tier 6 — Self-Hosted / Local (zero API cost)

| Provider | Model | Context | Tool Calling | Cost | Best for |
|----------|-------|---------|-------------|------|----------|
| Ollama | llama-3.3-70b | 131K | Decent | Hardware only | Privacy-sensitive clients |
| Ollama | qwen-2.5-72b | 128K | Decent | Hardware only | Chinese + English, local |
| Ollama | mistral-nemo | 128K | Decent | Hardware only | Small, fast, local |
| vLLM | Any supported model | Varies | Varies | Hardware only | High-throughput self-hosted |
| SGLang | Any supported model | Varies | Varies | Hardware only | Optimized inference |

**Use for**: Clients with strict data sovereignty requirements, or to eliminate API costs entirely (requires powerful server: 80GB+ VRAM for 70B models).

##### Tier 7 — Aggregators (access multiple models via one API key)

| Provider | What it offers | Cost | Best for |
|----------|---------------|------|----------|
| OpenRouter | 200+ models, single API key | Model-dependent + markup | Testing models, fallback routing |
| Together | Llama, DeepSeek, GLM, Kimi | Model-dependent | Open-source model access |
| Amazon Bedrock | Claude, Llama, Mistral | Model-dependent + AWS markup | Enterprise AWS clients |
| Cloudflare AI Gateway | Proxy to any provider | Provider cost + free proxy | Caching, rate limiting, analytics |
| Vercel AI Gateway | Proxy to any provider | Provider cost + free proxy | Edge deployment |

**Use for**: Clients who want model flexibility, or as a fallback layer when primary provider is down.

##### China/Asia-Specific Providers

| Provider | Key Model | Context | Tool Calling | Best for |
|----------|-----------|---------|-------------|----------|
| Qwen (Alibaba) | qwen-coder, qwen-vision | 128K | Good | Chinese market, multimodal |
| Qianfan (Baidu) | ernie-5.0-thinking | 119K | Good | Chinese market, reasoning |
| Volcengine (ByteDance) | Doubao variants | Varies | Decent | Chinese market |
| MiniMax | MiniMax-VL-01 | 204K | Mediocre | Vision + text, Chinese market |
| Moonshot (Kimi) | kimi-k2.5 | 262K | Good | Large context, bilingual |

#### Model Selection by Agent Role

The single biggest cost lever. Don't use the same model for everything:

| Agent Role | Recommended Model | Why | Monthly cost estimate |
|------------|-------------------|-----|----------------------|
| **Main conversation / routing** | claude-haiku-4-5 | Best tool calling reliability at low cost | $5-15 |
| **Email drafting** | claude-sonnet-4-6 | Quality writing matters for client reputation | $10-20 |
| **Simple worker / subagent** | gpt-5.4-nano or deepseek-chat | Cheapest for basic tasks | $2-5 |
| **Admin / cron summaries** | gemini-3.1-flash | Cheapest summarization | $1-3 |
| **Complex reasoning** | claude-sonnet-4-6 or deepseek-reasoner | Step-by-step analysis when needed | $5-15 |
| **Privacy-sensitive client** | Ollama (local llama-3.3-70b) | Zero data leaves the server | Hardware only |
| **Chinese market client** | kimi-k2.5 or qwen-coder | Native Chinese language support | $5-15 |
| **European data sovereignty** | mistral-small-latest | EU-hosted, GDPR compliant | $3-8 |
| **Maximum context (huge docs)** | grok-4-fast (2M) or gpt-5.4 (1.05M) | Won't hit context limits | $10-30 |

#### Multi-Model Agent Configuration

```bash
# Main agent: Haiku for conversation (cheap, reliable tool calling)
openclaw config set agent.model anthropic/claude-haiku-4-5

# Email agent: Sonnet for quality drafting
openclaw agents add email-assistant \
  --model anthropic/claude-sonnet-4-6

# Worker agent: cheapest viable for bulk tasks
openclaw agents add worker \
  --model openai/gpt-5.4-nano

# Admin agent: Flash for summaries and reminders
openclaw agents add admin \
  --model google/gemini-3.1-flash

# Fallback: if primary provider is down
openclaw config set models.fallbacks '["openai/gpt-5.4-mini", "mistral/mistral-small-latest"]'
```

#### Cost Comparison: Same Client, Different Model Strategies

| Strategy | Models used | Monthly AI cost | Quality |
|----------|-----------|-----------------|---------|
| Premium everything | Sonnet + Opus | $80-200 | Excellent |
| Balanced (recommended) | Haiku + Sonnet (email only) | $15-40 | Very good |
| Budget optimized | Haiku + Nano workers | $8-20 | Good |
| Ultra budget | Flash + DeepSeek | $5-12 | Acceptable |
| Self-hosted | Ollama (local) | $0 API / $50-100 hardware | Decent |
| Mixed with fallbacks | Haiku primary, Mini fallback | $10-25 | Very good |

#### Context Window Management

Long conversations burn tokens. At 320 messages, MiniMax hit context overflow (we experienced this). Strategies:

1. **Session rotation** — start fresh sessions periodically instead of one infinite conversation
2. **Auto-compaction** — OpenClaw compacts automatically, but smaller context models hit this sooner
3. **Use Haiku** — 200K token context window vs smaller windows on budget models
4. **Separate sessions per topic** — booking queries don't need the email history

```bash
# Configure session limits
openclaw config set session.maxMessages 100
```

#### Cron Job Cost Control

Scheduled tasks (briefings, summaries) run whether the client is paying attention or not. Control this:

| Approach | Monthly cron cost |
|----------|-------------------|
| Hourly briefing (24/day) | $15-30 |
| Morning + evening (2/day) | $2-5 |
| Weekday morning only (5/week) | $1-2 |
| Weekly summary (1/week) | $0.25-0.50 |

**Rule**: start with fewer cron jobs, add more only when the client asks.

#### Tool Call Efficiency

Each tool call costs tokens (the tool description, the call, the response). Minimize unnecessary tool use:

1. **System prompt precision** — tell the agent exactly when to use tools vs answer from knowledge
2. **Batch tool calls** — "check email and calendar" in one turn, not two separate interactions
3. **Skill design** — write skills that return concise results, not verbose API dumps

### Cost Tracking and Alerts

#### Per-Client Cost Monitoring

Log every API call to Supabase (see memory section above):

```sql
-- Monthly cost by client
select
    client_id,
    sum(cost_estimate) as monthly_cost,
    count(*) as total_messages,
    sum(tokens_used) as total_tokens
from conversation_log
where created_at >= date_trunc('month', now())
group by client_id
order by monthly_cost desc;
```

#### Cost Alerts

Set up a cron job that checks costs weekly:

```bash
openclaw cron add \
  --name "Cost Alert" \
  --cron "0 9 * * 1" \
  --tz "Australia/Melbourne" \
  --agent admin \
  --session isolated \
  --message "Check Supabase for this week's API costs across all clients. Alert me if any client exceeds $50 in AI costs this month."
```

#### Client-Facing Usage Limits

For clients on lower tiers, consider soft limits:

| Tier | Monthly message limit | Overage |
|------|----------------------|---------|
| Starter ($150/mo) | 500 messages | Notify you, discuss upgrade |
| Professional ($300/mo) | 2,000 messages | Notify you |
| Business ($500/mo) | Unlimited | Monitor only |

### Cost Optimization Checklist Per Client

1. **Default model**: Haiku (not Sonnet) unless they need writing quality
2. **Subagents**: MiniMax or Haiku for worker tasks
3. **Cron jobs**: weekday only, minimum frequency needed
4. **Session rotation**: enable auto-compaction, consider max message limits
5. **System prompt**: precise about when to use tools vs answer directly
6. **Skills**: return concise results, not raw API dumps
7. **Monitor**: weekly cost check, alert on anomalies

### Example Cost Breakdown: Real Estate Client (Professional Tier)

```
Monthly AI costs:
  Lead manager (Haiku, ~1500 msgs)     $8
  Email assistant (Sonnet, ~200 msgs)  $12
  Admin cron jobs (Haiku, 22 runs)     $2
  Subagent worker tasks (MiniMax)      $3
                                       ----
  Total AI cost:                       $25/mo

Infrastructure:
  Fly.io:                              $10/mo
  Supabase (shared):                   $2/mo (prorated)
                                       ----
  Total infrastructure:                $12/mo

Total cost:                            $37/mo
Client pays:                           $300/mo
Margin:                                $263/mo (88%)
```

### Scaling Cost Efficiency

As you add clients, costs get better:

| Clients | Total infra | Total AI | Total cost | Total revenue | Margin |
|---------|-------------|----------|------------|---------------|--------|
| 5 | $50/mo | $100/mo | $150/mo | $1,250/mo | 88% |
| 10 | $100/mo | $200/mo | $300/mo | $2,500/mo | 88% |
| 20 | $200/mo | $350/mo | $550/mo | $5,000/mo | 89% |
| 50 | $500/mo | $800/mo | $1,300/mo | $12,500/mo | 90% |

Margins improve because:
- Supabase cost is shared across all clients
- Fly.io volume discounts kick in
- You get faster at setup (less time per client)
- Skill library is reusable across similar clients

---

## Next Steps

1. Create GitHub repo `agent-deployments` (private)
2. Push deployment repo files (Dockerfile, fly.toml, scripts, configs)
3. Install Fly.io CLI: `brew install flyctl`
4. Create Fly.io account and add billing
5. Deploy a test instance for yourself
6. Migrate personal OpenClaw from DigitalOcean to Fly.io
7. Find first client
8. Deploy their agent
9. Iterate based on real feedback

---

## Tools Used

- **OpenClaw** — open source AI gateway (MIT license)
- **Fly.io** — container hosting platform
- **Docker** — containerization
- **Claude Code** — for writing system prompts, skills, and any code changes
- **Telegram** — primary messaging channel
- **Anthropic Claude** — AI model provider (Haiku for most, Sonnet for complex tasks)
