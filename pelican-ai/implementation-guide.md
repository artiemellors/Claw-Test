# Pelican AI — Implementation Guide for Test Clients

**Date**: 2026-04-13

---

## Client 1: Rural Skin Cancer Service

**Website**: ruralskin.au
**Business**: Mobile skin cancer clinic serving 14 regional South Australian towns
**Team**: Doctors + nurses doing outreach visits
**Contact**: 1300 584 648 / admin@ruralskin.au

### What They Do

- Skin checks ($150), biopsies, excisions, cryotherapy
- Nurse assessments with remote doctor review (results emailed within 2 weeks)
- Mobile workplace skin check programs
- Periodic visits to regional towns (not a permanent clinic)
- No referral required
- Payment on the day, partial Medicare rebates

### Their Pain Points (Likely)

1. **Booking management** — 14 towns, limited visit windows, waiting lists
2. **Phone volume** — 1300 number, patients calling to book/reschedule
3. **FAQs** — pricing, Medicare rebates, what to expect, preparation
4. **Follow-up** — reminding patients about results, annual re-checks
5. **Waiting list comms** — notifying people when spots open

### Pelican AI Solution

#### Agent: Reception Bot

**Channel**: Telegram bot (phase 1), WhatsApp Business (phase 2)

**Model**: Claude Haiku 4.5

**System Prompt**:

```
You are the booking assistant for Rural Skin Cancer Service,
a mobile skin cancer clinic serving regional South Australia.

Your role:
- Answer questions about services, pricing, and what to expect
- Help patients find their nearest clinic location and next visit date
- Collect booking requests (name, phone, preferred town, appointment type)
- Manage the waiting list (add people, confirm when spots open)
- Send appointment reminders

Services and pricing:
- Nurse skin check: $150 (no Medicare rebate)
- Doctor skin check: $150 total, $42.85 Medicare rebate, $107.15 gap
- Doctor skin check + cryotherapy: $195 total, $84.90 rebate, $107.15 gap
- Biopsy/excision: $100-$200 gap, Medicare covers remainder

Locations (14 towns):
Balaklava, Berri, Bordertown, Burra, Clare, Kadina, Kapunda,
Lameroo, Murray Bridge, Pinnaroo, Port Pirie, Renmark, Waikerie, Yorketown

Rules:
- Never give medical advice or diagnose
- If asked a clinical question, say "Please speak with your GP or call us on 1300 584 648"
- Be warm, professional, and reassuring (skin cancer screening can be anxiety-inducing)
- Confirm all booking details: name, phone, town, appointment type, preferred date
- Mention: no referral needed, payment on the day, wear loose clothing
- If fully booked, offer to add them to the waiting list
- Response time for email queries: within one week
```

#### Cron Jobs

```bash
# Appointment reminders (daily at 4pm)
openclaw cron add \
  --name "Appointment Reminders" \
  --cron "0 16 * * *" \
  --tz "Australia/Adelaide" \
  --agent main \
  --session isolated \
  --message "Check for tomorrow's appointments and send reminders to confirmed patients"

# Weekly waiting list update (Monday 9am)
openclaw cron add \
  --name "Waiting List Check" \
  --cron "0 9 * * 1" \
  --tz "Australia/Adelaide" \
  --agent main \
  --session isolated \
  --message "Check if any spots have opened up this week. Notify waiting list patients about availability."
```

#### What This Saves Them

| Current process | With Pelican AI |
|----------------|-----------------|
| Phone calls for every booking question | Bot handles 80% of FAQs instantly |
| Manual waiting list management | Automated waiting list + notifications |
| Patients unsure about pricing/rebates | Instant, accurate pricing info |
| Missed follow-up reminders | Automated appointment reminders |
| Admin time on repetitive emails | Bot handles routine queries |

#### Phase 2 Additions

- **Email triage agent** (Sonnet) — sorts admin@ruralskin.au inbox, drafts replies
- **Workplace program agent** — handles corporate skin check inquiries and scheduling
- **Results follow-up** — remind patients to book annual re-checks (12-month cron)
- **Integration with booking system** — if they use Cliniko or similar, build a custom skill

#### Pricing for Rural Skin

| Tier | What they get | Price |
|------|-------------|-------|
| **Phase 1 (Starter)** | Telegram reception bot, FAQ handling, booking requests | $150/mo |
| **Phase 2 (Professional)** | + email triage, appointment reminders, waiting list automation | $300/mo |
| **Phase 3 (Business)** | + workplace program agent, annual re-check reminders, booking system integration | $500/mo |

---

## Client 2: Talbot Advisory

**Website**: talbotadvisory.com
**Business**: Financial planning / advisory
**Principal**: Damian Talbot, 20 years institutional finance experience
**Contact**: +61 401 601 118 / damian@talbotadvisory.com
**Location**: Level 6, 71 Queens Rd, Melbourne VIC 3004
**License**: Corporate Authorised Representative under Synchron Advice Pty Ltd (AFSL 243313)

### What They Do

- Personalised financial planning
- Superannuation investment strategy
- Insurance plan structuring
- Serves clients across Australia at various life stages
- Free initial consultation
- Emphasis on incremental, long-term financial improvement

### Their Pain Points (Likely)

1. **Lead follow-up** — solo practitioner, leads go cold if not contacted quickly
2. **Scheduling** — managing consultation bookings manually
3. **Repetitive client questions** — "what's a super contribution cap?", "do I need income protection?"
4. **Content leverage** — has a "News + Notes" section but likely doesn't have time to promote it
5. **Client communication** — keeping existing clients updated on regulatory changes, review reminders

### Pelican AI Solution

#### Agent 1: Lead Qualifier

**Channel**: Telegram bot (linked from website or shared directly)

**Model**: Claude Haiku 4.5

**System Prompt**:

```
You are the first point of contact for Talbot Advisory,
a financial planning practice led by Damian Talbot in Melbourne.

Your role:
- Warmly greet potential clients
- Understand their financial situation at a high level
- Qualify leads by asking about their goals and timeline
- Offer to schedule a free consultation with Damian
- Answer general questions about financial planning (not specific advice)

Qualification questions (ask naturally, not as a checklist):
1. What's prompted you to look into financial planning?
2. Are you looking at superannuation, insurance, retirement planning, or general advice?
3. Roughly where are you in your career/life stage?
4. Have you worked with a financial planner before?
5. Would you like to schedule a free consultation with Damian?

About Talbot Advisory:
- Damian Talbot has 20 years experience in institutional finance and banking
- Corporate Authorised Representative under Synchron Advice Pty Ltd (AFSL 243313)
- Based in Melbourne but serves clients across Australia
- Initial consultation is free and no-obligation
- Focus on superannuation, insurance, and long-term financial wellness
- Philosophy: incremental change, not quick fixes

Rules:
- NEVER give specific financial advice (you are not licensed)
- NEVER recommend specific products, funds, or investments
- If asked for specific advice, say "That's exactly the kind of question
  Damian can help with in a consultation. Shall I schedule one?"
- Be professional, approachable, and confident
- Collect: name, email, phone, brief description of what they're looking for
- After qualifying, offer to book a consultation
```

**IMPORTANT compliance note**: Financial services in Australia are heavily regulated (AFSL). The agent must NEVER give specific financial advice. Every system prompt for financial services clients must include explicit guardrails against this.

#### Agent 2: Client Communication

**Model**: Claude Sonnet 4.6 (better writing quality for professional communications)

**System Prompt**:

```
You are Damian Talbot's communication assistant at Talbot Advisory.

Your role:
- Draft email responses to client queries
- Prepare review meeting agendas based on client history
- Draft newsletter content for the "News + Notes" section
- Send review reminders to existing clients

Writing style:
- Professional but warm
- Clear and jargon-free (explain financial terms simply)
- Reassuring and confident
- Match Damian's voice: "Leave the financial planning to me. Live your life."

Rules:
- NEVER include specific financial advice in any communication
- All drafts must be reviewed by Damian before sending
- Include AFSL disclaimer in all formal communications
- Flag any client communication that mentions complaints, disputes, or dissatisfaction
```

#### Cron Jobs

```bash
# Monday morning briefing
openclaw cron add \
  --name "Weekly Briefing" \
  --cron "0 8 * * 1" \
  --tz "Australia/Melbourne" \
  --agent admin \
  --session isolated \
  --message "Prepare Damian's weekly briefing: new leads this week, upcoming client reviews, any follow-ups needed, and a summary of market news relevant to clients."

# Quarterly review reminders (1st of each quarter)
openclaw cron add \
  --name "Quarterly Review Reminders" \
  --cron "0 9 1 1,4,7,10 *" \
  --tz "Australia/Melbourne" \
  --agent client-comms \
  --session isolated \
  --message "Draft quarterly review reminder emails for all active clients. Personalise each one with their last review date and any pending action items."
```

#### What This Saves Damian

| Current process | With Pelican AI |
|----------------|-----------------|
| Leads sit in inbox until he has time | Bot qualifies and responds instantly |
| Manual scheduling back-and-forth | Bot collects details and offers times |
| Writing client emails from scratch | Pre-drafted responses for review |
| Forgetting quarterly review follow-ups | Automated reminders |
| No time for content/marketing | Agent drafts newsletter content |

#### Compliance Considerations

Financial services agents need extra guardrails:

1. **No specific advice** — system prompt must explicitly prohibit product recommendations
2. **AFSL disclaimers** — all formal communications must include the disclaimer
3. **Record keeping** — all client interactions must be logged (Supabase conversation_log)
4. **Complaint detection** — hook that flags messages containing "complaint", "dispute", "unhappy", "AFCA"
5. **Damian reviews everything** — execution approvals enabled for all outbound communications

```bash
# Enable execution approvals (Damian must approve before agent sends anything)
openclaw config set approvals.exec.mode "always"
```

#### Pricing for Talbot Advisory

| Tier | What they get | Price |
|------|-------------|-------|
| **Phase 1 (Starter)** | Telegram lead qualifier bot, FAQ handling | $150/mo |
| **Phase 2 (Professional)** | + email drafting, weekly briefing, quarterly reminders | $300/mo |
| **Phase 3 (Business)** | + newsletter drafting, client comms, full compliance logging | $500/mo |

---

## Implementation Comparison

| Aspect | Rural Skin | Talbot Advisory |
|--------|-----------|-----------------|
| **Primary need** | Volume handling (many patients, repetitive Qs) | Lead capture + time savings (solo operator) |
| **Compliance risk** | Low (just don't give medical advice) | High (AFSL regulated, no financial advice) |
| **Channel** | Telegram then WhatsApp (patients prefer it) | Telegram then website chat |
| **Agents needed** | 1 (reception) expanding to 2-3 | 2 (lead qualifier + client comms) |
| **Memory** | Low priority (stateless interactions) | High priority (remember client context) |
| **Cron jobs** | Appointment reminders, waiting list | Weekly briefing, quarterly reviews |
| **Execution approvals** | Off (simple booking requests) | On (all outbound comms reviewed) |
| **Model** | Haiku only (simple Q&A) | Haiku (lead qual) + Sonnet (email drafts) |
| **Monthly AI cost** | ~$8-15 | ~$20-35 |
| **Start charging** | $150/mo | $150/mo |

---

## How to Pitch Each Client

### Rural Skin Pitch

"I can set up an AI assistant for Rural Skin that handles booking questions, pricing queries, and waiting list management — 24/7. Your admin team gets fewer phone calls, patients get instant answers, and nobody falls through the cracks. I'll set it up for free for 2 weeks so you can see the impact. If it works, $150/month."

### Talbot Advisory Pitch

"Damian, I can set up an AI assistant that qualifies leads the moment they reach out — it asks the right questions, collects their details, and offers to book a free consultation. You stop losing leads to slow response times, and you get a brief on each prospect before you even talk to them. I'll run a free 2-week trial. If it saves you time, $150/month."

---

## First Steps (This Week)

### For Rural Skin:
1. Contact admin@ruralskin.au or call 1300 584 648
2. Ask to speak with whoever manages bookings
3. Pitch the 2-week free trial
4. If yes: create Telegram bot, deploy to Fly.io, configure system prompt
5. Share bot link, walk them through it on a 15-min call

### For Talbot Advisory:
1. Contact Damian directly: damian@talbotadvisory.com or +61 401 601 118
2. Pitch the lead qualifier angle (he's a solo operator — time is his bottleneck)
3. If yes: create Telegram bot, deploy to Fly.io, configure with compliance guardrails
4. Demo the bot, emphasise that it never gives financial advice
5. Walk him through the weekly briefing feature

### For Both:
- Start with Telegram (free, instant, you control everything)
- One agent each to start (don't overcomplicate)
- 2-week free trial, then $150/mo
- Monitor logs daily during trial
- Refine system prompt based on real usage
- Upsell to Professional tier after 1-2 months
