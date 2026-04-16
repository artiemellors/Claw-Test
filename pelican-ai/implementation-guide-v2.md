# Pelican AI — Implementation Guide v2

**Date**: 2026-04-13
**Status**: Revised — addresses channel strategy, customer touchpoints, and end-to-end implementation.

---

## The Core Problem With v1

Telegram doesn't work for customers. Patients won't download Telegram to book a skin check. Financial planning prospects won't install an app to enquire about super. The channel strategy must meet customers where they already are.

## Channel Strategy (Revised)

| Audience | Channel | Why |
|----------|---------|-----|
| **Business owner/staff** (internal) | Telegram bot | Free, instant, they install once |
| **Their customers** (external) | WhatsApp Business API | Everyone has WhatsApp |
| **Their customers** (alternative) | Website chat widget | No app install needed |
| **Their customers** (future) | SMS via Twilio | Universal reach, no app needed |

**Phase 1**: Business owner uses Telegram to interact with their agent (check emails, get briefings, manage bookings).
**Phase 2**: Customers interact via WhatsApp Business API or website chat widget.
**Phase 3**: SMS for appointment reminders and follow-ups.

---

## Client 1: Rural Skin Cancer Service

### Business Profile

- **What**: Mobile skin cancer clinic, 14 regional SA towns
- **Model**: Outreach — periodic visits, not permanent clinics
- **Team**: Doctors + nurses
- **Contact**: 1300 584 648 / admin@ruralskin.au
- **Booking**: Website form + phone
- **Social**: Instagram + Facebook
- **Pain**: Limited admin hours, phone-based, responds "within a week"

### The Real Customer Journey (Current)

```
Patient notices a mole
    |
    v
Googles "skin check near me" or "rural skin cancer SA"
    |
    v
Lands on ruralskin.au
    |
    v
Clicks "Book Now" or calls 1300 584 648
    |
    v
Gets voicemail (limited hours) OR fills out online form
    |
    v
Waits up to ONE WEEK for a response
    |
    v
Gets booked, or added to waiting list
    |
    v
Appointment day: pays on arrival, gets checked
    |
    v
Nurse assessment: waits up to 2 WEEKS for emailed results
    |
    v
... silence until next year (if they remember to re-book)
```

**Drop-off points**: The week-long wait for a booking response. The 2-week wait for results. No follow-up for annual re-checks. No waiting list updates.

### The Customer Journey With Pelican AI

```
Patient notices a mole
    |
    v
Googles, lands on ruralskin.au
    |
    v
Sees "Chat with us on WhatsApp" or website chat widget
    |
    v
INSTANT response:
    "Hi! I can help you book a skin check.
     Which town is closest to you?"
    |
    v
Bot collects: name, phone, nearest town, preferred date
Bot checks schedule, confirms booking or adds to waiting list
    |
    v
24hrs before appointment: WhatsApp reminder
    "Hi [Name], reminder: skin check tomorrow at 10am
     at Port Pirie Regional Health Service.
     Please wear loose clothing. Payment of $150 on arrival."
    |
    v
Appointment happens
    |
    v
Results arrive by email (existing process)
    |
    v
11 months later: WhatsApp message
    "Hi [Name], it's been almost a year since your last
     skin check. Would you like to book your annual check?
     We're visiting [Town] on [Date]."
```

### What Pelican AI Actually Builds

#### For Patients (External Channels)

**Channel 1: WhatsApp Business API**

- Patients message the Rural Skin WhatsApp number
- Instant FAQ responses (pricing, Medicare rebates, what to expect)
- Booking request collection (name, phone, town, appointment type)
- Appointment reminders (24hr before)
- Annual re-check reminders (11 months after last visit)
- Waiting list notifications when spots open

**Channel 2: Website Chat Widget**

- Embedded on ruralskin.au (replaces or supplements the contact form)
- Same agent, same knowledge, different interface
- Patients who don't want to use WhatsApp can chat on the website
- Captures leads that would otherwise bounce

**How to set up WhatsApp Business API:**

1. Rural Skin registers on Meta Business Suite (business.facebook.com)
2. Verify the business (ABN, website)
3. Apply for WhatsApp Business API access
4. Get a dedicated WhatsApp number (can be 1300 584 648 or a new number)
5. Connect to OpenClaw via the WhatsApp Business extension
6. Meta charges ~$0.05/conversation (first 1,000/month free)

**How to set up website chat:**

OpenClaw has a built-in web provider. Embed a chat widget on ruralskin.au:

1. Configure the web channel in OpenClaw
2. Add a JavaScript snippet to the Rural Skin website
3. Widget appears as a chat bubble on every page
4. Same agent handles web chat and WhatsApp

#### For the Business (Internal Channel)

**Channel: Telegram (staff only)**

The admin team uses Telegram to interact with the agent:

```
Admin: "How many bookings do we have for Port Pirie next week?"
Agent: "12 confirmed, 3 on the waiting list. 2 slots remaining."

Admin: "Move Sarah Chen from waiting list to the 2pm slot"
Agent: "Done. I'll send Sarah a WhatsApp confirmation."

Admin: "What questions have patients been asking this week?"
Agent: "Top 3: Medicare rebate amounts (23 times),
        next visit to Berri (18 times), 
        workplace screening process (7 times)"
```

### Agent Architecture

```
Rural Skin OpenClaw Instance
    |
    |-- Agent: Patient Reception (Haiku)
    |   |-- WhatsApp Business API (patient-facing)
    |   |-- Website chat widget (patient-facing)
    |   |-- Handles: bookings, FAQs, reminders, waiting list
    |
    |-- Agent: Admin Assistant (Haiku)
    |   |-- Telegram (staff-facing)
    |   |-- Handles: booking queries, schedule management,
    |   |   weekly summaries, email triage
    |
    |-- Cron Jobs:
        |-- Daily: appointment reminders (WhatsApp to patients)
        |-- Weekly: admin summary to Telegram
        |-- Monthly: waiting list cleanup
        |-- Annual: re-check reminders (11 months post-visit)
```

### System Prompt: Patient Reception Agent

```
You are the booking assistant for Rural Skin Cancer Service.
Rural Skin is a mobile skin cancer clinic that visits 14 regional
South Australian towns on a rotating schedule.

YOUR JOB:
- Help patients book skin check appointments
- Answer questions about services, pricing, and what to expect
- Add patients to the waiting list when appointments are full
- Provide location and schedule information

SERVICES & PRICING:
- Nurse skin check: $150 (no Medicare rebate)
- Doctor skin check: $150 total ($42.85 Medicare rebate, $107.15 gap)
- Doctor + cryotherapy: $195 total ($84.90 rebate, $107.15 gap)
- Biopsy/excision: $100-$200 gap (Medicare covers remainder)
- No referral needed
- Payment on the day

LOCATIONS (14 towns):
Balaklava, Berri, Bordertown, Cleve, Cowell, Elliston, Kimba,
Naracoorte, Nuriootpa, Pinnaroo, Port Pirie, Quorn, Wudinna, Yorketown

WHAT TO TELL PATIENTS ABOUT SKIN CHECKS:
- Takes 20-30 minutes
- Full body exam including scalp, feet, between toes
- Wear loose, easy-to-remove clothing
- Dermatoscope used on suspicious lesions
- Results emailed within 2 weeks (nurse assessments reviewed by doctor)
- Recommended frequency: annually to every 3-4 years depending on risk
- First check recommended in your 20s

BOOKING FLOW:
1. Ask which town is closest to them
2. Check if appointments are available for that town
3. If available: collect name, phone number, preferred date, appointment type
4. If full: offer to add to waiting list (collect name, phone, preferred town)
5. Confirm details back to them

RULES:
- NEVER give medical advice or diagnose anything
- If asked a clinical question: "That's a great question for the doctor
  during your appointment. If you're concerned about something urgent,
  please see your GP."
- Be warm and reassuring — skin cancer screening can cause anxiety
- If asked about self-examination, refer to Cancer Council SA
- For workplace screening inquiries, collect business name, number
  of employees, and location — the team will follow up
- Contact for anything else: admin@ruralskin.au or 1300 584 648
```

### Data Requirements

To make this work, Rural Skin needs to provide:

| Data | Why | Format |
|------|-----|--------|
| Visit schedule per town | Bot tells patients when the next visit is | Spreadsheet or calendar |
| Available appointment slots | Bot checks availability in real-time | Booking system API or shared calendar |
| Pricing (done — from website) | FAQ responses | Already captured |
| Staff names (optional) | Personalise "you'll be seeing Dr X" | Simple list |
| Waiting list (current) | Bot manages additions | Spreadsheet or database |

**Critical question for discovery call**: What booking system do they use? If it's Cliniko, HotDoc, or similar — build a skill to check/create bookings via API. If it's manual (spreadsheet/phone) — the bot collects details and the admin confirms manually.

### Cost Estimate

| Component | Monthly cost |
|-----------|-------------|
| Fly.io hosting | $10 |
| Claude Haiku (patient reception) | $8-15 |
| Claude Haiku (admin assistant) | $3-5 |
| WhatsApp Business API | $5-20 (volume dependent) |
| Embedding (memory) | $1 |
| **Total** | **$27-51** |
| **You charge** | **$200-400/mo** |

### Implementation Timeline

| Week | What happens |
|------|-------------|
| **Week 0** | Discovery call with Rural Skin admin team |
| **Week 1** | Deploy Telegram bot for admin team (internal only) |
| **Week 2** | Admin team tests internally, refine prompts |
| **Week 3** | Set up WhatsApp Business API (Meta approval can take days) |
| **Week 4** | Launch patient-facing WhatsApp + website widget |
| **Week 5-6** | Monitor, refine, handle edge cases |
| **Week 7** | Review with client, agree on paid tier |

---
## Client 2: Talbot Advisory

### Business Profile

- **What**: Financial planning — super, insurance, retirement
- **Principal**: Damian Talbot (solo operator, 20 years experience)
- **License**: Corporate Authorised Rep under Synchron (AFSL 243313)
- **Location**: Level 6, 71 Queens Rd, Melbourne VIC 3004
- **Contact**: +61 401 601 118 / damian@talbotadvisory.com
- **Booking**: Website form ("let me know when works best, I'll confirm")
- **Content**: "News + Notes" blog section
- **Pain**: Solo operator — every hour on admin is an hour not with clients

### The Real Client Journey (Current)

```
Prospect hears about Damian (referral, Google, LinkedIn)
    -> Visits talbotadvisory.com
    -> Reads about page, maybe a blog post
    -> Clicks "Schedule an appointment"
    -> Fills out a form ("let me know when works best")
    -> Waits for Damian to respond (he's in meetings)
    -> Hours/days later: Damian emails back to confirm a time
    -> Free consultation happens
    -> If they proceed: Damian builds a financial plan
    -> Quarterly review... if Damian remembers to schedule it
    -> Annual review... if the client asks for one
```

**Drop-off points**: The wait between form submission and Damian's response (he's a solo operator in meetings all day). No automated follow-up. Quarterly reviews slip.

### The Client Journey With Pelican AI

```
Prospect visits talbotadvisory.com
    -> Website chat widget: "Hi, I can help you find out 
       if we're a good fit and book a free consultation."
    -> Bot qualifies the lead (goals, life stage, needs)
    -> Bot collects: name, email, phone, summary
    -> Bot books a consultation time
    -> Damian gets a Telegram notification with full brief
    -> Damian walks into the meeting fully prepared
    -> After consultation, bot sends welcome email
    -> Quarterly: bot sends review reminder + drafts agenda
    -> Annually: bot sends check-in + market update
```

### What Pelican AI Builds

**For Prospects**: Website chat widget (qualifies leads, books consultations, answers general questions). No app install needed.

**For Existing Clients**: WhatsApp Business for routine queries ("when's my next review?"). Damian can jump in personally when needed.

**For Damian**: Telegram bot for internal use (email drafting, weekly briefings, follow-up tracking).

**Why NOT public WhatsApp for prospects**: Financial planning is a trust-heavy, considered purchase. Website chat at the point of decision is more effective.

### Agent Architecture

```
Talbot Advisory OpenClaw Instance
    |
    |-- Agent: Lead Qualifier (Haiku)
    |   |-- Website chat widget (prospect-facing)
    |   |-- COMPLIANCE: Never gives financial advice
    |
    |-- Agent: Client Manager (Sonnet)
    |   |-- Telegram (Damian-facing)
    |   |-- WhatsApp Business (existing clients)
    |   |-- COMPLIANCE: All outbound reviewed by Damian
    |
    |-- Agent: Admin (Haiku, cron-driven)
    |   |-- Weekly briefings, review reminders, follow-up tracking
    |
    |-- Cron Jobs:
        |-- Monday 8am: weekly briefing
        |-- Quarterly: review reminders to existing clients
        |-- 5 days after proposal sent: follow-up reminder
        |-- Monthly: draft "News + Notes" content suggestion
```

### Compliance Framework (Non-Negotiable)

**1. No Specific Advice** — every agent prompt includes:

```
COMPLIANCE - CRITICAL:
- You are NOT a licensed financial adviser
- NEVER recommend specific products, funds, super funds, or insurance providers
- NEVER suggest specific asset allocations or contribution amounts
- NEVER predict returns or market performance
- If asked: "That's exactly what Damian can help with in a consultation."
```

**2. Execution Approvals** — all outbound comms approved by Damian:

```bash
openclaw config set approvals.exec.mode "always"
```

**3. AFSL Disclaimer** — in every formal communication.

**4. Complaint Detection** — hook flags messages containing: complaint, dispute, AFCA, ombudsman, unhappy, misleading, loss.

**5. Conversation Logging** — retained 7 years (ASIC requirement).

### Cost Estimate

| Component | Monthly cost |
|-----------|-------------|
| Fly.io hosting | $10 |
| Claude Haiku (lead qualifier + admin) | $7-13 |
| Claude Sonnet (client manager) | $15-25 |
| WhatsApp Business API (low volume) | $2-5 |
| **Total** | **$34-53** |
| **You charge** | **$300-500/mo** |

### Implementation Timeline

| Week | What happens |
|------|-------------|
| **Week 0** | Discovery call with Damian |
| **Week 1** | Deploy Telegram bot (Damian tests internally) |
| **Week 2** | Refine prompts, set up compliance guardrails |
| **Week 3** | Add website chat widget to talbotadvisory.com |
| **Week 4** | Monitor lead flow, refine qualification questions |
| **Week 5-6** | Add WhatsApp Business for existing clients |
| **Week 7** | Set up cron jobs: briefings, quarterly reminders |
| **Week 8** | Review with Damian, agree on paid tier |

---

## Discovery Call Template (Both Clients)

### Questions to Ask

**Understanding the business:**
1. Walk me through a typical day/week
2. How many customer inquiries per day/week?
3. What are the top 5 questions customers ask?
4. What do you wish you could automate tomorrow?

**Understanding the tools:**
5. What software do you use? (booking, CRM, email, accounting)
6. Does your booking system have an API?
7. What's your website built on? (matters for chat widget)
8. Do you use any automation already?

**Understanding the customer:**
9. How do customers find you?
10. What's the first thing they do when they reach out?
11. Where do you lose people in the process?
12. Do your customers use WhatsApp?

**Understanding the opportunity:**
13. How much time per week on admin/repetitive tasks?
14. What would you do with an extra 5 hours per week?
15. Have you tried chatbots or AI tools before?

### Red Flags (Walk Away)

- "I need it to replace my entire team" — expectations too high
- "Can it make decisions about patient care / financial advice?" — compliance risk
- "I don't have any budget" — can't sustain even a trial
- No clear pain point — curious, not motivated
- Customers are 70+ and don't use smartphones — channel problem

---

## Pricing Strategy (Revised)

### Lead With Value, Not Price

**Rural Skin**: "If this handles 50 booking inquiries per month that would otherwise wait a week, how many patients do you keep? At $150/appointment, keeping just 2 extra patients per month pays for the entire service."

**Talbot Advisory**: "If the bot qualifies leads while you're in meetings and books 2 extra consultations per month, and your average client value is $3,000+/year — one new client pays for the service for a year."

### Tier Structure

| Tier | What they get | Monthly |
|------|-------------|---------|
| **Starter** | Internal agent (Telegram for staff), FAQ knowledge, weekly summary | $200/mo |
| **Growth** | + customer-facing channel (WhatsApp or website chat), booking automation, reminders | $400/mo |
| **Professional** | + email management, multi-agent, memory, compliance logging | $600/mo |

Setup fee: $500 (covers discovery, configuration, prompt engineering, testing)

### Free Trial Structure

- 2 weeks internal only (Telegram for staff)
- Staff tests, gives feedback, you refine
- Then pitch the customer-facing tier
- "You've seen what it does for you — now let's put it in front of your customers"

---

## What Success Looks Like

### Rural Skin (after 3 months)
- 80% of FAQ queries handled without human intervention
- Booking requests captured instantly (not waiting a week)
- Waiting list managed automatically
- Annual re-check reminders driving return bookings
- Admin team spending 5+ fewer hours/week on phone/email

### Talbot Advisory (after 3 months)
- Every website visitor gets an instant response
- Leads qualified before Damian talks to them
- No leads lost to slow response times
- Quarterly reviews never missed
- 3+ hours/week saved on email drafting and admin
