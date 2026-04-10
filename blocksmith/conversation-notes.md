# OpenClaw + Blocksmith: Exploration & Integration Notes

**Date**: 2026-04-10
**Context**: Review of the OpenClaw codebase, exploration of personal AI assistant use cases, hands-on setup on DigitalOcean, and strategic thinking about integrating agentic features into Blocksmith.

---

## Part 1: OpenClaw Codebase Review

### What OpenClaw Is

OpenClaw is a **multi-channel AI gateway** — a platform (~1.47M lines of TypeScript across ~7,800 files) that bridges AI models (LLMs, TTS, image generation) to messaging channels (WhatsApp, Telegram, Discord, Slack, Signal, Matrix, Teams, and many more). It provides a unified CLI + gateway server with native apps for macOS, iOS, and Android.

### Architecture Overview

| Module | Role |
|--------|------|
| `src/entry.ts` / `src/index.ts` | CLI entry points with respawn/wrapper logic |
| `src/gateway/` (269 files) | WebSocket/HTTP gateway server — auth, sessions, chat, hooks, OpenAI-compatible API, control UI, agent lifecycle |
| `src/commands/` (308 files) | CLI command implementations — agents, config, channels, auth, send, onboard, browser, etc. |
| `src/cli/` | CLI wiring, argument parsing, profile management |
| `src/channels/` | Channel abstraction layer |
| `src/routing/` | Message routing between channels |
| `src/plugins/` + `src/plugin-sdk/` | Plugin SDK for extensions |
| `src/agents/` | AI agent orchestration, subagent dispatch |
| `src/media/`, `src/tts/`, `src/image-generation/` | Media pipeline — TTS, image gen, media understanding |
| `src/infra/` | Infrastructure utilities — errors, env, ports |
| `src/sessions/` | Session persistence and lifecycle |
| `src/config/` | Configuration management |
| `src/context-engine/` | Context/memory for conversations |
| `src/cron/` | Scheduled tasks |
| `src/security/` | Security primitives |

### Extensions (82 total)

- **AI Providers (36)**: Anthropic, OpenAI, DeepSeek, Google, Groq, Mistral, Ollama, xAI, Amazon Bedrock, Nvidia, Together, HuggingFace, Perplexity, OpenRouter, and many more
- **Messaging Channels (21)**: Discord, Telegram, Slack, Matrix, MS Teams, IRC, Signal, BlueBubbles (iMessage), Feishu, Line, Nostr, Twitch, and more
- **Search & Web (5)**: Brave, DuckDuckGo, Exa, Firecrawl, Tavily
- **Speech & Media (5)**: Deepgram, ElevenLabs, Microsoft speech, voice-call
- **Memory (2)**: memory-core (file-backed), memory-lancedb (vector DB)
- **Tools & Infrastructure (11)**: device-pair, diagnostics, diffs, workflow tools, phone control, etc.

### Pre-Built Skills (51)

**Productivity**: Apple Notes, Apple Reminders, Bear, Notion, Obsidian, Things (Mac), Trello
**Google Workspace**: gog (Gmail, Calendar, Drive, Contacts, Sheets, Docs), Google Places
**Email**: himalaya (multi-provider IMAP/SMTP)
**Communication**: Discord, Slack, BlueBubbles (iMessage), WhatsApp (wacli), Twitter/X (xurl)
**Smart Home**: Philips Hue (openhue), Eight Sleep (eightctl), camera snap
**Media**: Spotify, Sonos, Bluesound, music recognition, Whisper (speech-to-text), TTS
**Dev Tools**: GitHub, GitHub Issues, coding agent, tmux
**Utilities**: weather, 1Password, PDF reader, video frames, GIF search, RSS monitoring, summarization
**Voice**: voice calls via Twilio/Telnyx/Plivo
**Platform**: clawhub (community skills), skill creator, MCP server integration, session logs, model usage tracking

### Strengths

1. Massive plugin ecosystem with well-defined SDK
2. Strong TypeScript typing throughout
3. Comprehensive test coverage (~2,080 test files in src/)
4. Modern tooling (Oxlint/Oxfmt, pnpm workspaces, pre-commit hooks)
5. Security-conscious (auth modes, rate limiting, role policies, secret detection)
6. Operational maturity (Docker, Fly.io, Sparkle appcast, CI/CD)

---

## Part 2: Personal AI Assistant Use Case

### Core Capabilities

**Memory System**: Two-tier — file-backed core memory (MEMORY.md) and vector-based LanceDB long-term memory with semantic recall. Categories: preference, decision, entity, fact. Auto-capture and auto-recall built in. Deduplication prevents redundancy.

**Scheduling**: Three modes — "at" (one-time), "every" (interval), "cron" (cron expressions with timezone). Results delivered to messaging channels, webhooks, or silently.

**Multi-Channel**: Same AI, same memory, across WhatsApp, iMessage, Telegram, Signal, Slack, Discord, Matrix, Teams, or CLI.

**Browser Automation**: Full Playwright-based browser control — navigate, click, type, scroll, cookie persistence, page snapshots. Can interact with any website including authenticated sessions.

**Agents**: Subagent spawning with depth limits, model fallback, auth profile rotation, session isolation, and sandbox support.

### Google Calendar & Gmail

Fully supported via the `gog` skill (Google Workspace CLI with OAuth):
- Gmail: search, read, send, reply, draft, multi-account
- Calendar: list events, create, update, event colors
- Also: Google Drive, Sheets, Docs, Contacts
- Real-time Gmail watcher via Google Pub/Sub webhooks

### LinkedIn

Not supported as a dedicated integration. Could be accessed via browser automation but would violate LinkedIn's Terms of Service and risk account restrictions.

### What a Day Could Look Like

```
8:00am  -> Scheduled briefing arrives in WhatsApp:
           "Here's your day: 3 meetings, rain at 2pm,
            your Notion task list has 4 overdue items."

10:30am -> You message: "remind me to call Sarah at 3pm"
           -> Cron job created, fires at 3pm to your phone

2:00pm  -> "What did we decide about the Q2 budget?"
           -> Memory recall finds your conversation from last week

4:00pm  -> "Summarize this PDF" [attach file]
           -> nano-pdf skill + AI returns summary

Evening -> "Add 'buy milk' to my reminders"
           -> Apple Reminders skill creates it
```

---

## Part 3: Setup on DigitalOcean

### Why a VM Instead of Local Laptop

- Corporate Mac without admin/sudo rights
- Gateway needs to run 24/7 for messaging channels to stay connected
- Closing laptop kills the gateway process
- $6/mo DigitalOcean droplet solves all of this

### Setup Steps Taken

1. Created DigitalOcean droplet (Ubuntu 24.04, 1GB RAM)
2. SSH in: `ssh root@209.38.18.89`
3. Installed nvm + Node 22:
   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
   export NVM_DIR="$HOME/.nvm"
   [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
   nvm install 22
   ```
4. Installed OpenClaw: `npm install -g openclaw`
5. Ran `openclaw onboard` (Quick Start)
6. Set up WhatsApp channel (linked to +61420907584)
7. AI provider: Anthropic Claude Sonnet 4.6

### Keeping the Gateway Running

The gateway must stay running for WhatsApp to work. SSH disconnecting kills foreground processes.

**Solution — nohup (background process)**:
```bash
nohup openclaw gateway run --bind loopback --port 18789 > /tmp/openclaw-gateway.log 2>&1 &
```

**Alternative — tmux (persistent terminal session)**:
```bash
tmux new -s openclaw
openclaw gateway run --bind loopback --port 18789
# Ctrl+B then D to detach
```

Check logs: `tail -20 /tmp/openclaw-gateway.log`

### Accessing the Control UI

The web UI runs on localhost on the server. To access from laptop:

```bash
# Open SSH tunnel from laptop
ssh -L 18789:127.0.0.1:18789 root@209.38.18.89

# Then open in browser
http://127.0.0.1:18789
```

### Key Lessons

- `nvm` installs Node without sudo — works on managed Macs
- The `openclaw onboard` Quick Start is the right choice for first setup
- WhatsApp uses personal QR pairing — other people message your number, AI responds
- You can't message yourself on WhatsApp to test — need a second account
- Telegram is better for personal use (you message a bot directly)
- Gateway must run persistently — use nohup or tmux
- SSH tunnel needed to access Control UI from laptop

---

## Part 4: Scaling Strategy for Blocksmith

### Key Insight: Take the Learnings, Not the Code

OpenClaw is designed as **one instance per user, self-hosted**. For a SaaS product serving thousands of users, this doesn't scale. Instead, apply the patterns to Blocksmith's existing architecture.

| OpenClaw's design | What Blocksmith needs |
|---|---|
| One WhatsApp connection per instance (personal QR pairing) | WhatsApp Business API (one number, thousands of conversations) |
| One gateway process per user | Multi-tenant Flask backend handling all users |
| Config files on disk | Per-user config in Supabase (already exists) |
| Memory stored locally | Per-user memory rows in Supabase with pgvector |
| Self-hosted by each user | Hosted centrally on Render |

### Integration Levels

**Level 1 — Custom OpenClaw Skill (personal use)**
Build a `blocksmith` skill that queries Supabase for training data. Ask "What's my training today?" via WhatsApp and get your sessions.

**Level 2 — Cron-Powered Coaching (personal use)**
Morning briefings, workout reminders, weekly summaries — all delivered to WhatsApp on a schedule.

**Level 3 — Memory-Powered Coaching (personal + product)**
Store user preferences, injuries, equipment, performance data. AI recalls context across conversations. "My knee was sore" on Monday leads to automatic substitutions on Tuesday.

**Level 4 — Agent-Driven Block Generation (product)**
Conversational intake instead of forms. Chat-driven regeneration. Multi-agent orchestration for complex tasks.

### Architecture for Scale

```
Users (WhatsApp / Web Chat / future: Telegram)
    |
    v
Blocksmith API (Flask on Render)
    |-- /webhooks/whatsapp    <-- Meta Cloud API webhooks
    |-- /api/chat             <-- Web chat interface
    |
    |-- Intent Router
    |   |-- "What's my training?" -> query sessions
    |   |-- "Done with X"         -> log workout
    |   |-- "Generate a block"    -> start pipeline
    |   |-- general chat          -> AI with user context
    |
    |-- Memory Layer (Supabase + pgvector)
    |-- Scheduler (daily briefings, reminders)
    |-- Generation Pipeline (existing code)
    |
    v
Supabase (users, blocks, workouts, memory)
```

### One Agent, Multiple Interfaces

Build a `BlocksmithCoach` class — single AI brain that handles all user interaction:

```python
class BlocksmithCoach:
    def __init__(self, user_id: str):
        self.user_id = user_id
        self.memory = UserMemory(user_id)
        self.blocks = UserBlocks(user_id)
        self.workouts = WorkoutTracker(user_id)

    async def handle_message(self, message: str) -> str:
        context = await self.build_context()
        response = await ai_client.messages.create(
            model="claude-sonnet-4-6",
            system=COACH_SYSTEM_PROMPT,
            messages=[*context.conversation_history, {"role": "user", "content": message}],
            tools=self.get_tools()
        )
        await self.memory.extract_and_store(message, response)
        return response
```

Both web chat and WhatsApp call the same agent:

```python
# Web chat
@app.route('/api/chat', methods=['POST'])
async def web_chat():
    user_id = get_authenticated_user()
    coach = BlocksmithCoach(user_id)
    reply = await coach.handle_message(request.json['message'])
    return jsonify({"reply": reply})

# WhatsApp webhook
@app.route('/webhooks/whatsapp', methods=['POST'])
async def whatsapp_webhook():
    phone = extract_phone(request.json)
    user_id = lookup_user_by_phone(phone)
    coach = BlocksmithCoach(user_id)
    reply = await coach.handle_message(extract_message(request.json))
    send_whatsapp_reply(phone, reply)
    return "ok"
```

### Agent Tools

| Tool | What it does |
|---|---|
| `get_todays_sessions` | Pull today's workouts from active block |
| `get_week_summary` | Sessions done/remaining this week |
| `log_workout` | Mark session completed/modified/skipped |
| `get_block_progress` | Completion rate, mileage totals |
| `search_memory` | Recall user preferences, injuries, past feedback |
| `store_memory` | Save new preference/injury/equipment note |
| `regenerate_session` | Call existing regeneration pipeline |
| `generate_block` | Kick off new block generation |
| `get_race_countdown` | Days until target race |

---

## Part 5: Conversational Block Creation

### The Big Idea

Replace the form with an optional conversational intake. The agent asks questions one at a time, explains terms, adapts based on answers, and collects the same data the form does — but with a better user experience.

### Form vs Conversation

| Metric | Form only | Conversational |
|---|---|---|
| Completion rate | Users bounce on complex fields | Agent guides them through |
| Time to first block | 5-10 min filling form | 2-3 min chatting |
| Repeat blocks | Re-fill the form | "Same as last time but..." |
| User knowledge required | Must understand all terms | Agent explains as needed |
| Data quality | Users guess at unknown fields | Agent validates and estimates |
| Retention | Transactional | Relationship |

### Example Conversation

```
Agent: What's your HYROX goal for this block? Building a base,
       peaking for a race, or somewhere in between?

User:  I've got a race in 9 weeks

Agent: Got it — 9 weeks out. When's the race exactly?

User:  June 14th in London

Agent: London Pro or Open?

User:  Open, men's

Agent: 152kg sled push, 103kg pull, 6kg wall ball.
       What days can you train? Any double session days?

User:  Mon to Fri, double up on Wednesday

Agent: Do you know your max HR and threshold pace?
       If not I can estimate from your last race time.

User:  I ran 1:28 at Manchester last month

Agent: Based on that — threshold pace around 4:45/km,
       max HR around 185. Sound right?

User:  HR max is 188

Agent: Any injuries or equipment limitations?

User:  No sled, no SkiErg. Good gym and a rower.

Agent: I'll sub sled work with heavy prowler pushes or
       incline treadmill, SkiErg with the rower.
       Ready to generate?

User:  Yeah let's go
```

### Technical Implementation

The agent collects info conversationally then calls `generate_block` with a structured payload — same input the existing `generator_modular.py` already accepts. No changes to the generation pipeline needed.

### Memory Advantage for Repeat Users

Second block creation:

```
Agent: Want a new block? Here's your profile from last time:

       Men's Open, HR max 188, threshold 4:45/km
       Mon-Fri + optional Saturday, double Wednesday
       No sled or SkiErg, gym + rower

       What's changed?

User:  Same setup but I bought a SkiErg

Agent: Nice. Same race target or new goal?

User:  Building base, no race planned

Agent: 8-week base build with deload, SkiErg included.
       Generating...
```

30 seconds instead of re-filling a 15-field form.

### Both Options Coexist

```
+----------------------------------+
|  Create a Training Block         |
|                                  |
|  +------------+ +-------------+  |
|  | Chat       | | Form        |  |
|  | with Coach | | Quick fill  |  |
|  +------------+ +-------------+  |
|                                  |
|  Chat: Tell me your goals and    |
|  I'll build your block.          |
|                                  |
|  Form: Already know what you     |
|  want? Fill in the details.      |
+----------------------------------+
```

Both paths produce the same config object, same generation pipeline, same output.

---

## Part 6: Recommended Build Order

1. **Agent core** — `BlocksmithCoach` class with tools calling existing Supabase queries
2. **Web chat** — chat widget on the Blocksmith dashboard, calls `/api/chat`
3. **Memory table** — Supabase table with pgvector for storing/recalling user context
4. **Conversational intake** — alternative to the form for block creation
5. **WhatsApp Business API** — webhook route, same agent, scales to thousands
6. **Scheduled messages** — morning briefings, workout reminders, weekly summaries
7. **Conversational block generation** — full chat-driven pipeline trigger

Steps 1-2 could ship in a week. Steps 3-4 in another week. WhatsApp (step 5) is the growth channel that unlocks scale.

---

## Summary

- **OpenClaw for personal use**: Running on DigitalOcean at 209.38.18.89, WhatsApp connected, Claude Sonnet 4.6 as agent model. Works today as a personal AI assistant.
- **Blocksmith integration strategy**: Don't embed OpenClaw into Blocksmith. Take the patterns (conversational AI, memory, scheduling, multi-channel) and build them natively into Blocksmith's Flask/Supabase stack.
- **Key product insight**: The form is a tool. The conversation is a coach. That's the difference between a utility and a product people come back to.
- **Technical path**: One `BlocksmithCoach` agent class, multiple interfaces (web chat + WhatsApp), shared memory in Supabase, same generation pipeline underneath.
