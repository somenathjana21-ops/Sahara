# Fixes & Prompts — v1.0 → v1.1

Claude Code raised four issues on `types/contract.ts` and three on the golden path. All seven are real. Chasing them down surfaced an eighth that none of them caught and that would have broken the demo on stage.

**Apply in this order.** §1 first — it changes numbers that §2 and §3 depend on.

---

## 1. The golden path was arithmetically impossible

### What Claude Code found (all correct)

| # | Conflict | Verdict |
|---|---|---|
| 1 | §9 says S3 = 65; §5's rubric on the seeded case gives **90** (§9 silently drops bail +20 and case-age +5) | Correct |
| 2 | `00_MVP_PLAN` §7 says composite 67 / z 3.1; `SCORING` §9 says 55.1 / 3.15 | Correct |
| 3 | "S3 contributed most" is false — at S3=65 the contributions are S1 23.3, S3 16.3, S2 15.5 | Correct |
| 4 | EWMA at λ=0.3 on 28, 31 gives **28.9**, not the 29.9 seeded in `schema.sql` | Correct |

### What none of them caught

**S3 never changed.** With the intimidation report at D−5 and the hearing at D+3, both time-windowed rows were already inside their windows on day −3. S3 sat at **90 for all three check-ins.**

Two consequences, either of which kills the demo:

- **The flat baseline can't exist.** S3 = 90 contributes 22.50 on its own. For a composite of 28.00, S1 and S2 would have to contribute 5.50 between them — meaning a person reporting essentially zero distress while her case file screams. Not a baseline; an incoherence.
- **`s3_gte: 60` would have fired RED on day −3.** Your two GREEN check-ins come back RED, the trend line is flat-at-the-top, and there is no spike to show.

Fixing the arithmetic in items 1–4 would have left this in place. The demo would have been debugged live on Day 4.

### The fix

Move the two time-windowed events so they fire **between check-in 2 and check-in 3**:

| | v1.0 | v1.1 |
|---|---|---|
| `next_hearing_date` | `current_date + 3` | **`current_date + 6`** |
| `last_intimidation_report` | `current_date - 5` | **`current_date - 1`** |

Static rows are unchanged and total **50** — deliberately under the 60 threshold.

```
            D-3        D-2        D-1               D0 (live)
 S3          50         50     [both events fire]    90
 composite   28.00      31.00                        53.75
 z           —          0.375                        3.11
 tier        GREEN      GREEN                        RED
```

### The corrected numbers

| | v1.0 (broken) | v1.1 (verified) |
|---|---|---|
| Composite at D0 | 55.1 / 67 | **53.75** |
| z | 3.15 / 3.1 | **3.11** |
| μ after 2 check-ins | 29.9 | **28.90** |
| σ² | 64 | **2.70** (σ = 1.64, floored to 8) |
| S3 at D0 | 65 | **90** |
| S3 at D−3 / D−2 | 90 (unstated) | **50** |
| D0 inputs | q1=3,q2=4,q3=1 · S2=62 | **q1=3,q2=2,q3=1 · S2=55** |
| Largest contribution | S1 (23.3) | **S3 (22.50)** ✓ |

The demo claim now survives its own numbers: S3 22.50 > S1 17.50 > S2 13.75.

**Files replaced:** `v1.1/SCORING_AND_POLICY.md`, `v1.1/schema.sql`.

---

## 2. Rulings on Claude Code's four contract questions

### `z.guid()` over `z.uuid()` — **approved, don't churn**

The reasoning is right: zod 4's `z.uuid()` enforces RFC 9562 variant bits, and `1111...` has `1` in the variant nibble where it needs 8/9/a/b. Postgres accepts it; the validator wouldn't. Catching that before Day 1 saved TM3 an hour chasing a phantom bug.

Keep it. Postgres is the real enforcer of UUID shape, and a stricter validator buys nothing here.

### snake_case rows / camelCase payloads — **approved**

Forced by the spec: rows are "column-for-column" with `schema.sql`, DTOs are written camelCase. Rows are storage, payloads are wire format. Consistent, and the boundary is exactly where the ORM would be if you had one.

### `CrisisResource { label, phone, note? }` — **approved as the shape**

Right instinct choosing structured over `string[]` so TM2 can build a `tel:` link. Two constraints to add before it freezes:

- **`phone` is a string, not a number.** `14566` is a short code; leading zeros and future formats will break a numeric type.
- **Both `label` and `phone` are required.** A resource card with no number is a resource card that helps nobody. If you ever need a non-phone resource, that's a contract change, not an optional field.

### Enums stricter than the database — **fixed at the database instead**

Good catch. `schema.sql` had no CHECK constraints, so zod was the only thing enforcing those domains and a typo'd `stage` would insert fine and blow up on read — in the dashboard, during the demo, looking like TM3's bug.

`v1.1/schema.sql` adds CHECK constraints on `language`, `stage`, `bail_status`, `capture_method`, `channel`, `tier`, `trigger_source`, `disposition`, `role`, `action`. The database now fails at write time, where the error is legible.

### `greenQueueItem.slaMinutes = 1440` — **fixed in policy**

Real gap: `QueueItem.slaMinutes` is required but the escalation map had no GREEN entry, so the fixture had to invent one. v1.1 adds `GREEN: { ack_required: false, sla_minutes: 10080 }`. No contract change needed.

### The stub returning only GREEN — **exactly right**

Declining to add a "force CRITICAL" switch to the route handler was the correct call, for the reason given: a crisis path living in a route instead of `lib/safety/lexicon.ts` is what rule 1 forbids, and stubs do survive to Day 5. TM2 mocks it in their own test, as `TM2_GUIDE` §4 already instructs.

---

## 3. Exact edits to the other files

These are small enough to apply by hand. Do them before Day 2.

### `CLAUDE.md` — ownership conflict

`CLAUDE.md` gives TM3 `scripts/**`; `00_MVP_PLAN` §4 gives them only `scripts/seed.ts`; `TM1_GUIDE` §3 tells TM1 to create `scripts/fixtures.ts`. Claude Code followed the plan and CODEOWNERS, which was right, but the conflict will block someone at 2am.

```diff
- | `app/(staff)/**`, `app/call/**`, `supabase/**`, `scripts/**` | TM3 |
+ | `app/(staff)/**`, `app/call/**`, `supabase/**`, `scripts/seed.ts` | TM3 |
+ | `scripts/fixtures.ts` | TM1 |
```

Update `.github/CODEOWNERS` to match.

### `CHECKS_TM1.md` — T1-C1

```diff
- **Pass:** the test asserts composite `55.1 ±0.5`, z `3.15 ±0.05`, tier `RED`,
+ **Pass:** the test asserts composite `53.75 ±0.5`, z `3.11 ±0.05`, tier `RED`,
    matched rule `change_point`.
+ **Also assert:** S3's weighted contribution (22.50) is the LARGEST of the four.
+ Demo beat #2 claims this out loud; if it stops being true, the claim has to change.
```

### `CHECKS_TM1.md` — add T1-C12

```markdown
### T1-C12 · S3 is a snapshot, not a recomputation — BLOCKER
**Run:** `npm run test -- scoring`
**Pass:** a test asserts that reading a historical assessment returns the S3
stored in `components` (50 for A-4471's first two), NOT S3 recomputed from
today's `cases` row (90). Recomputing makes the trend chart lie about the past.
```

### `TM3_GUIDE.md` — §3, the S3 reason strings

```diff
- "Hearing in 3 days," "4th adjournment," "Relief 62 days overdue,"
- "Intimidation reported 5 days ago."
+ "Hearing in 6 days," "4th adjournment," "Relief 62 days overdue,"
+ "Accused released on bail," "Intimidation reported yesterday."
```

### `CHECKS_TM3.md` — T3-C5

Same string replacement as above.

### `00_MVP_PLAN.md` — §7 and §8

```diff
  ## 7. The golden path
- - Persona A-4471. Hindi. Land dispossession. Hearing in 3 days. 4th adjournment.
-   Relief instalment 62 days overdue.
- - Day −3: composite 28 → Green
- - Day −2: composite 31 → Green
- - Day 0: composite 67, z = 3.1 → change point → Red
+ - Persona A-4471. Hindi. Land dispossession. Accused on bail, 4th adjournment,
+   relief 62 days overdue — 50 points of standing case pressure, held under the
+   s3_gte:60 threshold on purpose.
+ - Day −3: S3 50, composite 28.00 → GREEN
+ - Day −2: S3 50, composite 31.00 → GREEN  (μ = 28.90, σ = 1.64 → floored to 8)
+ - Day −1: intimidation report filed; hearing (D+6) enters the 7-day window
+ - Day 0:  S3 90, composite 53.75, z = 3.11 → change point → RED
+   Breakdown: S3 22.50 · S1 17.50 · S2 13.75 · S4 0.00

  ## 8. Demo order
- 2. Point at S3: "the strongest signal isn't the voice, it's the court calendar" (60s)
+ 2. Point at S3: "the strongest signal isn't the voice, it's the court calendar."
+    Back it with the numbers — S3 contributes 22.50, more than her self-report
+    (17.50) and more than the language model (13.75). Then: the hearing is six
+    days out and the intimidation report was filed yesterday. She is flagged
+    BEFORE the hearing. (60s)
```

---

## 4. Prompts to run

### Prompt A — apply the corrections (TM1, run first)

```
Read v1.1/SCORING_AND_POLICY.md and v1.1/schema.sql. They supersede the v1.0
versions — the v1.0 golden path was arithmetically impossible and the numbers
have changed.

1. Replace docs/SCORING_AND_POLICY.md and supabase/schema.sql with the v1.1
   versions.

2. Update policy/v1.yaml to match v1.1 section 8. Two changes: version bumps
   to "1.1.0", and an escalation entry is added for GREEN
   { ack_required: false, sla_minutes: 10080 }.

3. In scripts/fixtures.ts, update goldenPathPersonDetail to the v1.1 numbers:
     D-3: components {s1:25, s2:27, s3:50, s4:0, s5:null}
          contributions {s1:8.75, s2:6.75, s3:12.50, s4:0}
          composite 28.00, z null, change_point false, tier GREEN
     D-2: components {s1:25, s2:39, s3:50, s4:0, s5:null}
          contributions {s1:8.75, s2:9.75, s3:12.50, s4:0}
          composite 31.00, z 0.375, change_point false, tier GREEN
     D0:  components {s1:50, s2:55, s3:90, s4:0, s5:null}
          contributions {s1:17.50, s2:13.75, s3:22.50, s4:0}
          composite 53.75, z 3.11, change_point true, tier RED
   Remove the invented slaMinutes comment on greenQueueItem — 10080 now comes
   from policy. Assert in a test that contributions sum to composite on all three.

4. In types/contract.ts, tighten CrisisResource: phone is z.string() (not
   number — 14566 is a short code), and both label and phone are required.
   This is the only contract change; note it in the commit message as
   "CONTRACT CHANGE" per CHECKS_TM1 T1-A6.

5. Fix the ownership conflict in CLAUDE.md and .github/CODEOWNERS: TM3 owns
   scripts/seed.ts, TM1 owns scripts/fixtures.ts. Not scripts/**.

Do NOT change the weights in policy/v1.yaml. They are unchanged from v1.0;
only the worked example and the seed timeline were wrong.
```

### Prompt B — the ordering bug in the baseline (TM1, Day 2)

This one is not in any report. It's the bug I expect you to write.

```
Read v1.1/SCORING_AND_POLICY.md section 7.

Implement lib/scoring/baseline.ts. The API must make the update ordering
impossible to get wrong:

  computeZ(x, prevMean, prevVar, sigmaFloor=8): number | null
  updateBaseline(x, prevMean, prevVar, lambda=0.3): { mean, var }

z is computed against the baseline BEFORE this check-in updates it. If a
caller updates the mean first and then computes z, every deviation is partly
absorbed into the thing it is measured against, and spikes read as SMALLER
than they are — the one direction we cannot afford to be wrong in.

Design the module so the wrong order is hard to write: computeZ must not
mutate, updateBaseline must not return a z, and the route handler calls them
in that order with a comment explaining why.

First check-in: mean = x, var = 0, z = null. Do not return z = 0 for a first
contact — 0 means "no deviation", null means "no basis for comparison", and
the policy engine must branch to the first-contact floor on null.

Tests, using the v1.1 section 9 worked example:
  - 28 then 31 gives mean 28.90, var 2.70
  - z at D0 with x=53.75 is 3.11 (+/- 0.01)
  - computing z AFTER updating the mean produces a DIFFERENT, smaller value.
    Assert that difference explicitly, so the test documents the trap.
  - first check-in returns z null, not 0
```

### Prompt C — S3 snapshot vs recomputation (TM1, Day 2)

```
Read v1.1/SCORING_AND_POLICY.md section 5.

scoreS3(caseRow, asOfDate) takes an explicit date. Rows 1 and 3 (intimidation
within 14 days, hearing within 7 days) are evaluated against asOfDate, not
against now(). The other five rows are static.

The value is written into assessments.components at check-in time and is NEVER
recomputed on read. The cases row holds current state only.

Test with the A-4471 seed: scoreS3(case, D-3) = 50 and scoreS3(case, D0) = 90
from the SAME case row. That single test is the difference between a trend
chart that tells the truth about the past and one that redraws history every
time someone opens it.

Also return reasons as plain sentences for the dashboard:
"Intimidation reported yesterday", "Hearing in 6 days", "Accused released on
bail", "Relief 62 days overdue", "4th adjournment", "Case open 400 days".
```

### Prompt D — repo restructure (TM1, 10 minutes, do it now)

```
Restructure the repo. Docs are loose at root and build artefacts are committed.

1. mkdir docs/ and move into it: 00_MVP_PLAN.md, SAFETY_SPEC.md,
   SCORING_AND_POLICY.md, TM1_GUIDE.md, TM2_GUIDE.md, TM3_GUIDE.md,
   CHECKS_TM1.md, CHECKS_TM2.md, CHECKS_TM3.md, FIXES_AND_PROMPTS.md.
   CLAUDE.md STAYS at root — Claude Code reads it from there.

2. mkdir supabase/ and move schema.sql into it. CLAUDE.md already assigns
   supabase/** to TM3.

3. git rm --cached tsconfig.tsbuildinfo and add to .gitignore. Also confirm
   .gitignore covers: .next/, node_modules/, .env, .env.local,
   .claude/settings.local.json.

4. mkdir .claude/commands/ and add four commands, committed so all three
   machines get the same behaviour:
     safety.md     - run `npm run eval -- --set safety`, report any miss with
                     the exact utterance and which lexicon entry should have caught it
     goldenpath.md - run seed, POST the D0 check-in, assert tier RED,
                     change_point true, composite 53.75, S3 the largest
                     contribution, print the full breakdown
     arch.md       - diff the current branch against the 10 hard rules in
                     CLAUDE.md and report violations by file:line
     lane.md       - `git diff --name-only main...HEAD` and flag any file
                     outside the current author's CODEOWNERS paths

5. Update every path reference in the moved docs and in CODEOWNERS.

Do not move app/, lib/, components/, evals/, policy/, scripts/, types/.
Do not touch anything under app/ in this task.
```

---

## 5. Target repo structure

Your screenshot against where it should land:

```
sih26094/
├── CLAUDE.md                      ✓ correct at root — leave it
├── README.md                      ✗ MISSING — clone-to-running in 10 min
├── package.json  tsconfig.json  next.config.ts
├── tailwind.config.ts  postcss.config.mjs
├── .env.example  .gitignore
├── .claude/                       ✗ MISSING
│   ├── settings.json              (permission allowlist, committed)
│   └── commands/                  (safety · goldenpath · arch · lane)
├── .github/
│   ├── CODEOWNERS                 ← verify it exists and matches CLAUDE.md
│   └── workflows/ci.yml           ✗ MISSING — see below
├── docs/                          ✗ MISSING — 10 files currently loose at root
│   ├── 00_MVP_PLAN.md  SAFETY_SPEC.md  SCORING_AND_POLICY.md
│   ├── TM1_GUIDE.md  TM2_GUIDE.md  TM3_GUIDE.md
│   ├── CHECKS_TM1.md  CHECKS_TM2.md  CHECKS_TM3.md
│   └── FIXES_AND_PROMPTS.md
├── types/contract.ts              ✓ TM1, frozen
├── app/
│   ├── (public)/                  TM2 — layout · page · consent · checkin
│   ├── (staff)/                   TM3 — layout · page · person/[id]
│   ├── call/                      TM3 — the simulated IVRS screen
│   └── api/                       TM1 — checkin · consent · staff/*
├── components/ui/                 TM2 — Button Card Dot TierBadge Stat
│                                        Field LangToggle CrisisPanel
├── lib/                           TM1
│   ├── safety/                    lexicon · interlock · replies (+ .test.ts)
│   ├── llm/                       types · groq · gemini · openrouter
│   │                              ollama · index · prompt
│   ├── scoring/                   components · baseline · composite
│   ├── policy/                    engine
│   └── db/                        server-only supabase client
├── policy/v1.yaml                 TM1
├── evals/                         TM1
│   ├── safety.jsonl  dev.jsonl  holdout.jsonl  run.ts
│   └── results/                   holdout run output — exactly ONE file
├── scripts/
│   ├── seed.ts                    TM3
│   └── fixtures.ts                TM1
├── supabase/schema.sql            ✗ currently loose at root
└── public/                        ✓ exists — keep it free of any human image
```

### What's wrong in the screenshot

| | Problem | Fix |
|---|---|---|
| 1 | 10 markdown files loose at root | `docs/` (Prompt D) |
| 2 | `schema.sql` at root, but `supabase/**` is TM3's territory | `supabase/schema.sql` |
| 3 | **`tsconfig.tsbuildinfo` committed, 111 KB** | `git rm --cached` + gitignore |
| 4 | No `supabase/` directory at all | Prompt D |
| 5 | No `.claude/` — three machines, three different agent behaviours | Prompt D |
| 6 | No `README.md` | Below |
| 7 | No CI | Below |

Everything else is right. `app/`, `components/`, `evals/`, `lib/`, `policy/`, `public/`, `scripts/`, `types/` all exist at the correct level, and `.env.example` is committed while `.env` isn't. That's the part people usually get wrong.

### Prompt E — README and CI (TM1, 15 minutes)

```
1. Write README.md at repo root: what this is (one paragraph, SIH 26094),
   prerequisites, the exact clone-to-running steps, the env vars needed and
   where to get each, `npm run seed`, and how to run the three CHECKS files.
   Target: a teammate on a fresh laptop is running in under 10 minutes.
   No architecture explanation — link to docs/.

2. .github/workflows/ci.yml, on push and PR:
     - npm ci
     - npm run build
     - npm run test
     - npm run eval -- --set safety   ← FAILS THE BUILD if not 100%
     - a grep step that fails if evals/ or scripts/ contain any of:
       singh|kumar|devi|yadav|sharma|patel|reddy|@gmail|\+91[0-9]{10}
     - a grep step that fails if any 'use client' file references
       SERVICE_ROLE, LLM_API_KEY, or STAFF_PASSCODE

   The safety eval and the two grep steps are hard failures, not warnings.
   Do not add a step that can be skipped with a commit-message flag.
```

The PII grep in CI is worth the ten minutes. It is the one rule where a single careless fixture, written at 1am on Day 4, is unrecoverable — and it's exactly the kind of thing an agent adds while trying to make test data "look realistic."

---

## 6. Re-run after applying

```
Run every check in docs/CHECKS_TM1.md, top to bottom. Report only. Fix nothing.
```

Expect `T1-C1` to pass on the new numbers, `T1-A6` to report one CONTRACT CHANGE commit (the `CrisisResource` tightening — that's correct and expected), and most of Gates B through F to come back BLOCKED. On Day 1, BLOCKED is the right answer; it's the list of what your next commits have to produce.
