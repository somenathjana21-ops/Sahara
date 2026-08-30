# CHECKS — TM3 (Dashboard, Simulated Call, Data, Deploy)

> **Usage:** paste into Claude Code —
> `Run every check in docs/CHECKS_TM3.md, top to bottom. Report only. Fix nothing.`

---

## Instructions to the agent

You are **verifying**, not building.

1. Work top to bottom. Run **every** check, including ones after a failure.
2. Use the exact command given. Do not substitute a different method, and do not reason about whether a check "would probably pass."
3. **Fix nothing while running.** Collect everything, report, then wait to be told what to fix.
4. Record `PASS` / `FAIL` / `BLOCKED` / `MANUAL` with **actual evidence** — command output, `file:line`, or the grep hit. Never record PASS without evidence.
5. Checks needing a microphone, a browser, or a human eye are `MANUAL`. Do the mechanical part, then state precisely what the human must do.

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

**Verdict rule:** any failing BLOCKER = NOT SHIPPABLE.

---

## Gate A — data security

### T3-A1 · RLS enabled on every table — BLOCKER
**Run in Supabase SQL editor:**
```sql
select tablename, rowsecurity from pg_tables where schemaname='public';
```
**Pass:** all seven tables show `rowsecurity = true`.

### T3-A2 · No RLS policies exist — BLOCKER
**Run:**
```sql
select tablename, policyname from pg_policies where schemaname='public';
```
**Pass:** zero rows. All access goes through server-side route handlers using the service-role key. If Claude Code added a permissive policy to make a client-side query work, that is the failure this check exists to catch — report it and do not keep it.

### T3-A3 · Anon key can read nothing — BLOCKER
**Run:** `curl "$SUPABASE_URL/rest/v1/persons?select=*" -H "apikey: $ANON_KEY"`
**Pass:** empty array or a permission error. Any row returned is a BLOCKER.

### T3-A4 · Service-role key never reaches the client — BLOCKER
**Run:** `grep -rln "'use client'" app components | xargs -r grep -n "SERVICE_ROLE"`
**Pass:** no output.
**Then:** `grep -rn "SERVICE_ROLE" .next/static/ 2>/dev/null` → **Pass:** no output. This catches it having been bundled even if the source looks clean.

### T3-A5 · Passcode checked server-side — BLOCKER
**Run:** `grep -rn "STAFF_PASSCODE" app components`
**Pass:** appears only in a route handler or a server component. Never in a `'use client'` file, never compared in the browser.

### T3-A6 · Cookie is httpOnly — MAJOR
**Run:** `grep -n "httpOnly" app/api/staff/auth/route.ts`
**Pass:** `httpOnly: true` and `sameSite: 'lax'` set.

### T3-A7 · Staff routes actually gated — BLOCKER
**Run:** `curl -i <deployed-url>/staff` with no cookie, and `curl -i <deployed-url>/api/staff/queue` with no cookie.
**Pass:** both redirect or return 401/403. **Check the API route separately** — gating only the page while leaving the API open is the standard mistake, and hiding UI is not access control.

### T3-A8 · No PII anywhere — BLOCKER
**Run:** `grep -riE "\b(singh|kumar|devi|yadav|sharma|patel|reddy)\b|@gmail|@yahoo|\+91[0-9]{10}" scripts/ supabase/`
Word boundaries are load-bearing: without them `devi` matches "deviation", which appears throughout the scoring vocabulary, and this BLOCKER fails for a non-PII reason. Same pattern as `.github/workflows/ci.yml`.
**Pass:** no output.
**Then:** `select pseudonym from persons;` → **Pass:** every value matches `A-1234` form.

---

## Gate B — seed and the golden path

### T3-B1 · Seed is idempotent — BLOCKER
**Run:** `npm run seed && npm run seed`, then `select count(*) from persons;`
**Pass:** the same count after both runs. Running it twice mid-demo must not create duplicates.

### T3-B2 · Baseline computed, not hardcoded — BLOCKER
**Run:** `grep -nE "28\.9|29\.9|baseline_mean\s*[:=]\s*[0-9]|baseline_var\s*[:=]\s*[0-9]" scripts/seed.ts`
**Pass:** no literal baseline values. The seed must call `lib/scoring/baseline.ts` on the two prior composites. A hardcoded baseline means the demo isn't reproducible from the real code path, and a judge who asks "where does 28.90 come from?" gets a bad answer.

### T3-B3 · Third check-in is NOT seeded — BLOCKER
**Run:** `npm run seed`, then `select count(*) from checkins where person_id = '11111111-1111-1111-1111-111111111111';`
**Pass:** exactly `2`. The spike is created live on stage. If it's pre-seeded, you're showing a screenshot, not a system.

### T3-B4 · Golden path end to end — BLOCKER
**Run:** seed, then complete a check-in for `A-4471` through `/call` on the deployed URL.
**Pass:** an `alerts` row appears with tier `RED`, the queue shows it unacked at the top, and the person detail shows a trend line spiking on the third point with the breakdown visible. Report the composite, z-score, and top two contributions as evidence.

### T3-B5 · Queue isn't empty — MINOR
**Run:** `select tier, count(*) from assessments group by tier;`
**Pass:** at least 8 filler personas across varied tiers. A queue with one row doesn't demonstrate triage.

---

## Gate C — the dashboard

### T3-C1 · No naked composite — BLOCKER
**Run:** `grep -rn "composite" app/\(staff\)/`
**Pass:** every render site is accompanied by a tier badge or the component breakdown. A bare number with no breakdown is the explainability failure the problem statement explicitly rules out. Check tooltips and the queue rows too, not just the detail page.

### T3-C2 · Breakdown shows all four contributions — BLOCKER
**Run:** open the person detail for `A-4471`.
**Pass:** S1, S2, S3, S4 each rendered as a weighted contribution, matching `assessments.contributions` in the database. Cross-check the numbers against the row.

### T3-C3 · S5 shown but disclaimed — MAJOR
**Run:** `grep -rn "s5\|acoustic" app/\(staff\)/`
**Pass:** rendered greyed, with the caveat text stating it is not used in scoring. Showing it while refusing to score it is a stronger statement than hiding it — it is a deliberate talking point.

### T3-C4 · Change points marked on the trend — MAJOR
**Pass:** the third point on `A-4471`'s chart is visually marked as a change point, distinct from the other two.

### T3-C5 · S3 reasons in plain language — MAJOR
**Pass:** the detail page lists the case-context reasons as sentences — "Hearing in 6 days", "4th adjournment", "Relief 62 days overdue", "Accused released on bail", "Intimidation reported yesterday" — not as a raw score or a JSON blob. This is the pitch centrepiece; it has to read as English.

### T3-C6 · Audit rows written — BLOCKER
**Run:** `select count(*) from audit_events;` before and after viewing the queue, a person, and acking an alert.
**Pass:** count increases by 3. Compliance is demonstrable or it isn't real.

### T3-C7 · CRITICAL needs an explicit disposition — BLOCKER
**Run:** try to close a CRITICAL alert without selecting a disposition.
**Pass:** rejected. Only a human closes a Critical.

### T3-C8 · Triage in 30 seconds — MANUAL
**Do:** time yourself from opening the queue to dispositioning a case.
**Pass:** under 30 seconds. At realistic base rates a counsellor reviews ~100 mostly-fine cases per 1,000 users monthly; if disposition takes three minutes, the system is abandoned by week three.

### T3-C9 · Uses TM2's components — MINOR
**Run:** `grep -rnE "#[0-9a-fA-F]{3,8}|rgb\(" app/\(staff\) app/call`
**Pass:** no output. No new colours, no new components in `components/ui/`.

---

## Gate D — the simulated call

### T3-D1 · Panic key works offline — BLOCKER
**Run:** `npm run test -- call`
**Pass:** a test with `fetch` mocked to reject asserts the crisis panel renders after pressing `0`. If the test awaits a network response first, that is a FAIL.
**Then MANUAL:** devtools → Offline → press `0` on `/call`. Resources must appear.

### T3-D2 · Panic key works at every state — BLOCKER
**Pass:** tests cover `0` at `consent_notice`, `q1`, `q2`, `q3`, and `open_question`. All five.

### T3-D3 · Typed fallback always present — BLOCKER
**Run:** `grep -n "type instead\|textarea\|input type=\"text\"" app/call/page.tsx`
**Pass:** present and always rendered, not conditional on speech support.
**Then MANUAL:** deny microphone permission and complete a full call. `SpeechRecognition` is Chrome-only and fails on accents; a denied mic must not kill the demo.

### T3-D4 · Feature detection — MAJOR
**Run:** `grep -n "webkitSpeechRecognition\|SpeechRecognition\|speechSynthesis" app/call/page.tsx`
**Pass:** both APIs feature-detected with a fallback path, and the webkit prefix handled.

### T3-D5 · Same endpoint as chat — BLOCKER
**Run:** `grep -n "fetch(" app/call/page.tsx`
**Pass:** posts to `/api/checkin` — the identical endpoint `/checkin` uses. This one grep is the whole answer to "do voice and text feed the same model?", so make sure it's true before you claim it.

### T3-D6 · Channel recorded — MAJOR
**Run:** complete a call, then `select channel from checkins order by created_at desc limit 1;`
**Pass:** `call_sim`.

### T3-D7 · Honest labelling — BLOCKER
**Run:** `grep -n "Simulated" app/call/page.tsx`
**Pass:** "Simulated IVRS — no telephony" is rendered on screen and visible. Saying it costs nothing; being caught not saying it costs everything.

### T3-D8 · State machine is testable — MAJOR
**Run:** `npm run test -- call`
**Pass:** the flow is tested without a microphone. If every test needs real speech input, the flow isn't a state machine and you can't verify it before Day 5.

---

## Gate E — deploy and fallback

### T3-E1 · Production env vars complete — BLOCKER
**Run:** list Vercel production env vars.
**Pass:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, `STAFF_PASSCODE` all set for **Production**, not just Preview.

### T3-E2 · Deployed build is current — BLOCKER
**Run:** compare the deployed commit SHA against `git rev-parse HEAD` on `main`.
**Pass:** identical.

### T3-E3 · Full path on the deployed URL — BLOCKER
**Run:** on production: `/call` → complete → `/staff` → open the person → disposition.
**Pass:** works end to end. Localhost passing proves nothing.

### T3-E4 · Fallback video exists — BLOCKER, deadline Day 4 18:00
**Run:** confirm the file exists and plays.
**Pass:** one unbroken take on the **deployed** URL — `/call`, speak, hang up, `/staff`, alert visible, open person, trend spikes, breakdown visible, disposition. Plus a second short clip of typing a crisis phrase and resources appearing instantly.
**Then:** confirm it is on **two laptops and a phone**. A video on one machine that then fails to boot is not a fallback.

### T3-E5 · Demo survives no internet — MAJOR
**Run:** disconnect Wi-Fi and open `/call`.
**Pass:** the panic key still surfaces resources locally. Everything else may fail; that path must not.

### T3-E6 · Reset in one command — MAJOR
**Run:** `npm run seed` between two rehearsals.
**Pass:** clean state in under 10 seconds. You will need this between the judging rounds, under time pressure, with people watching.
