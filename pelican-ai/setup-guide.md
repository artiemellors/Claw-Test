# Pelican AI — Setup Guide

Step-by-step guide to get Pelican AI fully operational. By the end, you'll have
your deployment repo on GitHub, Fly.io configured, and your first test agent
running.

---

## Prerequisites

You need:
- A GitHub account (you have this: github.com/artiemellors)
- A credit card (for Fly.io billing — you won't be charged until you deploy)
- An Anthropic API key (for Claude Haiku/Sonnet) — get one at console.anthropic.com
- Optional: a Qwen API key (for Qwen 3.6 Plus) — if testing Preset A
- 30-60 minutes

---

## Part 1: Create Your Private Repo

### Option A: From GitHub web UI

1. Go to https://github.com/new
2. Repository name: `agent-deployments`
3. Set to **Private**
4. Do NOT initialise with README (you already have files)
5. Click "Create repository"

### Option B: From terminal (if you prefer)

```bash
gh repo create agent-deployments --private --confirm
```

### Push the deployment files

The deployment folder is at `pelican-ai/deployment/` in this repo. Copy it to
your new repo:

```bash
cd ~

# Clone your new empty repo
git clone https://github.com/artiemellors/agent-deployments.git
cd agent-deployments

# Copy all deployment files
cp -r ~/Claw-Test/pelican-ai/deployment/* .
cp ~/Claw-Test/pelican-ai/deployment/.gitignore .

# Commit and push
git add .
git commit -m "Initial Pelican AI deployment setup"
git push
```

Your repo now has:
```
agent-deployments/
    CLAUDE.md
    README.md
    Dockerfile
    fly.toml
    .gitignore
    clients/.template/
    skills-shared/
    scripts/
```

---

## Part 2: Install Fly.io

### On your Mac

```bash
brew install flyctl
```

If brew doesn't work (corporate Mac without admin):

```bash
curl -L https://fly.io/install.sh | sh
```

### Create your Fly.io account

```bash
fly auth signup
```

This opens a browser. Sign up with your email, add a credit card.

### Verify it works

```bash
fly auth whoami
```

Should show your email.

---

## Part 3: Deploy Your Test Agent

This is YOUR agent — for testing, not a client. It validates the entire pipeline.

### Step 1: Create the Fly.io app

```bash
cd ~/agent-deployments
fly apps create agent-test
fly volumes create agent_data --size 1 --region syd --app agent-test
```

### Step 2: Set secrets

```bash
# Gateway token
fly secrets set OPENCLAW_GATEWAY_TOKEN=$(openssl rand -hex 32) --app agent-test

# AI provider (use Anthropic to start — proven reliable)
fly secrets set ANTHROPIC_API_KEY=sk-ant-your-key-here --app agent-test

# Telegram bot (create one via @BotFather first)
fly secrets set TELEGRAM_BOT_TOKEN=your-bot-token --app agent-test
```

### How to create a Telegram bot

1. Open Telegram on your phone
2. Search for @BotFather
3. Send `/newbot`
4. Name it "Pelican Test" (or anything)
5. Give it a username like `PelicanTestBot`
6. BotFather gives you a token — copy it
7. Use that token in the `fly secrets set` command above

### Step 3: Deploy

```bash
fly deploy --app agent-test --region syd
```

This takes 2-3 minutes. You'll see Docker building and deploying.

### Step 4: Configure the agent

```bash
fly ssh console --app agent-test
```

Inside the container:

```bash
# Set model
openclaw config set agent.model anthropic/claude-haiku-4-5

# Set a test system prompt
openclaw config set agent.systemPrompt "You are a helpful test assistant for Pelican AI. Be concise and friendly. If asked what you are, say you are a Pelican AI test agent."

# Enable memory
openclaw config set agents.defaults.memorySearch.enabled true

# Session management
openclaw config set session.reset.mode daily
openclaw config set session.maintenance.pruneAfter "30d"

# Debouncing
openclaw config set messages.inbound.debounceMs 2000

# Exit the container
exit
```

### Step 5: Restart and verify

```bash
fly apps restart agent-test
sleep 15
fly logs --app agent-test
```

You should see:
```
[gateway] ready
[telegram] Listening...
```

### Step 6: Test it

Open Telegram, find your bot (@PelicanTestBot or whatever you named it), send
"Hello". You should get a response.

If it works — congratulations, your deployment pipeline is validated.

---

## Part 4: Test Qwen 3.6 Plus (Optional but Recommended)

If you want to test Preset A (Qwen as default), get a Qwen API key and:

```bash
fly secrets set QWEN_API_KEY=your-qwen-key --app agent-test
fly ssh console --app agent-test
openclaw config set agent.model qwen/qwen-3.6-plus
exit
fly apps restart agent-test
```

Test for a few days. Compare tool calling reliability, latency, and response
quality to Haiku. If it's good, use Preset A for clients. If not, stick with
Preset B (Anthropic Only).

---

## Part 5: Migrate from DigitalOcean (Optional)

If you want to move your personal OpenClaw from the droplet to Fly.io:

### Step 1: Back up your droplet config

```bash
ssh root@209.38.18.89
cat ~/.openclaw/openclaw.json
# Copy the output — this is your config
```

### Step 2: Create your personal Fly.io app

```bash
fly apps create agent-artie
fly volumes create agent_data --size 1 --region syd --app agent-artie
fly secrets set ANTHROPIC_API_KEY=your-key --app agent-artie
fly secrets set OPENCLAW_GATEWAY_TOKEN=$(openssl rand -hex 32) --app agent-artie
fly deploy --app agent-artie --region syd
```

### Step 3: Configure with your existing settings

```bash
fly ssh console --app agent-artie
# Apply your config from the backup
# Set model, system prompt, channels, etc.
exit
fly apps restart agent-artie
```

### Step 4: Re-pair WhatsApp

WhatsApp pairing doesn't transfer — you'll need to pair again in the new
container. This means your WhatsApp will disconnect from the droplet and
connect to Fly.io.

```bash
fly ssh console --app agent-artie
openclaw channels add whatsapp
# Scan QR code
exit
```

### Step 5: Shut down the droplet

Once you've verified Fly.io is working:
- Destroy the DigitalOcean droplet to stop billing ($12/mo saved)
- Or keep it as a backup for a week, then destroy

---

## Part 6: Using Claude Code for Everything

Open Claude Code in your `agent-deployments` repo. The CLAUDE.md file teaches
it how to manage deployments.

### From terminal

```bash
cd ~/agent-deployments
claude
```

### From web (claude.ai/code)

Open a session, connect to your `agent-deployments` repo.

### Example commands

**Deploy a new client:**
```
"Set up a new client called Peak Physio. They're a physiotherapy
clinic in Brunswick, Melbourne. They use Cliniko for bookings.
Start with Starter tier, Preset A."
```

**Modify a client:**
```
"Update Rural Skin's system prompt — they've added a new location
in Clare. Next visit is May 15."
```

**Troubleshoot:**
```
"Talbot Advisory's agent isn't responding. Check logs and fix it."
```

**Write a skill:**
```
"Write a Cliniko booking skill that checks availability and
creates appointments."
```

**Update OpenClaw:**
```
"Update the Dockerfile to OpenClaw 2026.5.1 and deploy to
agent-test first."
```

Claude Code reads the CLAUDE.md, understands the deployment process, and
executes via the Fly.io CLI.

---

## Part 7: Deploy Your First Real Client

Once your test agent works:

1. Do the discovery call with your first client
2. Open Claude Code in your repo
3. Say: "Set up [client name]. Here's what I learned: [paste discovery notes]"
4. Claude Code creates the client folder, writes the prompt, deploys to Fly.io
5. Test it yourself with sample messages
6. Walk the client through it on a 15-minute call
7. Monitor for the first 2 weeks
8. Convert to paid

---

## Checklist

- [ ] GitHub repo `agent-deployments` created (private)
- [ ] Deployment files pushed
- [ ] Fly.io CLI installed (`fly auth whoami` works)
- [ ] Fly.io account created with billing
- [ ] Anthropic API key obtained
- [ ] Test Telegram bot created via @BotFather
- [ ] `agent-test` deployed and responding
- [ ] Tested Qwen 3.6 Plus (optional)
- [ ] Personal agent migrated from DigitalOcean (optional)
- [ ] Claude Code tested in the deployment repo
- [ ] First client identified
- [ ] Discovery call scheduled
