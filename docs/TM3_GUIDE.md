# TM3 Guide — Staff Dashboard, Simulated Call, Data & Deploy

**You own:** `app/(staff)/**` · `app/call/**` · `supabase/**` · `scripts/**` · the Vercel project
**You ship:** the two screens judges spend the most time looking at, plus the seed data the entire demo depends on.

You and TM2 work in the same Next.js app at the same time. You never touch each other's directories. You import TM2's components from `components/ui/`; if you need one that doesn't exist, you ask them. **You do not add colours.** Read `docs/TM2_GUIDE.md` §1–2 before you start.

---

## 1. Day 0 — before anyone can build (do this tonight)

1. Create the Supabase project. Region: Mumbai or Singapore.
2. Run `supabase/schema.sql` in the SQL editor, top to bottom.
3. Confirm RLS is **on** for all seven tables with **no policies**. The anon key must be able to read nothing. Test it: hit the REST endpoint with the anon key and confirm you get an empty array, not data.
4. Put `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the team's shared vault and in Vercel's env vars. **The service role key never leaves the server.** It is not prefixed `NEXT_PUBLIC_`, it is not imported into a client component, and it is not pasted in the group chat.
5. Connect the repo to Vercel, deploy `main`, share the URL.

That URL is what you rehearse against. Not localhost. Demoing from localhost is how teams discover on stage that an env var was never set in production.

---

## 2. The simulated IVRS call — your differentiator

Most teams will demo a chatbot. You demo a phone call, using nothing but the browser.

The screen looks like a call in progress: number dialled, timer running, a waveform, a keypad, an end-call button. Behind it:

- **`window.speechSynthesis`** speaks the prompts. Free, built into every browser, supports `hi-IN`.
- **`window.SpeechRecognition`** (webkit-prefixed in Chrome) transcribes the caller. Free, decent on English, variable on Hindi.
- **The keypad** is DTMF — the 0–4 answers to the structured questions, and `0` for a human.

Label it **"Simulated IVRS — no telephony"** in small text on screen. Saying so costs nothing and buys credibility; being caught not saying so costs everything.

**Every call posts to the same `/api/checkin` as the chat, with `channel: 'call_sim'`.** That is the answer to "does voice and text feed the same model?" — you show one endpoint and one code path.

Two rules that matter more than the visuals:

- **Keypad `0` fires the crisis path instantly, client-side, before any network call.** It renders the resource panel and *then* posts. It must work with the API down.
- **Always offer a typed fallback.** `SpeechRecognition` is Chrome-only and fails on accents. A "type instead" input under the mic button means a failed recognition never kills the demo. Test the whole flow with the mic denied.

---

## 3. The staff dashboard

### `/staff` — the queue

Sorted: unacked CRITICAL, unacked RED, then everything by recency. Each row: pseudonym, `TierBadge`, composite, a change-point marker, time since, ack state, SLA countdown.

**Design for triage of mostly-fine cases, not deep investigation of each one.** At realistic base rates a counsellor works through roughly 100 reviews per 1,000 users per month, most of which are fine. If disposition takes three minutes, the system gets abandoned by week three. Target a **30-second path** from opening a case to dispositioning it, and time yourself doing it.

### `/staff/person/[id]` — the detail

Four things, in this order:

1. **Trend line.** Composite over time, one point per check-in, change points marked. This is the "dynamic" proof — it should be the first thing the eye lands on.
2. **Component breakdown.** Horizontal bars: S1, S2, S3, S4 weighted contributions. **This is the explainability feature.** Never render the composite without it.
3. **S5 acoustic**, greyed out, labelled: *"Low confidence. Not used in scoring — acoustic emotion inference is unreliable across dialects."* Showing it while refusing to score it is a stronger statement than hiding it.
4. **Transcript + case context**, with the S3 reasons listed as plain sentences: "Hearing in 6 days," "4th adjournment," "Relief 62 days overdue," "Accused released on bail," "Intimidation reported yesterday."

Then the disposition buttons: **Contacted · No action needed · Escalate**. A CRITICAL cannot be closed without one.

### Access

One passcode from `STAFF_PASSCODE`, checked server-side, set as an httpOnly cookie. No accounts, no email, no Supabase Auth. Five days.

Every queue view, person view, and ack writes an `audit_events` row. Add a small "Audit" tab showing the last 20 — it takes twenty minutes and it answers the compliance question visually.

---

## 4. Prompts

**Prompt 1 — seed the golden path** *(Day 1, before the dashboard)*

```
Read supabase/schema.sql and docs/00_MVP_PLAN.md section 7.

Write scripts/seed.ts (run with tsx) that is IDEMPOTENT — safe to run
repeatedly, wiping and re-inserting the demo data every time.

It seeds persona A-4471 exactly as in supabase/schema.sql's seed block, plus:
- two prior checkins and their assessments, composites 28 and 31, dated
  3 and 2 days ago, both tier GREEN, change_point false
- person.baseline_mean and baseline_var computed by actually calling
  lib/scoring/baseline.ts on those two values, NOT hardcoded — the demo
  must be reproducible from the real code path
- a live consent row
- 8 additional filler personas with varied tiers so the queue isn't empty

The third, spiking check-in is NOT seeded. It is created live during the
demo. Do not insert it.

Add `npm run seed`. Print the golden-path person's UUID at the end.
```

**Prompt 2 — dashboard**

```
Read docs/TM3_GUIDE.md section 3 and docs/SCORING_AND_POLICY.md section 2.

Build app/(staff)/layout.tsx with passcode gate: a form posting to
/api/staff/auth, compared server-side against STAFF_PASSCODE, setting an
httpOnly cookie. No Supabase Auth, no accounts.

Build app/(staff)/page.tsx — the queue, per TM3_GUIDE section 3, fetching
GET /api/staff/queue. Use QueueItem from types/contract.ts.

Build app/(staff)/person/[id]/page.tsx with, in order: recharts LineChart
of composite over time with change points marked; horizontal bar chart of
the weighted S1-S4 contributions; the S5 row greyed with its caveat text
verbatim from TM3_GUIDE section 3; transcript; case context with the S3
reasons as plain sentences; disposition buttons.

Use TM2's components from components/ui/ — Card, Button, TierBadge, Stat.
Do not create new components there and do not introduce any colour that
isn't already a token.

HARD RULE: never render a composite number anywhere without its component
breakdown beside it. Not in the queue row, not in a tooltip, nowhere.
```

**Prompt 3 — the simulated call**

```
Read docs/TM3_GUIDE.md section 2.

Build app/call/page.tsx: a phone-call UI — dialled number, running timer,
animated waveform, DTMF keypad 0-9, end-call button. Small persistent
label reading "Simulated IVRS — no telephony".

Flow, as an explicit state machine so it is unit-testable without a mic:
  consent_notice -> q1 -> q2 -> q3 -> open_question -> closing

- speechSynthesis speaks each prompt. Language from the toggle: hi-IN or en-IN.
- SpeechRecognition (with the webkit prefix fallback) captures the open
  answer. ALWAYS render a "type instead" text input underneath — mic
  permission denied or unsupported must not break the flow.
- Keypad 1-5 answers the structured questions as 0-4.
- Keypad 0, AT ANY STATE: immediately render the crisis panel client-side
  BEFORE any fetch, then POST. This must work with the network offline.
  Write a test asserting the panel renders with fetch mocked to reject.
- On completion POST to /api/checkin with channel: 'call_sim', the
  transcript, and the structured answers — the SAME endpoint the chat uses.

Feature-detect both Web Speech APIs and degrade to a fully typed flow if
either is missing. Test the entire path with the microphone denied.
```

---

## 5. Your checks

**Before every push:**
- [ ] Service role key not reachable from any client component; no `NEXT_PUBLIC_` on a secret
- [ ] RLS on, no policies, anon key returns nothing
- [ ] No composite rendered without its breakdown
- [ ] Keypad `0` works with the network disconnected — actually test it in devtools offline mode
- [ ] Call flow completes with the microphone denied
- [ ] `npm run seed` twice in a row leaves a clean database, not duplicates
- [ ] Every staff view writes an `audit_events` row
- [ ] No PII in any seed row

**Day 4, 18:00 — the fallback video.** This is your hard deadline and it does not move.

Screen-record, on the deployed Vercel URL, in one unbroken take:
`/call` → speak → hang up → `/staff` → the alert has appeared → open the person → trend line spikes, breakdown visible → disposition. Then a second short clip: typing a crisis phrase and the resources appearing instantly.

Put it on two laptops and a phone. When the venue Wi-Fi fails — and at some point it will — this is the difference between a recovered demo and a lost one.

**What Claude Code will try:**

| It will | Catch it by |
|---|---|
| Call Supabase from a client component with the anon key | RLS returns nothing; it'll then suggest adding a permissive policy. Refuse |
| Show composite in the queue with no breakdown | Breakdown or a tier badge alone. Never a naked number |
| Make keypad `0` await the API response | It must render locally first |
| Skip the typed fallback because "the mic works on my machine" | It works in Chrome on your laptop and nowhere else |
| Hardcode the baseline mean in the seed | It must come from the real scoring code, or the demo isn't reproducible |
| Add Supabase Auth "properly" | Five days. One passcode |
