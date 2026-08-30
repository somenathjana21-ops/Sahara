# CHECKS — TM1 (Model, Safety, Scoring, Policy)

> **Usage:** paste into Claude Code —
> `Run every check in docs/CHECKS_TM1.md, top to bottom. Report only. Fix nothing.`

---

## Instructions to the agent

You are **verifying**, not building. Follow these rules exactly.

1. Work top to bottom. Run **every** check, including ones after a failure.
2. Use the exact command given. Do not substitute a different method, and do not reason about whether the check "would probably pass."
3. **Fix nothing while running.** If you fix as you go, the report is worthless and the human loses the picture. Collect everything, report, then wait to be told what to fix.
4. Record for each: `PASS` / `FAIL` / `BLOCKED` (couldn't run) / `MANUAL` (needs a human), plus the **actual evidence** — command output, `file:line`, or the grep hit. Never record PASS without evidence.
5. If a command errors because a file doesn't exist yet, that's `BLOCKED`, not `FAIL`.

**Output format — end your run with exactly this:**

```
| ID | Check | Severity | Result | Evidence |
|----|-------|----------|--------|----------|

BLOCKERS FAILING: <n>
MAJOR FAILING:    <n>
MINOR FAILING:    <n>
BLOCKED:          <n>
NEEDS A HUMAN:    <n>

VERDICT: SHIPPABLE / NOT SHIPPABLE
```

**Verdict rule:** any failing BLOCKER = NOT SHIPPABLE. No exceptions, no "but it's nearly there."

---

## Gate A — repo hygiene

### T1-A1 · No secrets reachable from the browser — BLOCKER
**Run:** `grep -rln "'use client'" app components | xargs -r grep -n "SERVICE_ROLE\|LLM_API_KEY\|STAFF_PASSCODE"`
**Pass:** no output.

### T1-A2 · No secret is publicly prefixed — BLOCKER
**Run:** `grep -rn "NEXT_PUBLIC_.*\(KEY\|SECRET\|PASSCODE\|TOKEN\)" . --exclude-dir=node_modules --exclude-dir=.next`
**Pass:** no output.

### T1-A3 · `.env` not committed — BLOCKER
**Run:** `git ls-files | grep -E "^\.env$|^\.env\.local$"`
**Pass:** no output. `.env.example` may exist and must contain no real values.

### T1-A4 · Build succeeds — BLOCKER
**Run:** `npm run build`
**Pass:** exit code 0.

### T1-A5 · No duplicate type definitions — MAJOR
**Run:** `grep -rn "interface \(CheckIn\|Assessment\|Alert\|Person\|Case\|Consent\)\b\|type \(Tier\|Channel\)\s*=" app lib components --include=*.ts --include=*.tsx | grep -v "types/contract.ts"`
**Pass:** no output. Everyone imports from `types/contract.ts`.

### T1-A6 · Contract frozen since Day 0 — MAJOR
**Run:** `git log --oneline --follow types/contract.ts`
**Pass:** commits after Day 0 exist only if each has "CONTRACT CHANGE" in the message. Report every commit found either way.

### T1-A7 · Dependency discipline — MINOR
**Run:** `cat package.json | grep -A40 '"dependencies"'`
**Pass:** only `next`, `react`, `react-dom`, `tailwindcss`, `typescript`, `@supabase/supabase-js`, `zod`, `recharts`, `tsx`, `autoprefixer`, `postcss` (Tailwind v3's required PostCSS pipeline, not discretionary), plus type packages. Flag anything else by name.

---

## Gate B — the safety layer (every one is a BLOCKER)

### T1-B0 · The stub fails closed — BLOCKER
**Run:** POST a crisis utterance to the PRODUCTION URL with no STUB_MODE set.
**Pass:** HTTP 503 carrying the helpline numbers. NOT 200, and never a tier.
**After the real pipeline lands:** this check flips — production must return
200 with tier CRITICAL and resources. Until then, 503 is the correct answer
and a 200 of any kind is a blocker.

### T1-B1 · Safety eval is 100%
**Run:** `npm run eval -- --set safety`
**Pass:** CRITICAL recall exactly `100%` / `40 of 40`. Anything less fails.
**On FAIL:** report which utterances were missed and which lexicon entry should have caught each. **Do not edit `evals/safety.jsonl`.** That file is the test; changing it to pass is the failure mode it exists to catch.

### T1-B2 · Per-language recall reported separately
**Run:** same output as B1.
**Pass:** three distinct rows — `en`, `hi`, `hi-rom`. A single averaged number is a FAIL even at 100%, because an average hides exactly the disparity this project is meant to avoid.

### T1-B3 · No model call anywhere in the safety path
**Run:** `grep -rn "lib/llm\|fetch(\|axios\|openai\|groq\|generateContent" lib/safety/`
**Pass:** no output. Crisis detection is regex; a system prompt is a request, a regex is a guarantee.

### T1-B4 · Interlock is synchronous
**Run:** `grep -nE "\b(async|await|Promise)\b" lib/safety/interlock.ts lib/safety/lexicon.ts | grep -vE ":[0-9]+:\s*(\*|//|/\*)"`
**Pass:** no output.
The trailing filter drops comment lines. Without it the check reads FAIL on a
correct file: `interlock.ts`'s header comment documents the absence of `async`,
so the unfiltered grep matches its own documentation. Same class of problem as
the word boundaries in T1-E4.
**A hit inside a comment is not a pass by assertion — quote the filtered output.**

### T1-B5 · Two-pass wiring
**Run:** read `app/api/checkin/route.ts` and report the line numbers of every `checkInput` and `checkOutput` call.
**Pass:** `checkInput` appears **before** any `lib/llm` call, and `checkOutput` **after** it and before the response is returned. Report both line numbers as evidence.

### T1-B6 · Critical short-circuits the model
**Run:** read the branch after `checkInput` in the route.
**Pass:** on a lexicon hit the handler returns without ever reaching the LLM call. Quote the early `return`.

### T1-B7 · Negation is not handled
**Run:** `npm run test -- interlock`
**Pass:** the suite contains a case asserting `"I don't want to kill myself"` **fires**, and it passes. Over-firing is the correct failure direction here.

### T1-B8 · Lexicon covers all three written forms
**Run:**
```
grep -cE "lang:\s*['\"]en['\"]" lib/safety/lexicon.ts
grep -cE "lang:\s*['\"]hi['\"]" lib/safety/lexicon.ts
grep -cE "lang:\s*['\"]hi-rom['\"]" lib/safety/lexicon.ts
grep -c "pattern: /" lib/safety/lexicon.ts
```
**Pass:** each language ≥ 12, **and the three language counts sum to the pattern
count**. A mismatch means an entry is missing a `lang` tag — it is in the file,
it is never attributed to a language, and it will be invisible in the
per-language recall slice that T1-B2 exists to protect.
The character classes are load-bearing: the earlier single-quoted form
(`lang: 'en'`) returned `0 / 0 / 0` against a double-quoted file and read as a
total failure on a fully populated lexicon. Quote style must not decide a
BLOCKER. Romanised Hindi is what people actually type and is the one teams forget.

### T1-B9 · Human sign-off on every hand-written safety pattern
**Run:**
```
grep -n "REVIEWED_BY\|REVIEWED_ON" lib/safety/lexicon.ts lib/safety/interlock.ts
```
**Pass:** `REVIEWED_BY` and `REVIEWED_ON` are filled in with a real name and date
in **both** files. Either one blank = FAIL. An unreviewed lexicon is not a safety
layer, and neither is an unreviewed Pass 2.

Scope covers both because `lib/safety/interlock.ts` holds the Pass-2
banned-pattern table, including Hindi and romanised-Hindi patterns that were
**authored by an agent**. Those decide whether a model's reply reaches a person
in distress. A reviewer who signs the lexicon has reviewed the input side only;
the output side needs its own signature from someone who reads Hindi.

### T1-B10 · Helpline numbers are real and filled in
**Run:** `grep -n "TODO\|XXXX\|14566\|14416" lib/safety/replies.ts`
**Pass:** no `TODO`/`XXXX` remains and real numbers are present. **Then mark MANUAL** — a human must independently confirm both numbers are currently correct. A wrong helpline number on stage is the worst possible detail to get wrong.

### T1-B11 · Pass-2 rejects advice
**Run:** `npm run test -- interlock`
**Pass:** cases exist and pass for `"you should try"`, a diagnosis term, a reassurance phrase, an over-length reply (>320 chars, tested both just over the boundary and well over it), and a two-question reply.
The rule is 320 — "400 characters" was arbitrary and left the boundary itself
untested, which is where an off-by-one lives.

---

## Gate C — scoring and policy invariants

### T1-C1 · Worked example reproduces — BLOCKER
**Run:** `npm run test -- scoring`
**Pass:** the test asserts composite `53.75 ±0.5`, z `3.11 ±0.05`, tier `RED`, matched rule `change_point`. This is the regression guard for the entire demo.
**Also assert** S3's weighted contribution (`22.50`) is the **largest** of the four — demo beat #2 claims this out loud.

### T1-C2 · S5 weighted zero — BLOCKER
**Run:** `grep -n "s5" policy/v1.yaml`
**Pass:** `s5_acoustic: 0.00`. Also confirm a code comment near the S5 extractor cites the reason, so nobody "fixes" the zero later.

### T1-C3 · Missing signal renormalises — BLOCKER
**Run:** `npm run test -- composite`
**Pass:** a test proves that S2 = `null` with high S1/S3 still reaches RED, and that `null` is **not** substituted with 0. A missing signal is not a calm signal.

### T1-C4 · Model cannot cause CRITICAL — BLOCKER
**Run:** `npm run test -- policy`
**Pass:** a test with a mocked LLM returning `s2_score: 100` on a non-crisis transcript yields a tier that is **not** CRITICAL.

### T1-C5 · Model cannot lower a tier — BLOCKER
**Pass:** a test where a deterministic trigger set CRITICAL and the policy engine would compute GREEN still returns CRITICAL.

### T1-C6 · Silence escalates — BLOCKER
**Pass:** a test asserting three missed check-ins never produce a composite lower than the prior one.

### T1-C7 · First-contact floor
**Pass:** a test where a person with no baseline and composite ≥ 60 gets at least AMBER.

### T1-C8 · Every assessment is versioned — MAJOR
**Run:** `grep -n "policy_version\|model_version" app/api/checkin/route.ts`
**Pass:** both written on every insert path, including the lexicon short-circuit path.

### T1-C9 · Consent gate — BLOCKER
**Run:** POST a check-in for a person with no live consent row.
**Pass:** HTTP 403 **and** zero new rows in `checkins` and `assessments`. Verify the row count, not just the status code.

### T1-C10 · Minor route — BLOCKER
**Run:** POST a check-in for a person with `is_minor_flag = true`.
**Pass:** the minor reply is returned, a `checkins` row exists, and **zero** `assessments` rows were written.

### T1-C11 · Crisis path latency — MAJOR
**Run:** `npm run test -- latency`
**Pass:** steps 1–4 complete in under 100 ms with the LLM mocked to hang. A person in crisis cannot wait on a model.

### T1-C12 · S3 is a snapshot, not a recomputation — BLOCKER
**Run:** `npm run test -- scoring`
**Pass:** a test asserts a historical assessment returns the S3 stored in `components` (50 for A-4471's first two), **not** S3 recomputed from today's `cases` row (90). Recomputing makes the trend chart lie about the past.

---

## Gate D — the model adapter

### T1-D1 · Providers are interchangeable — MAJOR
**Run:**
```
LLM_PROVIDER=groq       npm run eval -- --set safety
LLM_PROVIDER=gemini     npm run eval -- --set safety
LLM_PROVIDER=openrouter npm run eval -- --set safety
```
**Pass:** all three produce **identical** safety numbers. They must, because the interlock never calls a model. **If they differ, a model call has leaked into the safety path** — find it and report the file and line. This is also worth demoing.

### T1-D2 · No provider SDK imported outside `lib/llm/` — MAJOR
**Run:** `grep -rn "groq\|generativeai\|openrouter\|openai" app lib --include=*.ts | grep -v "^lib/llm/"`
**Pass:** no output.

### T1-D3 · Degradation on provider failure — BLOCKER
**Run:** set `LLM_API_KEY` to garbage, POST a check-in.
**Pass:** HTTP 200, a `checkins` row and an `assessments` row are written, S2 is `null`, the composite is renormalised, and the interlock still fired. The system must survive the model being down.

### T1-D4 · Model output is schema-validated — MAJOR
**Run:** `grep -n "safeParse\|\.parse(" lib/llm/*.ts`
**Pass:** the parsed JSON is validated with zod before being returned. A model that emits prose must fail loudly, not silently.

---

## Gate E — evaluation honesty

### T1-E1 · No accuracy metric — MAJOR
**Run:** `npm run eval -- --set dev | grep -i accuracy`
**Pass:** no output. At a ~0.5% base rate, "always fine" scores 99.5%.

### T1-E2 · Holdout run exactly once — BLOCKER
**Run:** `ls evals/results/ | grep holdout`
**Pass:** **exactly one** file. Zero means it hasn't been run — that's BLOCKED, not FAIL. Two or more means it was run repeatedly, which means it was tuned against, which means the number is worthless. Report the count and the file dates.

### T1-E3 · No policy edits after the holdout run — BLOCKER
**Run:** `git log -1 --format=%ci policy/v1.yaml; git log -1 --format=%ci evals/results/`
**Pass:** the policy timestamp is **earlier** than the holdout result timestamp. If the policy was touched afterwards, say so plainly — the honest disclosure is recoverable, being caught is not.

### T1-E4 · Eval sets are synthetic — BLOCKER
**Run:** `grep -oE '"id"\s*:\s*"[^"]+"' evals/*.jsonl | grep -vE '[A-Z]-[0-9]{4}'`
**Pass:** no output — every persona id matches the `A-1234` pseudonym form.
**Then:** `grep -riE "\b(singh|kumar|devi|yadav|sharma|patel|reddy)\b|@gmail|@yahoo|\+91[0-9]{10}" evals/` → **Pass:** no output.
Word boundaries are load-bearing: without them `devi` matches "deviation", which appears throughout the scoring vocabulary, and this BLOCKER fails for a non-PII reason. Same pattern as `.github/workflows/ci.yml`.

### T1-E5 · Eval set sizes
**Run:** `wc -l evals/*.jsonl`
**Pass:** safety ≥ 60, dev ≥ 80, holdout ≥ 40.

### T1-E6 · Dev and holdout do not overlap — MAJOR
**Run:** compare the `transcript` fields across the two files.
**Pass:** zero exact or near-duplicate transcripts. Report any pair found.

---

## Gate F — the demo path

### T1-F1 · Golden path end to end — BLOCKER
**Run:** `npm run seed`, then POST the day-3 check-in for persona `A-4471`.
**Pass:** response tier `RED`, `change_point: true`, an `alerts` row created with `ack_required`, and the assessment's `contributions` show S3 among the top two. Print the full breakdown as evidence.

### T1-F2 · Deterministic replay — MAJOR
**Run:** F1 twice from a fresh seed with the LLM mocked to a fixed S2.
**Pass:** identical composite both times. A demo that only works sometimes is a demo that fails on stage.

### T1-F3 · Deployed, not local — BLOCKER
**Run:** curl the Vercel production URL's `/api/staff/queue` with the passcode cookie.
**Pass:** HTTP 200 with real data. Every env var set in production, not just in `.env.local`.
