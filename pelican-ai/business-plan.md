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
6. **Low marginal cost** — each client costs ~$16-65/mo to serve, you charge $500-1,500/mo

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
- Customer-facing channels (WhatsApp Business API, website chat widget)
- Internal channel for the business owner (Telegram)
- Custom system prompt tailored to their business
- Memory, agents, cron jobs, and approvals configured to their needs

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

## Features (All Tiers)

Every client gets the full OpenClaw capability set. Tiers differ on scope (channels, integrations, support), not features.

| Feature | What it does |
|---------|-------------|
| Custom AI agent(s) | Tailored to their business with specific knowledge and rules |
| Memory | Agent remembers preferences, history, and context over time |
| Proactive messaging | Agent initiates messages (reminders, follow-ups, updates) |
| Cron/scheduling | Morning briefings, weekly summaries, automated reminders |
| Message debouncing | Batches rapid messages into one response |
| Execution approvals | Human sign-off before the agent sends emails or takes actions |
| Quiet hours | Don't send messages outside business hours |
| Allowlisting | Control who can message the bot |
| Polls | Native polls for customer feedback or staff voting |
| Auto-restart | Gateway recovers from crashes automatically |
| Health monitoring | Automatic health checks every 30 seconds |
| HTTPS | Secure by default on Fly.io |
| Conversation logging | Every interaction logged for cost tracking and compliance |

### What tiers unlock (scope, not features)

| | Starter | Growth | Scale |
|---|---------|--------|-------|
| Channels | 1 | Up to 3 | Unlimited |
| Premium models (Sonnet) | No | Email agent only | Any agent |
| Custom integrations | Built-in skills only | 1 custom skill | Multiple |
| Support | Email, 48hr | Email, 24hr + weekly check-in | Priority, same-day + monthly review |
| Compliance | Standard logging | Standard | Extended (7-year retention, audit trail) |

---

## Pricing Model

> You're not buying software. You're hiring a worker who never sleeps, never calls
> in sick, and costs a fraction of a part-time hire. A good admin assistant in
> Australia costs $1,200-1,400/mo. Pelican AI starts at $500/mo.

**Setup fee:** $750-1,000 one-time — covers discovery, build, testing, and onboarding.

### Starter — $500/mo

> "Your always-on receptionist"

- Answers enquiries 24/7 on one channel (WhatsApp, email, or web)
- Books appointments automatically
- Sends reminders and follow-ups
- Frees up ~5 hours of admin per week

**Best for:** Solo operators, single-location businesses

### Growth — $900/mo

> "Your admin team"

- Everything in Starter
- Works across multiple channels (email + WhatsApp + web)
- Remembers customer history and context
- Runs scheduled tasks (daily reports, follow-up sequences, reminders)
- Escalates to you when it needs a human decision

**Best for:** Small teams, service businesses with real admin load

### Scale — $1,500/mo

> "Your operations layer"

- Everything in Growth
- Multi-agent setup (separate agents for reception, email, admin)
- Full compliance logging and audit trail
- Custom integrations (CRM, booking systems, accounting)
- Proactive outreach (lead follow-up, re-engagement campaigns)
- Priority support and monthly optimization reviews

**Best for:** Multi-location businesses, regulated industries, growing teams

### Internal Build Constraints (Not Customer-Facing)

Guardrails that control cost without degrading the product. Customers see outcomes, not limits.

**Principle**: Don't gate features that cost almost nothing (memory, agents, subagents, cron). Gate the things that actually drive spend (model choice, session length, channel count). Everything else should be as good as possible at every tier — that's how you prove value fast on Starter and upsell naturally.

#### What actually drives cost (and what doesn't)

| Factor | Cost impact | Constrain it? |
|--------|-----------|---------------|
| **Model choice** | Huge — Sonnet is 12x Haiku per token | **Yes — biggest lever** |
| **Session length** | Moderate — longer context = more tokens per call | **Yes — daily reset + message caps** |
| **Message volume** | Moderate — more messages = more API calls | **Yes — debouncing** |
| **Channel count** | Small — WhatsApp API per-conversation charge | **Slightly — limits your setup time** |
| **Number of agents** | Near zero — idle agents cost nothing | **No** |
| **Memory** | Small — ~10-20% more tokens, ~$1-2/mo | **No — it makes the product better** |
| **Subagents** | Small — only fire when invoked | **No — can save cost by routing to cheaper models** |
| **Cron jobs** | Tiny — $0.01-0.05 per run | **No** |
| **Approvals** | Zero — it's a gate, not a cost | **No — use where needed regardless of tier** |

#### Constraints that apply to ALL tiers

Every client deployment gets these by default:

```bash
# Memory — always on. It makes the product dramatically better for ~$1-2/mo.
openclaw config set agents.defaults.memorySearch.enabled true
openclaw config set agents.defaults.memorySearch.query.maxResults 10
openclaw config set agents.defaults.memorySearch.cache.enabled true

# Session hygiene — prevents runaway context and cost
openclaw config set session.reset.mode daily
openclaw config set session.maintenance.pruneAfter "30d"
openclaw config set session.maintenance.maxEntries 500

# Debouncing — batches rapid messages, reduces API calls
openclaw config set messages.inbound.debounceMs 2000
openclaw config set messages.inbound.byChannel.whatsapp 3000

# Execution approvals — on where the agent sends outbound
# Set per-client based on their needs, not per tier
openclaw config set approvals.exec.mode "on-miss"

# Conversation logging — always, for all clients
# (Supabase conversation_log — needed for cost tracking and compliance)
```

#### What actually differs per tier

| Constraint | Starter | Growth | Scale | Why it matters |
|-----------|---------|--------|-------|----------------|
| **Channels** | 1 | Up to 3 | Unlimited | Your setup/testing time per channel |
| **Model for main agent** | Value tier only (Qwen 3.6 Plus / Haiku) | Value tier | Value or mid-tier | Controls the biggest cost line |
| **Sonnet/premium model access** | No | Email agent only | Any agent | Sonnet is 12x Haiku — gate this |
| **Custom integrations** | None (built-in skills only) | 1 custom skill | Multiple custom skills | Your build time |
| **Session message cap** | 150 per sender per day | 300 per sender per day | 500 per sender per day | Prevents runaway token spend |
| **Support level** | Email, 48hr response | Email, 24hr + weekly check-in | Priority, same-day + monthly review | Your time |
| **Compliance logging** | Standard (Supabase) | Standard | Extended (7-year retention, audit) | Storage + regulatory |

**Everything else is the same across all tiers**: memory on, agents as needed, subagents allowed, cron jobs as needed, approvals where appropriate. Build the best solution for each client — just control the model and session length to manage cost.

#### Why this is better

- **Starter clients get memory, subagents, cron** — the product is good from day one
- **Upsell is about scope** (more channels, custom integrations, premium models, faster support) not about unlocking features that should have been there
- **Cost control lives in model selection and session caps** — the two things that actually drive 80%+ of spend
- **Agents, memory, approvals are free** — gating them is artificial scarcity that makes the product worse for no real savings

#### Cost Overage Protection

If a client's usage spikes unexpectedly:

1. **Session message cap per sender** — hard daily limit prevents infinite conversations
2. **Daily session reset** — flushes context, new day = new session
3. **Debouncing** — batches rapid messages into fewer API calls
4. **Model pinning** — Sonnet only on designated agents, never the main conversation agent (Starter/Growth)
5. **Monitor weekly** — Supabase cost tracking query catches anomalies early
6. **Subagents route to cheaper models** — delegation to DeepSeek/Flash for simple tasks saves money vs main agent doing everything

If a client consistently exceeds cost targets, it's an upsell conversation, not a loss.

### Cost to Serve Summary

| | Starter | Growth | Scale |
|---|---------|--------|-------|
| Fly.io | $10 | $10 | $10 |
| AI API (value-tier main) | $5-12 | $8-18 | $8-18 |
| AI API (Sonnet where used) | — | $5-12 | $10-25 |
| WhatsApp/channels | $0-5 | $3-7 | $5-10 |
| Supabase (shared) | $1 | $1 | $2 |
| **Total** | **$16-28** | **$27-48** | **$35-65** |
| **You charge** | **$500** | **$900** | **$1,500** |
| **Margin** | **94-97%** | **95-97%** | **96-98%** |

### Revenue Projections

| Clients | Mix | Monthly revenue | Monthly cost | Monthly profit |
|---------|-----|-----------------|-------------|----------------|
| 3 | 2 Starter + 1 Growth | $1,900 | $80 | $1,820 |
| 5 | 3 Starter + 2 Growth | $3,300 | $140 | $3,160 |
| 10 | 5 Starter + 3 Growth + 2 Scale | $8,200 | $370 | $7,830 |
| 20 | 10 Starter + 7 Growth + 3 Scale | $15,800 | $740 | $15,060 |

---

## Channel Strategy

### Customer-facing channels (what the client's customers use)

| Channel | Setup | Cost | Best for |
|---------|-------|------|----------|
| **WhatsApp Business API** | Meta Business Suite registration, API approval | ~$0.05/conversation | Universal — everyone has WhatsApp |
| **Website chat widget** | JavaScript snippet on client's site | Free (built into OpenClaw) | Prospects browsing the website |
| **SMS (Twilio)** | Twilio account + phone number | ~$0.05/message | Appointment reminders, older demographics |
| **Email** | Gmail/SMTP integration via skills | Free (API cost only) | Professional communications, documents |

### Internal channels (what the business owner/staff use)

| Channel | Setup | Cost | Best for |
|---------|-------|------|----------|
| **Telegram** | @BotFather, 30 seconds | Free | Daily use — briefings, email drafts, queries |
| **Slack** | Slack app creation | Free | Teams already on Slack |

### Recommended rollout per client

1. **Week 1-2**: Telegram for the business owner (internal, testing)
2. **Week 3-4**: Website chat widget for prospects (zero friction)
3. **Week 5-6**: WhatsApp Business API for customer communication
4. **Ongoing**: SMS for appointment reminders (if relevant)

---

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
| Phase 1 | 1-5 | Manual setup, Fly.io dashboard | $2,500-5,000/mo |
| Phase 2 | 5-15 | Deploy scripts, skill library growing | $5,000-12,000/mo |
| Phase 3 | 15-30 | Your own management dashboard, hire support | $12,000-25,000/mo |
| Phase 4 | 30+ | Productized service, templated verticals | $25,000+/mo |

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
4. **Customers on WhatsApp/web chat, staff on Telegram** — meet customers where they are, staff gets a free internal tool
5. **Qwen 3.6 Plus as default model** — #1 MCPMark tool calling, 1M context, $0.33/$1.95 per 1M tokens; Haiku as fallback
6. **Gate cost drivers (model, session length), give everything else** — memory, agents, subagents, cron all enabled on every tier
7. **Skills over code** — markdown skill files for most integrations, fork only as last resort
8. **Service business first** — find clients, solve problems, build product later
9. **Price against the admin hire** ($1,200-1,400/mo), not the AI cost ($16-65/mo)

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
| Z.AI | GLM-5.1 | 203K | Very good | ~$0.95 / $3.15 | Strong agentic tool use, coding |
| Mistral | mistral-large-latest | 262K | Good | ~$2 / $6 | European data sovereignty |
| xAI | grok-4-fast | 2M | Good | ~$0.20 / $0.50 | Massive context window, multimodal |
| Moonshot | kimi-k2.5 | 262K | Good | ~$1.50 / $5 | Large context, Chinese + English |

**Use for**: Email drafting agents, complex customer interactions, analysis tasks.

**GLM-5.1 note**: Released April 2026. Significant improvements over GLM-5 in coding, agentic tool usage, and reasoning. Supports 203K context, 65K max output. Strong multi-step tool use. Priced between Value and Mid-range tiers.

##### Tier 3 — Value (good quality, low cost) — STRONG CONTENDERS FOR DEFAULT

| Provider | Model | Context | Tool Calling | Cost (input/output per 1M tokens) | Best for |
|----------|-------|---------|-------------|-----------------------------------|----------|
| Qwen (Alibaba) | **qwen-3.6-plus** | **1M** | **Best in class (MCPMark #1)** | **~$0.33 / $1.95** | **Best value agent model — top tool calling at low cost** |
| Anthropic | claude-haiku-4-5 | 200K | Very good | ~$0.25 / $1.25 | Proven reliable, Anthropic ecosystem |
| OpenAI | gpt-5.4-mini | 1.05M | Very good | ~$0.15 / $0.60 | Cheap OpenAI alternative |
| Mistral | mistral-small-latest | 128K | Good | ~$0.10 / $0.30 | European hosting, fast |
| Mistral | magistral-small | 128K | Good | ~$0.10 / $0.30 | Reasoning-capable, cheap |

**Use for**: Main conversation agent, reception bots, FAQ handling, routing, most tool calling tasks.

**IMPORTANT — Qwen 3.6 Plus changes the game:**
- **#1 on MCPMark** (48.2%) for tool-calling reliability — leads every model tested
- **96.5% function calling accuracy** vs DeepSeek V3's 81.5% on identical test suites
- **1M native context window** — 5x Haiku's 200K, won't hit context overflow
- **Always-on chain-of-thought reasoning** built in
- **$0.33/$1.95 per 1M tokens** — slightly more than Haiku but massively better tool calling
- Developers report fewer retries and more consistent tool-call behavior vs previous Qwen models
- Available via OpenClaw's Qwen extension or via OpenRouter

**Recommendation update**: Test Qwen 3.6 Plus as your default agent model. If tool calling is reliable in your OpenClaw setup, it's better value than Haiku for agent work: better tool calling, 5x the context window, for only ~30% more on input cost.

##### Tier 4 — Budget (acceptable quality, minimal cost)

| Provider | Model | Context | Tool Calling | Cost (input/output per 1M tokens) | Best for |
|----------|-------|---------|-------------|-----------------------------------|----------|
| DeepSeek | **deepseek-v3.2** | **163K** | **Decent (with thinking-in-tools)** | **~$0.28 / $0.42** | **Cheapest viable agent model** |
| Google | gemini-3.1-flash | 1M+ | Decent | ~$0.075 / $0.30 | Summarization, simple tasks |
| OpenAI | gpt-5.4-nano | 1.05M | Decent | ~$0.05 / $0.20 | Cheapest OpenAI, basic tasks |
| DeepSeek | deepseek-chat (V3) | 131K | Decent | ~$0.07 / $0.28 | Legacy, still works |
| MiniMax | MiniMax-M2.7 | 131K | Mediocre | ~$0.10 / $0.30 | Bulk simple tasks |

**Use for**: Subagent workers, summarization, simple automation, cron job tasks.

**DeepSeek V3.2 note**: Released 2026. Supports "Thinking in Tool-Use" (reasons before calling tools). 163K context. Extremely cheap at $0.28/$0.42. 90% discount on cached input tokens ($0.028/M). Tool calling reliability is weaker than Qwen/Haiku (~81.5% vs 96.5%) — fine for simple subagent tasks, not recommended as primary conversation agent. Scored gold on IMO and IOI benchmarks for reasoning.

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
| Qwen (Alibaba) | **qwen-3.6-plus** | **1M** | **#1 MCPMark** | **Best tool calling model at any price** |
| Qwen (Alibaba) | qwen-coder, qwen-vision | 128K | Good | Code + multimodal tasks |
| Z.AI (Zhipu) | **GLM-5.1** | **203K** | **Very good** | **Strong agentic workflows, coding** |
| Qianfan (Baidu) | ernie-5.0-thinking | 119K | Good | Chinese market, reasoning |
| Volcengine (ByteDance) | Doubao variants | Varies | Decent | Chinese market |
| MiniMax | MiniMax-VL-01 | 204K | Mediocre | Vision + text, Chinese market |
| Moonshot (Kimi) | kimi-k2.5 | 262K | Good | Large context, bilingual |

#### Model Selection by Agent Role

The single biggest cost lever. Don't use the same model for everything:

| Agent Role | Recommended Model | Alternative | Why | Monthly cost |
|------------|-------------------|-------------|-----|-------------|
| **Main conversation / routing** | **qwen-3.6-plus** | claude-haiku-4-5 | Best tool calling (#1 MCPMark), 1M context | $5-15 |
| **Email drafting** | claude-sonnet-4-6 | GLM-5.1 | Quality writing, professional tone | $10-20 |
| **Simple worker / subagent** | deepseek-v3.2 | gpt-5.4-nano | Cheapest with thinking-in-tools | $2-5 |
| **Admin / cron summaries** | gemini-3.1-flash | deepseek-v3.2 | Cheapest summarization | $1-3 |
| **Complex reasoning** | deepseek-reasoner | claude-sonnet-4-6 | Step-by-step analysis | $5-15 |
| **Agentic workflows (multi-step)** | GLM-5.1 | qwen-3.6-plus | Built for long-horizon agent tasks | $8-15 |
| **Privacy-sensitive client** | Ollama (local) | — | Zero data leaves the server | Hardware only |
| **Chinese market client** | qwen-3.6-plus | kimi-k2.5 | Native Chinese, best tool calling | $5-15 |
| **European data sovereignty** | mistral-small-latest | — | EU-hosted, GDPR compliant | $3-8 |
| **Maximum context (huge docs)** | grok-4-fast (2M) | qwen-3.6-plus (1M) | Won't hit context limits | $5-30 |

#### 4 Recommended Model Presets

##### Preset A — "Best Agent Quality" (recommended default)

**Priority**: Best tool calling reliability. Minimise retries and failed tool calls.

| Role | Model | Why |
|------|-------|-----|
| Main conversation | **Qwen 3.6 Plus** | #1 MCPMark tool calling (48.2%), 1M context, $0.33/$1.95 |
| Email/drafting | **Claude Sonnet 4.6** | Best English writing quality, professional tone |
| Workers/subagents | **Claude Haiku 4.5** | Proven reliable tool calling as fallback |
| Cron/summaries | **Qwen 3.6 Plus** | Same main model, no extra provider complexity |
| Fallback | **Claude Haiku 4.5** | If Qwen API has issues |

```bash
openclaw config set agent.model qwen/qwen-3.6-plus
openclaw agents add email-assistant --model anthropic/claude-sonnet-4-6
openclaw agents add worker --model anthropic/claude-haiku-4-5
openclaw config set models.fallbacks '["anthropic/claude-haiku-4-5"]'
```

**Monthly AI cost**: $12-35 (moderate use)
**Strengths**: Best tool calling at any price, huge context window, excellent fallback
**Tradeoff**: Two providers to manage API keys for (Qwen + Anthropic)

##### Preset B — "Anthropic Only" (simplest)

**Priority**: Single provider. One API key. Proven ecosystem. No surprises.

| Role | Model | Why |
|------|-------|-----|
| Main conversation | **Claude Haiku 4.5** | Reliable, cheap, 200K context |
| Email/drafting | **Claude Sonnet 4.6** | Same provider, best writing |
| Workers/subagents | **Claude Haiku 4.5** | Same model, consistent behaviour |
| Cron/summaries | **Claude Haiku 4.5** | Keep it simple |
| Fallback | **Mistral Small** | Different provider for resilience |

```bash
openclaw config set agent.model anthropic/claude-haiku-4-5
openclaw agents add email-assistant --model anthropic/claude-sonnet-4-6
openclaw config set models.fallbacks '["mistral/mistral-small-latest"]'
```

**Monthly AI cost**: $15-40 (moderate use)
**Strengths**: One API key for 90% of usage, well-documented, predictable costs
**Tradeoff**: Haiku's tool calling is very good but not best-in-class; 200K context (not 1M)

##### Preset C — "Minimum Cost" (budget)

**Priority**: Lowest possible AI spend. Acceptable quality for simple use cases.

| Role | Model | Why |
|------|-------|-----|
| Main conversation | **Qwen 3.6 Plus** | Best tool calling, cheap enough for primary |
| Email/drafting | **GLM-5.1** | Good writing at 1/5th of Sonnet's cost |
| Workers/subagents | **DeepSeek V3.2** | Cheapest viable tool calling ($0.28/$0.42) |
| Cron/summaries | **DeepSeek V3.2** | Same cheap model |
| Fallback | **Gemini 3.1 Flash** | Cheapest mainstream fallback |

```bash
openclaw config set agent.model qwen/qwen-3.6-plus
openclaw agents add email-assistant --model z-ai/glm-5.1
openclaw agents add worker --model deepseek/deepseek-v3.2
openclaw config set models.fallbacks '["google/gemini-3.1-flash"]'
```

**Monthly AI cost**: $6-18 (moderate use)
**Strengths**: 60-70% cheaper than Preset A, still good tool calling on main agent
**Tradeoff**: 3 providers to manage; GLM/DeepSeek writing quality below Sonnet; DeepSeek tool calling weaker (81.5% vs 96.5%)

##### Preset D — "Privacy First" (data sovereignty)

**Priority**: No data sent to US or Chinese providers. EU/local only.

| Role | Model | Why |
|------|-------|-----|
| Main conversation | **Mistral Small** | EU-hosted (France), GDPR compliant |
| Email/drafting | **Mistral Large** | Same provider, better writing |
| Workers/subagents | **Mistral Small** | Consistent, EU-only |
| Cron/summaries | **Mistral Small** | Keep it in one provider |
| Fallback | **Ollama (local)** | Self-hosted, zero external calls |

```bash
openclaw config set agent.model mistral/mistral-small-latest
openclaw agents add email-assistant --model mistral/mistral-large-latest
openclaw config set models.fallbacks '["ollama/mistral-nemo"]'
```

**Monthly AI cost**: $8-25 (moderate use)
**Strengths**: All data stays in EU; single provider; GDPR/privacy story for regulated clients
**Tradeoff**: Tool calling good but not best-in-class; smaller context windows (128-262K); Ollama fallback requires server with GPU

#### Which Preset for Which Client?

| Client type | Preset | Why |
|-------------|--------|-----|
| Most SMB clients (default) | **A — Best Agent Quality** | Reliable tool calling is everything for agent work |
| Clients who ask "what AI do you use?" | **B — Anthropic Only** | Brand recognition, trust, "we use Claude" |
| Price-sensitive clients / Starter tier | **C — Minimum Cost** | Keeps your margins high on lower-priced plans |
| Healthcare, legal, financial services | **B or D** | Compliance, data sovereignty, audit trail |
| Clients who say "my data can't leave Australia" | **D — Privacy First** | EU hosting + local fallback |

#### Context Window Management

Long conversations burn tokens. At 320 messages, MiniMax hit context overflow (we experienced this). Strategies:

1. **Use models with large context** — Qwen 3.6 Plus (1M) or GPT-5.4 (1.05M) virtually eliminate overflow
2. **Session reset daily** — build constraint on Starter/Growth tiers prevents accumulation
3. **Session message caps** — hard limit per tier (100/200/500) prevents runaway costs
4. **Auto-compaction** — OpenClaw compacts automatically when approaching context limit
5. **Separate sessions per topic** — booking queries don't need the email history

```bash
# Session limits per tier
# Starter
openclaw config set session.maxMessages 150
openclaw config set session.reset.mode daily

# Growth
openclaw config set session.maxMessages 300
openclaw config set session.reset.mode daily

# Scale
openclaw config set session.maxMessages 500
openclaw config set session.reset.mode idle
openclaw config set session.reset.idleMinutes 480
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

### Cost Optimization Checklist Per Client

1. **Default model**: Qwen 3.6 Plus or Haiku (not Sonnet) unless they need writing quality
2. **Subagents**: Route to DeepSeek V3.2 or Haiku for worker tasks
3. **Cron jobs**: weekday only, minimum frequency needed
4. **Session management**: daily reset, per-tier message caps (150/300/500)
5. **System prompt**: precise about when to use tools vs answer from knowledge
6. **Skills**: return concise results, not verbose API dumps
7. **Monitor**: weekly cost check via Supabase, alert on anomalies
8. **Debouncing**: 2-3s per channel to batch rapid messages

### Example Cost Breakdown: Real Estate Client (Growth Tier)

```
Monthly AI costs:
  Lead manager (Haiku, ~1500 msgs)     $8
  Email assistant (Sonnet, ~200 msgs)  $12
  Admin cron jobs (Haiku, 22 runs)     $2
  Subagent worker tasks (Haiku)        $3
                                       ----
  Total AI cost:                       $25/mo

Infrastructure:
  Fly.io:                              $10/mo
  Supabase (shared):                   $2/mo (prorated)
  WhatsApp Business API:               $5/mo
                                       ----
  Total infrastructure:                $17/mo

Total cost to serve:                   $42/mo
Client pays:                           $900/mo
Margin:                                $858/mo (95%)
```

### Scaling Cost Efficiency

As you add clients, margins stay at 90-95%:

| Clients | Mix | Total cost | Total revenue | Monthly profit | Margin |
|---------|-----|------------|---------------|----------------|--------|
| 3 | 2S + 1G | $75 | $1,900 | $1,825 | 96% |
| 5 | 3S + 2G | $130 | $3,300 | $3,170 | 96% |
| 10 | 5S + 3G + 2Sc | $350 | $8,200 | $7,850 | 96% |
| 20 | 10S + 7G + 3Sc | $700 | $15,800 | $15,100 | 96% |

S = Starter ($500), G = Growth ($900), Sc = Scale ($1,500)

Margins stay high because:
- AI costs scale linearly but are tiny relative to price
- Supabase cost is shared across all clients ($25/mo covers everyone)
- Fly.io volume discounts kick in at scale
- You get faster at setup (less time per client)
- Skill library is reusable across similar clients
- The value to the client ($1,200-1,400/mo admin hire replaced) anchors the price

---

## OpenClaw Best Practices

### Memory Management

#### Enabling Memory

Memory is file-backed Markdown stored in the agent workspace:
- `memory/YYYY-MM-DD.md` — daily logs (append-only, auto-loaded at session start)
- `MEMORY.md` — curated long-term facts, decisions, preferences
- Two tools available to agents: `memory_search` (semantic recall) and `memory_get` (targeted file reads)

**Enable/disable in config:**

```json
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "enabled": true
      }
    }
  }
}
```

Set `enabled: false` for fully stateless bots (simple FAQ bots that don't need to remember anything).

#### Embedding Provider Configuration

Memory search uses embeddings for semantic recall. Configure the provider:

```json
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "provider": "openai",
        "model": "text-embedding-3-small",
        "query": {
          "maxResults": 10,
          "minScore": 0.5
        },
        "cache": {
          "enabled": true
        }
      }
    }
  }
}
```

Supported embedding providers: `openai`, `gemini`, `voyage`, `mistral`, `ollama`, `local`.

**Recommendation**: Use `openai/text-embedding-3-small` — cheapest and most reliable. Cache is on by default (SQLite) to reduce reindex cost.

#### Hybrid Search (Recommended for Production)

Combines keyword matching (BM25) with vector similarity for better recall:

```json
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "query": {
          "hybrid": {
            "enabled": true,
            "textWeight": 0.4,
            "vectorWeight": 0.6,
            "mmr": {
              "enabled": true,
              "lambda": 0.5
            }
          }
        }
      }
    }
  }
}
```

MMR (Maximal Marginal Relevance) adds diversity to results so you don't get 10 near-identical memories.

#### LanceDB Vector Memory (Advanced)

The `memory-lancedb` extension adds long-term vector memory with auto-capture:

```json
{
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small"
  },
  "autoCapture": true,
  "autoRecall": true,
  "captureMaxChars": 500
}
```

Memory categories: `preference`, `fact`, `decision`, `entity`, `other`.

- **autoRecall**: Automatically searches memory before responding (injects relevant context)
- **autoCapture**: Automatically saves important information from conversations
- **captureMaxChars**: Limits how much is stored per memory entry

#### Context Window & Compaction

Long conversations burn tokens. OpenClaw auto-compacts when nearing the context limit:

```json
{
  "agents": {
    "defaults": {
      "compaction": {
        "reserveTokensFloor": 20000,
        "mode": "default",
        "memoryFlush": {
          "enabled": true,
          "softThresholdTokens": 4000
        }
      }
    }
  }
}
```

- **reserveTokensFloor**: Prevents over-aggressive compression (keep at 20-30K)
- **memoryFlush**: Before compacting, the agent saves important facts to memory (prevents losing context during summarization)
- **Manual compaction**: Use `/compact Focus on decisions and open questions` in a chat session

#### Memory Best Practices for Client Deployments

| Practice | Config | Why |
|----------|--------|-----|
| Enable memory for all clients | `memorySearch.enabled: true` | Dramatically improves consistency, costs ~$1-2/mo |
| Use hybrid search | `query.hybrid.enabled: true` | Combines keyword + semantic matching |
| Set maxResults to 5-15 | `query.maxResults: 10` | Balance between recall and prompt bloat |
| Set reserve tokens to 20-30K | `compaction.reserveTokensFloor: 20000` | Prevents context overflow crashes |
| Enable memory flush | `compaction.memoryFlush.enabled: true` | Saves facts before compaction |
| Cache embeddings | `cache.enabled: true` (default) | Reduces reindex cost |
| Clear memory on hard reset | Delete `memory/` and `MEMORY.md` | Memories don't auto-purge |

#### Memory CLI Commands

```bash
# Check memory status
openclaw memory status --deep --agent <id>

# Force reindex
openclaw memory index --force --agent <id>

# Search from CLI
openclaw memory search "appointment preferences" --max-results 20 --agent <id>
```

---

### Configuration Management

#### Config File & Precedence

Config lives at `~/.openclaw/openclaw.json`. Precedence (highest to lowest):

1. Process environment variables
2. `./.env` (project root)
3. `~/.openclaw/.env` (daemon mode)
4. `openclaw.json` env block
5. Runtime defaults

**Rule**: Use environment variables for secrets (API keys, tokens). Use `openclaw.json` for behavior configuration.

#### CLI Config Commands

```bash
# View a setting
openclaw config get agent.model

# Set a value
openclaw config set agent.model anthropic/claude-haiku-4-5

# View full config
openclaw config get

# Remove a setting (revert to default)
openclaw config unset agents.defaults.memorySearch.provider
```

#### Hot Reload vs Restart

OpenClaw supports hot-reloading most config changes without restarting the gateway.

**Reload mode** (default: `hybrid`):

```json
{
  "gateway": {
    "reload": {
      "mode": "hybrid"
    }
  }
}
```

Modes:
- `"hybrid"` (default): Hot-reload where possible, restart only when required
- `"hot"`: Never restart, ignore changes requiring restart
- `"restart"`: Always restart on any config change
- `"off"`: Ignore all config changes until manual restart

**What hot-reloads (no restart needed):**
- Hooks, cron jobs, heartbeat, model defaults
- Channel configuration (individual channel restarts)
- Health monitor thresholds, browser control
- Tool/skill enable/disable
- Message settings (debounce, reactions)

**What requires gateway restart:**
- Gateway auth, port, bind settings
- Plugin configuration
- Discovery, canvas host settings
- TLS/Tailscale configuration

#### Session Configuration

```json
{
  "session": {
    "scope": "per-sender",
    "reset": {
      "mode": "daily",
      "atHour": 0
    },
    "maintenance": {
      "pruneAfter": "30d",
      "maxEntries": 500
    },
    "threadBindings": {
      "idleHours": 24
    }
  }
}
```

| Setting | Recommended for SMB | Why |
|---------|--------------------|----|
| `scope: "per-sender"` | Yes (default) | Each customer gets their own conversation |
| `reset.mode: "daily"` | Yes | Fresh context each day, prevents bloat |
| `maintenance.pruneAfter: "30d"` | Yes | Auto-delete old sessions |
| `maintenance.maxEntries: 500` | Yes | Hard cap on storage growth |

#### Message Configuration

```json
{
  "messages": {
    "queue": {
      "debounceMs": 500,
      "mode": "fifo",
      "cap": 100
    },
    "inbound": {
      "debounceMs": 2000,
      "byChannel": {
        "whatsapp": 3000,
        "telegram": 1500
      }
    },
    "statusReactions": {
      "enabled": true,
      "emojis": {
        "thinking": "🤔",
        "done": "✅"
      }
    }
  }
}
```

**Debouncing per channel**: WhatsApp users tend to send rapid-fire messages more than Telegram users. Set higher debounce for WhatsApp (3000ms) so the agent waits for the full message before responding.

**Status reactions**: The agent reacts with an emoji while thinking, then changes it when done. Gives users visual feedback.

#### Tool & Skill Enable/Disable

```json
{
  "tools": {
    "allow": ["*"],
    "deny": ["browser_navigate"]
  },
  "skills": {
    "enabled": true
  }
}
```

For client deployments, deny tools you don't want available:
- `browser_navigate` — unless the client needs web browsing
- `exec` — unless you trust the agent to run commands
- Keep `memory_search`, `memory_get`, and your custom skills enabled

---

### Security Hardening

#### Authentication Modes

| Mode | When to use | Config |
|------|-------------|--------|
| `none` | Loopback only (default, safe for localhost) | Default |
| `token` | Any non-localhost exposure | `OPENCLAW_GATEWAY_TOKEN=<32+ chars>` |
| `password` | Alternative to token | `OPENCLAW_GATEWAY_PASSWORD=<strong>` |
| `trusted-proxy` | Behind nginx/Caddy | `gateway.auth.mode: "trusted-proxy"` |

**Generate a secure token:**

```bash
openssl rand -hex 32
```

**Auth rate limiting** (prevents brute force):

```json
{
  "gateway": {
    "auth": {
      "rateLimit": {
        "maxAttempts": 10,
        "windowMs": 60000,
        "lockoutMs": 300000
      }
    }
  }
}
```

#### Network Binding

```json
{
  "gateway": {
    "bind": "loopback"
  }
}
```

Options:
- `"loopback"` — 127.0.0.1 only (default, most secure)
- `"lan"` — local network (for Fly.io/Docker containers)
- `"tailnet"` — Tailscale network only
- `"auto"` — auto-detect
- `"custom"` — specify `customBindHost`

**For Fly.io deployments**: Use `"lan"` since Docker networking requires it. Fly.io handles external access control.

#### Security Audit

```bash
# Quick check
openclaw security audit

# Deep check (includes gateway connection probe + filesystem)
openclaw security audit --deep
```

Checks for: insecure config flags, dangerous tool policies, file permissions, external content policies, channel DM policy settings.

**Run weekly** on all client instances.

#### Security Hardening Checklist for Client Deployments

1. Set `gateway.bind` to `loopback` or `lan` (never `public` without auth)
2. Set `OPENCLAW_GATEWAY_TOKEN` with 32+ random characters
3. Enable auth rate limiting
4. Disable `gateway.controlUi.allowInsecureAuth`
5. Deny dangerous tools (`exec`, `browser_navigate`) unless needed
6. Set session pruning (`maintenance.pruneAfter: "30d"`)
7. Run `openclaw security audit --deep` weekly
8. Use environment variables for all secrets (never commit to config files)
9. Enable Tailscale for remote access (avoids exposing ports publicly)

---

### Health Monitoring & Diagnostics

#### Diagnostic Commands

```bash
# Full health check + repair
openclaw doctor

# Quick gateway probe
openclaw health

# Channel connection status
openclaw channels status --probe

# Deep status with health probes
openclaw channels status --deep

# Live log streaming
openclaw logs --follow

# Channel-specific logs
openclaw channels logs --channel whatsapp

# Security audit
openclaw security audit --deep
```

#### Channel Health Monitoring

OpenClaw auto-monitors channel connections and restarts them if they go stale:

```json
{
  "gateway": {
    "channelHealth": {
      "checkIntervalMs": 300000,
      "staleEventThresholdMs": 1800000,
      "channelConnectGraceMs": 120000
    }
  }
}
```

- **checkIntervalMs**: How often to check (default: 5 min)
- **staleEventThresholdMs**: Flag as unhealthy after no events for 30 min
- **channelConnectGraceMs**: Grace period after startup (2 min) before checking

Auto-restart policy: max 10 restarts/hour with 2-cycle cooldown to prevent infinite loops.

#### Hooks for Monitoring

Enable built-in hooks for logging and alerting:

```json
{
  "hooks": {
    "internal": {
      "enabled": true,
      "entries": {
        "command-logger": { "enabled": true },
        "session-memory": { "enabled": true }
      }
    }
  }
}
```

- **command-logger**: Logs all commands to `~/.openclaw/logs/commands.log` (JSONL)
- **session-memory**: Auto-saves context on session reset to workspace memory files

#### Logging Configuration

```json
{
  "logging": {
    "level": "info",
    "file": "/var/log/openclaw.log",
    "consoleLevel": "info",
    "consoleStyle": "pretty",
    "redactSensitive": "tools",
    "redactPatterns": ["sk-.*"]
  }
}
```

**For production**: Set `redactSensitive: "tools"` to prevent API keys from appearing in logs. Add custom `redactPatterns` for any client-specific secrets.

#### OpenTelemetry (Enterprise)

For clients who need metrics, traces, and centralized logging:

```json
{
  "diagnostics": {
    "enabled": true,
    "otel": {
      "enabled": true,
      "endpoint": "http://otel-collector:4318",
      "serviceName": "openclaw-gateway",
      "sampleRate": 0.2,
      "traces": true,
      "metrics": true,
      "logs": true
    }
  }
}
```

Connects to any OpenTelemetry-compatible backend (Datadog, Grafana, etc.).

---

### Production Deployment Checklist

#### Per-Client Setup

- [ ] Fly.io app created with persistent volume
- [ ] `OPENCLAW_GATEWAY_TOKEN` set (32+ random chars)
- [ ] AI provider API key set as secret
- [ ] Channel token set as secret (Telegram/WhatsApp)
- [ ] System prompt configured
- [ ] Agent model set (Qwen 3.6 Plus default, or per Preset A/B/C/D)
- [ ] Memory enabled (all tiers)
- [ ] Session reset mode set to daily
- [ ] Session maintenance configured (30-day prune, 500 max entries)
- [ ] Message debouncing configured per channel
- [ ] Security audit passes clean
- [ ] Health check endpoint responds
- [ ] Channel status shows connected

#### Weekly Maintenance

- [ ] Check `fly logs` for errors across all clients
- [ ] Run `openclaw security audit --deep` on each instance
- [ ] Review AI API costs per client
- [ ] Check channel health (no stale connections)
- [ ] Apply OpenClaw updates if new version available

#### Monthly Review

- [ ] Client usage analytics (message volume, cost, response quality)
- [ ] Memory growth check (prune if needed)
- [ ] System prompt refinement based on common questions
- [ ] Client satisfaction check-in

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
- **Supabase** — centralized memory, conversation logging, cost tracking
- **Claude Code** — for writing system prompts, skills, and any code changes
- **WhatsApp Business API** — customer-facing messaging channel
- **Telegram** — internal channel for business owner/staff
- **Qwen 3.6 Plus** — default agent model (best tool calling, 1M context)
- **Claude Sonnet 4.6** — email drafting and premium writing tasks
- **Claude Haiku 4.5** — fallback model, proven reliable

---

## Critical Review & Risk Analysis

### What's strong about this plan

1. **Margins are real.** 94-98% gross margin at $16-65 cost to serve is genuinely exceptional. Even if costs double, you're still at 85%+.
2. **The value anchor works.** Comparing to a $1,200-1,400/mo admin hire is the right frame. $500/mo for 24/7 coverage is an easy sell.
3. **The build constraints are honest.** Gating cost drivers (model choice, session length) instead of features is the right call. It makes every tier good.
4. **OpenClaw does the hard work.** You're not building AI infrastructure — you're configuring it. That's a massive headstart.
5. **The skill library compounds.** Each client adds skills that help the next client. This is a genuine competitive moat over time.

### What's weak or missing

#### 1. You have zero paying clients

Everything in this plan is theoretical. The pricing, the margins, the model recommendations — none of it has been tested with a real client paying real money. The single biggest risk is that you spend months perfecting the plan and never sell anything.

**Fix:** Stop planning. Get one client this week. Offer a free 2-week trial. Learn what breaks.

#### 2. WhatsApp Business API is not trivial to set up

The plan treats WhatsApp Business API as "apply and connect." In reality:
- Meta's approval process takes days to weeks
- You need a verified Facebook Business account
- The client needs to verify their business (ABN, domain, etc.)
- Message templates require approval for proactive outbound
- Pricing is per-conversation, not per-message, with 24hr conversation windows
- Personal WhatsApp pairing (what you did) doesn't scale — each client needs their own Business API setup

**Fix:** Start every client on website chat widget (zero friction, zero cost, zero approval process). Add WhatsApp Business only when the client specifically needs it and is willing to go through Meta's process.

#### 3. Qwen 3.6 Plus is unproven in your stack

The benchmark data is compelling (MCPMark #1, 96.5% function calling), but you haven't tested it with OpenClaw in production. Benchmarks don't capture:
- How it handles OpenClaw's specific tool schemas
- Latency from Australia to Qwen's API endpoints
- Rate limits and reliability under sustained load
- Edge cases in system prompt following

**Fix:** Before recommending Qwen as default, run it as your personal agent for 2 weeks. Track tool call success rate, latency, and failures. Have Haiku as the proven fallback. Don't switch a client's model without testing it yourself first.

#### 4. Single point of failure: you

This plan has you doing sales, setup, prompt engineering, monitoring, support, billing, and client management. At 5 clients, that's manageable. At 15, you're drowning.

**Fix:** The plan mentions hiring at Phase 3 (15-30 clients). That's too late. At 10 clients you'll be spending 10-20 hours/month on support alone. Plan to either:
- Automate monitoring and alerting early (Supabase cost alerts, health check scripts)
- Hire a part-time technical assistant at 8-10 clients
- Limit yourself to 10 clients until you have help

#### 5. OpenClaw is someone else's project

You're building a business on top of an open source project you don't control. Risks:
- **Breaking changes**: An OpenClaw update could break your client deployments
- **Abandonment**: If the project loses its maintainers, you're stuck
- **Licensing change**: MIT today doesn't mean MIT forever (though this is rare)
- **Feature gaps**: If you need something OpenClaw doesn't do, you either wait or fork

**Mitigations already in place:** Docker pins to a known version, `npm install -g openclaw@2026.4.9`. You can test updates before rolling out. But this is still a structural dependency.

**Fix:** Pin OpenClaw versions in your Dockerfile. Test every update on your own instance before deploying to clients. Keep a "known good version" and only upgrade when there's a reason.

#### 6. Churn risk is high for service businesses

SMBs churn. A dental practice that pays $500/mo for 6 months then decides "we don't really use it" is normal. At 95% margin, churn hurts revenue more than it hurts costs — but it still hurts.

**Fix:**
- Make the agent indispensable in the first 30 days (appointment reminders, follow-ups — things they'll miss when they leave)
- Track and share value delivered: "Your agent handled 347 enquiries this month, saving an estimated 12 hours of admin time"
- Quarterly business reviews showing ROI
- Annual contracts with a small discount (10%) for commitment

#### 7. Compliance liability is underestimated

The Talbot Advisory section mentions AFSL compliance, but who's actually responsible if the agent says something it shouldn't? If a financial planning bot accidentally gives specific advice, the client is liable — but they'll blame you. If a medical bot gives diagnostic information, same problem.

**Fix:**
- Terms of service that clearly state Pelican AI is not responsible for agent output
- Professional indemnity insurance (look into it before taking regulated clients)
- Compliance testing in the onboarding process (send 50 adversarial prompts that try to extract specific advice)
- Monthly compliance spot-checks for regulated clients

#### 8. No competitive moat beyond execution speed

If this works, someone with more resources can copy it. OpenClaw is open source, Fly.io is public, the model recommendations are public knowledge. What stops a larger agency from doing this?

**Moat candidates:**
- **Skill library** (grows over time, hard to replicate)
- **Vertical expertise** (deep knowledge of dental practices, financial planning, etc.)
- **Client relationships** (trust is earned, not copied)
- **Speed** (you're here first, in this market, with these clients)

None of these are defensible in the traditional sense. This is a service business — the moat is always execution, not technology.

#### 9. The plan doesn't address sales

How do you actually get clients? The plan says "find first client" and "pitch the 2-week trial." But:
- Where do you find them? (Cold outreach? Referrals? LinkedIn? Local networking?)
- What's the sales cycle? (SMBs are notoriously slow to buy)
- What's your conversion rate assumption?
- How many conversations does it take to get one client?

**Fix:** Add a concrete go-to-market section:
- Target: businesses you personally know or can get a warm intro to
- Channel: LinkedIn DMs, local business meetups, existing network
- Pitch: "I'll build you an AI assistant for free for 2 weeks. If it saves you time, $500/mo."
- Volume: Talk to 20 businesses to get 3-5 trials to get 1-2 paying clients
- Timeline: First paying client within 4 weeks

#### 10. Supabase adds complexity you may not need yet

The plan includes a full Supabase schema (memory, conversation logging, cost tracking, client config) — but for your first 3-5 clients, OpenClaw's built-in memory and Fly.io logs might be enough. Adding Supabase is more infrastructure to manage, more things to break, and more setup time per client.

**Fix:** Defer Supabase until you have 5+ clients or until you specifically need cross-client analytics. OpenClaw's built-in memory is "always on" in your config already. Use `fly logs` for monitoring. Add Supabase when the pain of not having it outweighs the effort of setting it up.

### Honest Assessment

This is a well-researched, technically thorough plan with strong fundamentals. The pricing is anchored correctly, the architecture is sound, the cost model is favourable, and the technical detail is deep.

**But it's a plan, not a business.** The gap between this document and revenue is: one client saying yes, paying you money, and getting value from the agent you build them. Everything else is speculative until that happens.

**Priority order:**
1. Get one paying client (this week)
2. Deploy on Fly.io (validated, not on a flaky droplet)
3. Prove the value (track hours saved, enquiries handled)
4. Get a second client via referral
5. Then refine the plan based on what you actually learned
