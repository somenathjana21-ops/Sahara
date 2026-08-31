# CHECKS — TM1 (Model, Safety, Scoring, Policy)

> **Usage:** paste into Claude Code —
> `Run every check in docs/CHECKS_TM1.md, top to bottom. Report only. Fix nothing.`

---

## Instructions to the agent

You are **verifying**, not building. Follow these rules exactly.

1. Work top to bottom. Run **every** check, including ones after a failure.
2. Use the exact command given. Do not substitute a different method, and do not reason about whether the check "would probably pass."
3. **Fix nothing while running.** If you fix as you go, the report is worthless and the human loses the picture. Collect everything, report, then wait to be told what to fix.
4. Record for each: `PASS` / `FAIL` / `BLOCKED` / `DEFERRED` / `MANUAL`, plus the **actual evidence** — command output, `file:line`, or the grep hit. Never record PASS without evidence.
5. The result codes are **not** interchangeable. Use exactly these definitions:

| Code | Means | Test |
|---|---|---|
| `PASS` | The command ran and returned the right answer. | — |
| `FAIL` | The command ran and returned the **wrong** answer. | — |
| `BLOCKED` | The command **could not run**: missing npm script, missing file, the command itself errored. | Did the shell refuse you? |
| `DEFERRED` | The command **ran cleanly**, and the feature it checks is **not built yet**. | Did the command exit 0 with nothing to find? |
| `MANUAL` | Ran, but a human must confirm the result (e.g. a live helpline number). | — |

**A `DEFERRED` row MUST name the day and prompt that closes it.** A row that
says "not built yet" without saying *when* is an untracked hole, and it will
still be there on Day 5.

`BLOCKED` used to mean both "could not run" and "not built yet". That ambiguity
is not cosmetic: B5 and B6 moved from FAIL to BLOCKED between two runs **with no
code change**, because one run read "the pipeline isn't wired" as a failed
answer and the next read it as an unrunnable check. A result code that depends
on the reader's mood is not a result code. Split them and neither run is free to
drift.

**Output format — end your run with exactly this:**

```
| ID | Check | Severity | Result | Evidence |
|----|-------|----------|--------|----------|

BLOCKERS FAILING: <n>
MAJOR FAILING:    <n>
MINOR FAILING:    <n>
BLOCKED:          <n>
DEFERRED:         <n>
NEEDS A HUMAN:    <n>

VERDICT: SHIPPABLE / NOT SHIPPABLE
```

**Verdict rule:** any failing BLOCKER = NOT SHIPPABLE. No exceptions, no "but it's nearly there."

**DEFERRED must reach zero by Day 4.** It is the count of features the plan says
will exist and that do not exist yet, so it is allowed to be large on Day 1 and
must be shrinking every day. **Any DEFERRED still open on Day 5 = NOT
SHIPPABLE**, on the same terms as a failing BLOCKER — Day 5 is the demo, and a
feature that is not built on the morning of the demo is not deferred, it is
missing.

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
**Expected result until it lands: `DEFERRED`** — closed by TM1_GUIDE.md section 7, Day 4, Prompt 9 (steps 4 and 6). The route is the guarded stub; the grep runs cleanly and finds nothing because there is nothing yet.
**Run:** read `app/api/checkin/route.ts` and report the line numbers of every `checkInput` and `checkOutput` call.
**Pass:** `checkInput` appears **before** any `lib/llm` call, and `checkOutput` **after** it and before the response is returned. Report both line numbers as evidence.

### T1-B5a · TZ failure cannot reach a person in crisis — BLOCKER
**Expected result until it lands: `DEFERRED`** — closed by TM1_GUIDE.md section 7, Day 4, Prompt 9 (step 4 vs step 8).
**Run:** read `app/api/checkin/route.ts` and report the line numbers of the `checkInput` call and the first `loadPolicy` call.
**Pass:** `checkInput` runs **strictly before** `loadPolicy`, and the lexicon-hit branch returns crisis resources **without** reaching `loadPolicy`. Quote both line numbers and the early `return`.

`loadPolicy()` throws when `TZ` is unpinned (`assertTimezonePinned` in
`lib/policy/engine.ts`). That is deliberate — a wrong date is worse than a
failed boot — but it puts a **new way for the route to 500** in front of
everything downstream of it. If policy loading is ordered before Pass 1, then a
single missing environment variable turns "I want to kill myself" into an HTTP
500 with no helpline number in it.

SAFETY_SPEC.md section 1 is explicit: the interlock "runs before the LLM is
contacted, so a person in crisis gets resources even if the model is down,
rate-limited, or slow." A misconfigured timezone is the same class of failure as
a dead model provider, and the same rule applies — **the crisis path must not
depend on anything that can be misconfigured.** Scoring may fail closed. Pass 1
may not.

This is the ordering that makes the fail-closed guard safe to have. Without it,
hardening the scorer made the crisis path more fragile, not less.

### T1-B6 · Critical short-circuits the model
**Expected result until it lands: `DEFERRED`** — closed by TM1_GUIDE.md section 7, Day 4, Prompt 9 (step 4).
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
**Expected result until it lands: `DEFERRED`** — closed by TM1_GUIDE.md section 7, Day 4, Prompt 9. There is no insert path to version yet.
**Run:** `grep -n "policy_version\|model_version" app/api/checkin/route.ts`
**Pass:** both written on every insert path, including the lexicon short-circuit path.

### T1-C9 · Consent gate — BLOCKER
**Expected result until it lands: `DEFERRED`** — closed by TM1_GUIDE.md section 7, Day 4, Prompt 9 (step 2).
**Run:** POST a check-in for a person with no live consent row.
**Pass:** HTTP 403 **and** zero new rows in `checkins` and `assessments`. Verify the row count, not just the status code.

### T1-C10 · Minor route — BLOCKER
**Expected result until it lands: `DEFERRED`** — closed by TM1_GUIDE.md section 7, Day 4, Prompt 9 (step 3).
**Run:** POST a check-in for a person with `is_minor_flag = true`.
**Pass:** the minor reply is returned, a `checkins` row exists, and **zero** `assessments` rows were written.

### T1-C11 · Crisis path latency — MAJOR
**Run:** `npm run test -- latency`
**Pass:** steps 1–4 complete in under 100 ms with the LLM mocked to hang. A person in crisis cannot wait on a model.

### T1-C12 · S3 is a snapshot, not a recomputation — BLOCKER
**Expected result for the end-to-end half: `DEFERRED`** — the read path
(`GET /api/staff/person/:id`) is closed by TM1_GUIDE.md section 7, Day 4,
Prompt 9. The unit half below is live now and must PASS today.
**Run:** `npm run test -- scoring`
**Pass:** a test asserts a historical assessment returns the S3 stored in `components` (50 for A-4471's first two), **not** S3 recomputed from today's `cases` row (90). Recomputing makes the trend chart lie about the past.

**Until the read path lands, this asserts the stored components only.** The
end-to-end version of the guard — reading a historical assessment back *from the
database* and proving the API did not recompute it on the way out — cannot be
written before `GET /api/staff/person/:id` exists. Record the unit half as PASS
and the end-to-end half as DEFERRED; do not let a green unit test read as
coverage of a read path that does not exist.

The assertion lives in `lib/scoring/scoring.test.ts`, not
`scripts/fixtures.test.ts`. It was moved there because `npm run test -- scoring`
filters by file **path**, and `scripts/` does not match it — the check named a
command that could never reach its own assertion.

---

## Gate D — the model adapter

### T1-D1 · Providers are interchangeable — MAJOR
**Landed** — the eval harness exists (`npm run eval`, TM1_GUIDE.md section 6, Day 3,
Prompt 7). This check now runs and is expected to return a real PASS or FAIL; it is
no longer DEFERRED or BLOCKED for any planned reason.

> Note for anyone reading an older run: this row used to carry an "expected
> BLOCKED, not DEFERRED" note on the grounds that `npm run eval` was not yet a
> script. That reasoning is superseded — both by the script existing and by the
> rule stated under T1-F1, which files a command that cannot run *because its
> feature is unbuilt* as DEFERRED rather than BLOCKED.

**Note on evidence:** a run where the gemini and openrouter calls fail on a bad or
absent key still produces identical numbers, because the interlock never calls a
model — which is exactly the point being made. Say so in the evidence if that is
what happened, because such a run does **not** demonstrate that those two adapters
work; T1-D4 and the adapter tests cover that separately.
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
**Expected result until it lands: `DEFERRED`** — closed by TM1_GUIDE.md section 7, Day 4, Prompt 9. The adapter already degrades; the route has no pipeline to degrade in.
**Run:** set `LLM_API_KEY` to garbage, POST a check-in.
**Pass:** HTTP 200, a `checkins` row and an `assessments` row are written, S2 is `null`, the composite is renormalised, and the interlock still fired. The system must survive the model being down.

### T1-D4 · Model output is schema-validated — MAJOR
**Run:** `grep -n "safeParse\|\.parse(" lib/llm/*.ts`
**Pass:** the parsed JSON is validated with zod before being returned. A model that emits prose must fail loudly, not silently.

---

## Gate E — evaluation honesty

> **Every check in this gate is `BLOCKED`, not `DEFERRED`, until the eval harness exists.**
> `npm run eval` is not an npm script and `evals/` holds no `.jsonl` files, so none of
> these commands can run — E1's empty output is a shell error, not a passing grep.
> Closed by TM1_GUIDE.md section 6, Day 3, Prompt 7 (eval sets and `evals/run.ts`).

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
**Expected result until it lands: `DEFERRED`, not BLOCKED** — needs `scripts/seed.ts`
(TM3_GUIDE.md section 4, Prompt 1, **TM3 Day 1**) and the route pipeline
(TM1_GUIDE.md section 7, Prompt 9, **TM1 Day 4**). Both must land before this can run.

`npm run seed` is not an npm script yet, so a strict reading of the result-code
table calls this BLOCKED — "the command could not run: missing npm script". Record
it as **DEFERRED** anyway, and the distinction is worth stating once because it
generalises to every check in this file:

> **BLOCKED is about the harness. DEFERRED is about the feature.** Ask *why* the
> command cannot run. A script that is missing because nobody has written the
> feature it invokes is a feature that does not exist yet — DEFERRED, and it must
> name the day and prompt that closes it. BLOCKED is for a command that cannot run
> for a reason the plan does not already account for: a broken harness, an
> unreachable host, a permission the runner does not have, a file that should be
> there and is not.

The reason this matters is the counting rule. DEFERRED is tracked, has a named
closing prompt, and must reach zero by Day 4; BLOCKED has no owner and no date. A
planned, scheduled gap filed as BLOCKED silently leaves the burn-down and nobody
notices it is missing until Day 5.

**Run:** `npm run seed`, then POST the day-3 check-in for persona `A-4471`.
**Pass:** response tier `RED`, `change_point: true`, an `alerts` row created with `ack_required`, and the assessment's `contributions` show S3 among the top two. Print the full breakdown as evidence.

### T1-F2 · Deterministic replay — MAJOR
**Expected result until it lands: `DEFERRED`, not BLOCKED — inherited from T1-F1.**
This check runs F1 twice, so it cannot run until F1 can: it needs `scripts/seed.ts`
(TM3_GUIDE.md section 4, Prompt 1, **TM3 Day 1**) and the route pipeline
(TM1_GUIDE.md section 7, Prompt 9, **TM1 Day 4**). It closes when F1 closes, and it
carries F1's closing prompts rather than any of its own.

Record it as DEFERRED for the same reason F1 is, and see the BLOCKED-vs-DEFERRED
rule stated there: the harness is fine, the feature is absent.
**Run:** F1 twice from a fresh seed with the LLM mocked to a fixed S2.
**Pass:** identical composite both times. A demo that only works sometimes is a demo that fails on stage.

**A note on what "identical" can mean here.** The composite is only reproducible
if the S2 fed into it is held fixed, which is why the check says to mock it. Do not
substitute a live provider and call the result deterministic — the dev-set runs on
Day 3 produced a different confusion matrix on each pass over a byte-identical
file, because a live `s2_score` moves between runs and rate-limited calls degrade
different items each time. Mock S2, or this check measures the provider's mood.

### T1-F3 · Deployed, not local — BLOCKER
**Run:** curl the Vercel production URL's `/api/staff/queue` with the passcode cookie.
The URL is in README.md under "Deployed". It is not a secret and nobody should
have to be asked for it.
**Pass:** HTTP 200 with real data. Every env var set in production, not just in `.env.local`.

**Then, separately: verify `TZ` is set for all three Vercel environments —
Production, Preview AND Development.** Run `vercel env ls` and paste the output,
or attach the Project Environment Variables screenshot. A variable set for
Production only will pass every check on this list and then produce a different
S3 the first time anyone opens a Preview deployment.

**A green local test suite cannot prove this and must not be offered as
evidence.** `scripts/run-tests.mjs` injects `TZ=Asia/Kolkata` into the test
process precisely so the suite is reproducible across machines, which means the
suite passes identically whether or not the deployed environment has the
variable at all. The only evidence that counts here comes from Vercel.
