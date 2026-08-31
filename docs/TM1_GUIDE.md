# TM1 Guide — Model, Safety, Scoring, Policy

**You own:** `types/contract.ts` · `lib/**` · `app/api/**` · `policy/**` · `evals/**`
**You also own:** unblocking TM2 and TM3. From Day 2 onward, review their PRs within 2 hours. A teammate blocked for half a day costs more than any feature you'd have written.

---

## 1. Answering your question about "training the model for free"

Nothing here needs gradient training, and that is a strength, not a compromise.

The problem statement mandates Explainable AI. A trained classifier gives you a number and no account of itself; you'd then have to build post-hoc explanation machinery you don't have five days for and can't defend under questioning. An additive composite of five named components (`docs/SCORING_AND_POLICY.md` §2) explains itself by construction — every alert shows what contributed and by how much.

So "developing the Policy" is **not** training. It is:

1. Authoring `policy/v1.yaml` by hand from the spec.
2. Running it against a labelled dev set and reading the confusion matrix.
3. Adjusting weights and thresholds in the YAML.
4. Re-running until it stops improving.
5. Running the held-out set once.

That's §6 of this guide, and it is a much better story on stage than "we fine-tuned a classifier on 1,100 rows" — which you can't do anyway, because your case spreadsheets have no distress labels and no time series.

**The LLM is not trained either.** It's a hosted model behind a fixed system prompt, doing one narrow job: acknowledge, ask one question, emit an S2 signal. You swap it by changing an env var.

**If you genuinely want a small classifier later:** Google Colab gives a free T4, Kaggle gives ~30 GPU-hours/week on a P100 or T4×2. Both are enough for a DistilBERT-size fine-tune. Do not do this in the five days. Mention it as future work.

---

## 2. Free inference — where to actually run the model

Verify current limits before you rely on them; providers cut quotas without notice.

| Provider | Card? | Reported limits | Use it for |
|---|---|---|---|
| **Groq** | No | <cite index="16-1">30 requests/min, 6,000 tokens/min, and 14,400 requests/day per organization, across all supported models</cite> | **Primary.** The daily ceiling is what lets you run an 80-item eval set repeatedly |
| **Google AI Studio (Gemini)** | No | Flash-tier free access; <cite index="8-1">quotas were cut 50–80% in December 2025</cite>, and reported figures vary by source and region — check AI Studio for your project | Good second provider for the comparison table |
| **OpenRouter** | No | <cite index="25-1">20 requests per minute, and 50 requests per day until you have bought $10 in credits, after which 1,000/day</cite> | Its OpenAI-compatible endpoint is the right shape for your adapter. **50/day is far too low to run evals on** |
| **Ollama, local** | — | Your laptop | Offline fallback if the venue Wi-Fi dies |

Two things that matter for this project specifically:

- **Groq also serves Whisper free** — <cite index="13-1">roughly 2,000 audio requests per day</cite>. If the browser's speech recognition disappoints on Hindi, this is your fallback for the `/call` screen, still at zero cost.
- **Free tiers may train on your inputs.** <cite index="10-1">Google explicitly states free-tier requests may be used to improve models, and advises against sending confidential data through it.</cite> Your corpus is entirely synthetic, so this is fine — but say it out loud in the limitations slide, and note that a real deployment needs a paid or self-hosted endpoint. Judges who spot this themselves will mark you down; judges who hear you raise it will mark you up.

**Budget check:** ~3 LLM calls per check-in × 80 dev items = 240 calls per eval run. Groq's daily ceiling absorbs that many times over. OpenRouter's unfunded 50/day does not survive a single run.

---

## 3. Day 0 — the two hours that decide whether this works

Do this alone, tonight, before TM2 and TM3 clone anything.

**Prompt 1 — scaffold**

```
Create a Next.js 15 App Router project in TypeScript with Tailwind, in this
repo root. Then create ONLY the directory skeleton and config — no features:

app/(public)/          app/(staff)/          app/call/
app/api/checkin/       app/api/staff/
lib/safety/  lib/llm/  lib/scoring/  lib/policy/  lib/db/
policy/  evals/  scripts/  types/  components/ui/

Add .env.example with: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LLM_PROVIDER,
LLM_API_KEY, LLM_MODEL, STAFF_PASSCODE.

Add .github/CODEOWNERS mapping the paths above to @tm1 @tm2 @tm3 exactly as
in docs/00_MVP_PLAN.md section 4.

Do not install any dependency beyond next, react, tailwind, typescript,
@supabase/supabase-js, zod, and recharts. No component library, no ORM,
no state management library.
```

**Prompt 2 — the contract (the single most important file in the repo)**

```
Read supabase/schema.sql and docs/SCORING_AND_POLICY.md.

Create types/contract.ts with zod schemas and inferred TS types for:
Person, Case, Consent, CheckIn, Assessment, Alert, AuditEvent — matching
supabase/schema.sql column-for-column.

Also define:
- Tier = 'GREEN' | 'AMBER' | 'RED' | 'CRITICAL'
- Channel = 'chat' | 'call_sim'
- TriggerSource = 'policy' | 'lexicon' | 'panic_key' | 'self_report_q3'
- CheckInRequest  { personId, channel, transcript?, structured?, consentId }
- CheckInResponse { reply, tier, resources?, assessmentId, nextQuestionId? }
- QueueItem       { personId, pseudonym, tier, composite, changePoint,
                    createdAt, acked, slaMinutes }
- PersonDetail    { person, case, assessments[], alerts[] }

Types only. No logic, no imports from lib/. Export everything.
```

**Prompt 3 — stub API so the others can start**

```
Create app/api/checkin/route.ts and app/api/staff/queue/route.ts as stubs.
They must validate input with the zod schemas from types/contract.ts and
return hardcoded fixture data matching CheckInResponse and QueueItem[].

Also create scripts/fixtures.ts exporting: one GREEN queue item, one RED
queue item with changePoint true, and one PersonDetail with three
assessments whose composites are 28, 31, 55 — this is the golden path from
docs/00_MVP_PLAN.md section 7.

No database, no LLM. Stubs only. TM2 and TM3 build against these tonight.
```

Then: push, deploy to Vercel, share the URL. **Do not go to sleep before the others can clone a repo that deploys.**

---

## 4. Day 1 — safety interlock and the LLM adapter

**Prompt 4 — the interlock**

```
Read docs/SAFETY_SPEC.md sections 2, 3, 4 and 6.

Create lib/safety/lexicon.ts: an exported array of
{ pattern: RegExp, lang: 'en'|'hi'|'hi-rom', category: string }
covering all four categories in the SAFETY_SPEC table, in English,
Devanagari Hindi, and romanised Hindi. Aim for at least 12 entries per
language. Add a header comment with REVIEWED_BY and REVIEWED_ON left blank
for a human to fill in.

Create lib/safety/interlock.ts exporting:
  checkInput(text: string): { hit: boolean, category?: string, matched?: string }
  checkOutput(text: string): { rejected: boolean, reason?: string }

checkInput normalises (lowercase, strip punctuation, collapse whitespace)
then tests every lexicon pattern.

checkOutput implements the banned-pattern table in SAFETY_SPEC section 6,
including the length rule: reject if over 320 chars or containing more than
one question mark.

CRITICAL CONSTRAINTS:
- No LLM call, no network call, no async. Pure synchronous functions.
- Do NOT add negation handling. "I don't want to kill myself" must still
  fire. Over-firing is the correct failure direction here. Add a comment
  saying so, with a reference to SAFETY_SPEC section 4.

Then create lib/safety/replies.ts with the fixed reply bank from
SAFETY_SPEC section 5, in English and Hindi. Leave the helpline numbers as
TODO constants for a human to fill in and verify.

Write tests in lib/safety/interlock.test.ts covering all ten acceptance
tests in SAFETY_SPEC section 8 that apply to these two functions.
```

**Prompt 5 — the swappable provider (this is your "switch out the model" ask)**

```
Create lib/llm/ with a provider adapter pattern:

lib/llm/types.ts       — interface LLMProvider {
                           name: string
                           modelId: string
                           complete(system: string, user: string):
                             Promise<{ json: unknown, raw: string, ms: number }>
                         }
lib/llm/groq.ts        — Groq, OpenAI-compatible, JSON mode
lib/llm/gemini.ts      — Google AI Studio generateContent, JSON mode
lib/llm/openrouter.ts  — OpenRouter, OpenAI-compatible, base URL
                         https://openrouter.ai/api/v1
lib/llm/ollama.ts      — local, http://localhost:11434
lib/llm/index.ts       — getProvider() reads process.env.LLM_PROVIDER and
                         returns the right one; throws a clear error on an
                         unknown value

Requirements:
- Every provider returns the SAME shape. Route handlers must not know which
  one is active.
- Retry twice with exponential backoff on 429 and 5xx.
- On total failure, throw LLMUnavailableError — the caller degrades to
  scoring on S1/S3/S4 only, per SAFETY_SPEC test S5.
- getProvider().name + ':' + modelId is what gets written to
  assessments.model_version.
- Validate the parsed JSON against a zod schema before returning it. A model
  that returns prose instead of JSON must fail loudly, not silently.

Then lib/llm/prompt.ts exporting SYSTEM_PROMPT as a single string constant
(copy it verbatim from SAFETY_SPEC section 7) and PROMPT_VERSION = "1.0.0".
```

**Decided — `model_version` format.** The prompt above asks for
`name + ':' + modelId`; SAFETY_SPEC section 7 asks for `PROMPT_VERSION` on
every assessment. Both are satisfied by one string:

```
<provider>:<modelId>+prompt-<PROMPT_VERSION>
groq:openai/gpt-oss-120b+prompt-1.0.0
```

One `assessments.model_version` column, both facts, splittable on `+`, no
change to the frozen `types/contract.ts`. Built by `modelVersion()` in
`lib/llm/index.ts` — never concatenated at a call site. The same format is
stated in SAFETY_SPEC.md section 7; if you change one, change both.

**Verify the swap actually works** — this is the check, don't skip it:

```bash
LLM_PROVIDER=groq       npm run eval -- --set safety
LLM_PROVIDER=gemini     npm run eval -- --set safety
LLM_PROVIDER=openrouter npm run eval -- --set safety
```

All three must produce **identical** safety results, because the interlock never calls the LLM. If they differ, something has leaked a model call into the safety path — find it and remove it. That test is worth demoing.

---

## 5. Day 2 — scoring and policy

**Prompt 6**

```
Read docs/SCORING_AND_POLICY.md sections 2 through 8.

lib/scoring/components.ts — pure functions, no I/O:
  scoreS1(structured: {q1,q2,q3}): number
  scoreS3(caseRow: Case, today: Date): { score: number, reasons: string[] }
  scoreS4(person: Person, checkin: CheckIn): { score: number, reasons: string[] }
  S5 is extracted and returned but MUST be weighted 0.00. Add a comment
  citing SCORING_AND_POLICY section 2 so nobody "fixes" it later.

lib/scoring/baseline.ts:
  updateEWMA(prevMean, prevVar, x, lambda=0.3)
  zScore(x, prevMean, prevVar, sigmaFloor=8)
  isChangePoint(z, historyCount, threshold=2.0, minHistory=2)

lib/scoring/composite.ts:
  computeComposite(components, weights) — if any component is null,
  RENORMALISE over the remaining weights. Never substitute 0 for a missing
  signal. Return both the composite and the per-component weighted
  contributions, because the dashboard renders the contributions.

lib/policy/engine.ts:
  loadPolicy() reads and zod-validates policy/v1.yaml
  assignTier(composite, z, changePoint, s3, firstContact, missedCount, policy)
    — evaluates the tier rules top to bottom, first match wins
    — returns { tier, matchedRule, explanation: string[] }

HARD RULES, enforce in code and test them:
  - The LLM's opinion cannot produce CRITICAL. Only trigger_source of
    'lexicon' | 'panic_key' | 'self_report_q3' can.
  - assignTier can never return a tier lower than one already set by a
    deterministic trigger.
  - A rising missed_count can never lower a composite.

Also write policy/v1.yaml exactly as given in SCORING_AND_POLICY section 8.

Tests: reproduce the worked example in section 9 and assert composite 53.75
(±0.5), z 3.11 (±0.05), tier RED, matched rule "change_point".
```

That last test is your regression guard for the entire demo. If it goes red, the golden path is broken.

---

## 6. Day 3 — the eval loop (your "policy → test → improve → test on unknown")

**Prompt 7 — build the eval sets**

```
Create evals/ with three JSONL files. Each line:
{ id, lang, channel, transcript, structured:{q1,q2,q3}, caseContext:{...},
  expectedTier, notes }

evals/safety.jsonl  — 60 items: 40 that MUST be detected as CRITICAL
                      (about 13 English, 13 Devanagari, 14 romanised Hindi),
                      and 20 near-misses that should not be.
evals/dev.jsonl     — 80 items across all four tiers, roughly balanced,
                      both languages, some with missing transcripts to test
                      the renormalisation path.
evals/holdout.jsonl — 40 items, same distribution, DIFFERENT scenarios.

Rules for generating these:
- Entirely synthetic. Invented situations only.
- NO real names, NO real case references, NO real place-plus-incident
  combinations that could identify an actual case.
- Personas are pseudonyms like A-1234.
- Ground the scenarios in the atrocity categories: land dispossession,
  social boycott, threat and intimidation, false counter-case, economic
  exploitation, workplace discrimination.
- Vary the trajectory: some flat-high, some rising, some improving, some
  disengaging.

Then evals/run.ts, invoked as:
  npm run eval -- --set dev --provider groq

It must print: a confusion matrix of expected vs assigned tier, recall on
CRITICAL, per-language recall as SEPARATE rows, count of Pass-2 rejections,
and mean latency. It must NOT print an accuracy figure.
```

**The loop, for real:**

```bash
npm run eval -- --set safety          # must be 100%. Fix code, never the test file.
npm run eval -- --set dev             # read the confusion matrix
#   ↳ edit policy/v1.yaml, bump version, re-run. Repeat.
#   ↳ stop when it stops improving, not after N rounds.
```

**Day 4, once:**

```bash
npm run eval -- --set holdout
```

Write the result down, whatever it is, and **do not tune after seeing it**. A held-out number you tuned against is not a held-out number, and you will know it while you're standing in front of the judges. Reporting a merely-decent honest number beats reporting a great dishonest one, because the second kind gets found.

**Prompt 8 — the provider comparison (a great 45 seconds on stage)**

```
Add `npm run eval -- --set dev --compare groq,gemini,openrouter`. It runs
the same dev set through each provider and prints one table: provider,
model id, CRITICAL recall, per-language recall, mean latency, Pass-2
rejection rate, failure count.

Save the output to evals/results/comparison-<date>.md.
```

---

## 7. Day 4 — wire the pipeline

**Prompt 9**

```
Implement app/api/checkin/route.ts for real, in exactly this order:

1. Validate the body against CheckInRequest.
2. Load the person's live consent row. No live consent => 403, and write
   NOTHING to checkins or assessments.
3. If person.is_minor_flag: return replies.minor_detected, insert the
   checkin, insert NO assessment, and return. Do not score.
4. interlock.checkInput(transcript). On a hit: tier CRITICAL,
   trigger_source 'lexicon', return replies.crisis_immediate plus
   resources, insert checkin + assessment + alert, and RETURN. Never call
   the LLM.
5. Call the LLM for { reply, s2_score, markers, evidence }. On
   LLMUnavailableError, set s2 null and use replies.llm_unavailable.
6. interlock.checkOutput(llm.reply). If rejected, swap in
   replies.fallback_reply and log the rejection.
7. Score S1, S2, S3, S4, S5(weight 0). Compute composite with
   renormalisation. Update the person's EWMA baseline.
8. assignTier via the policy engine. A tier already set deterministically
   can only be raised, never lowered.
9. Insert checkin, assessment (with policy_version, model_version,
   contributions, explanation), and an alert if RED or CRITICAL.
10. Return CheckInResponse.

Latency budget: steps 1-4 must complete in under 100ms. Instrument and
assert this in a test — a person in crisis cannot wait on a model.

Also implement:
  GET  /api/staff/queue       — risk-sorted, unacked first; writes audit
  GET  /api/staff/person/:id  — PersonDetail; writes audit
  POST /api/staff/alert/:id/ack — sets acked_at, acked_by, disposition;
                                  writes audit. A CRITICAL alert can only
                                  be closed by an explicit human disposition.
```

---

## 8. Your daily checks

**Every day before you push:**
- [ ] `npm run eval -- --set safety` is 100%
- [ ] The worked-example test still asserts composite 53.75 / RED
- [ ] `types/contract.ts` unchanged, or you've told the group
- [ ] No `SUPABASE_SERVICE_ROLE_KEY` or `LLM_API_KEY` reachable from a client component
- [ ] No real name anywhere in `evals/` or `scripts/`

**Watch Claude Code for these five.** It will try each one, they are all reasonable-looking, and they all break the build:

| It will try to | Because | Catch it |
|---|---|---|
| Put crisis detection in the system prompt | It's the natural LLM-shaped solution | Grep `lib/safety/` for any provider import. There should be none |
| Give S5 a nonzero weight | Zero weight reads as an unfinished TODO | The comment citing §2 is your defence |
| Default a missing S2 to 0 | Cleaner than renormalising | Test: null S2 with high S1/S3 must still reach RED |
| Add negation handling to the lexicon | It reduces false positives | Test: "I don't want to kill myself" fires |
| Edit `evals/safety.jsonl` when it fails | It's optimising for a green run | That file is yours. Review every diff to it |

---

## 9. Slash commands worth committing to `.claude/commands/`

| Command | Body |
|---|---|
| `/safety` | Run `npm run eval -- --set safety` and report any failure with the exact utterance that was missed and which lexicon entry should have caught it |
| `/goldenpath` | Run `scripts/seed.ts`, POST the day-3 check-in, assert tier RED and change_point true, print the component breakdown |
| `/tune` | Show the current dev-set confusion matrix, propose one specific change to `policy/v1.yaml`, and stop for approval before editing |
| `/arch` | Diff the current branch against the ten hard rules in `CLAUDE.md` and report violations |
