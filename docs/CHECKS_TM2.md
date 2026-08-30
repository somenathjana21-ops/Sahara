# CHECKS — TM2 (Public Site & Design System)

> **Usage:** paste into Claude Code —
> `Run every check in docs/CHECKS_TM2.md, top to bottom. Report only. Fix nothing.`

---

## Instructions to the agent

You are **verifying**, not building.

1. Work top to bottom. Run **every** check, including ones after a failure.
2. Use the exact command given. Do not substitute a different method, and do not reason about whether a check "would probably pass."
3. **Fix nothing while running.** Collect everything, report, then wait to be told what to fix.
4. Record `PASS` / `FAIL` / `BLOCKED` / `MANUAL` with **actual evidence** — command output, `file:line`, or the grep hit. Never record PASS without evidence.
5. Several checks here are visual. For those, do the mechanical part you can, then mark `MANUAL` and state precisely what the human must look at. Do not guess.

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

## Gate A — repo hygiene

### T2-A1 · No secrets in client code — BLOCKER
**Run:** `grep -rln "'use client'" app components | xargs -r grep -n "SERVICE_ROLE\|LLM_API_KEY\|STAFF_PASSCODE"`
**Pass:** no output.

### T2-A2 · No direct database access from the browser — BLOCKER
**Run:** `grep -rn "createClient\|supabase" app/\(public\) components/`
**Pass:** no output. The public side talks only to `/api/*`.

### T2-A3 · Build succeeds — BLOCKER
**Run:** `npm run build`
**Pass:** exit code 0, zero TypeScript errors.

### T2-A4 · Types imported, not redefined — MAJOR
**Run:** `grep -rn "interface CheckInRequest\|interface CheckInResponse\|type Tier\s*=" app/\(public\) components/`
**Pass:** no output. Everything comes from `types/contract.ts`.

### T2-A5 · Stayed in your lane — MAJOR
**Run:** `git diff --name-only main...HEAD`
**Pass:** every path is under `app/(public)/`, `components/ui/`, `app/globals.css`, or `tailwind.config.ts`. Report any file outside those.

### T2-A6 · No banned dependencies — MINOR
**Run:** `git diff main...HEAD -- package.json`
**Pass:** no additions. Flag by name anything added — especially a component library, an animation library, or a form library.

### T2-A7 · No browser storage — MAJOR
**Run:** `grep -rn "localStorage\|sessionStorage" app components`
**Pass:** no output. Language state lives in the URL param.

---

## Gate B — the crisis path (every one is a BLOCKER)

### T2-B1 · Crisis panel renders synchronously
**Run:** `npm run test -- crisis`
**Pass:** a test mocks a `tier: 'CRITICAL'` response and asserts `CrisisPanel` is in the DOM on the **very next render** — no `waitFor`, no timer, no second fetch. If the test uses `waitFor`, that is a FAIL: it proves the panel is not synchronous.

### T2-B2 · Crisis panel does not depend on a later fetch
**Run:** read the `/checkin` page and report the code path from response → panel.
**Pass:** the panel renders from `response.resources` directly. No `useEffect` fetching resources, no loading state between the response and the panel.

### T2-B3 · Helpline number in first paint
**Run:** `curl -s <deployed-url>/ | grep -o "14566\|14416"`
**Pass:** at least one match in the raw server HTML. It must be readable before any JavaScript runs.

### T2-B4 · "Talk to a person" is always reachable
**Run:** `grep -rn "Talk to a person\|talk_to_person\|TalkToPerson" app/\(public\)/layout.tsx`
**Pass:** present in the **layout**, not per-page. Then `MANUAL`: confirm at 360px width it is visible without scrolling on `/`, `/consent`, and `/checkin`.

### T2-B5 · Crisis colour is reserved
**Run:** `grep -rn "alert\b\|--alert\|text-alert\|bg-alert" app components | grep -v "CrisisPanel"`
**Pass:** no output. If `--alert` red appears anywhere else, the crisis panel stops meaning anything.

---

## Gate C — design rules

### T2-C1 · No photographs or illustrations of people — BLOCKER
**Run:** `ls -R public/ && grep -rn "<img\|next/image\|<Image" app components`
**Pass:** every image reference is abstract — dots, shapes, textures.
**Then MANUAL:** a human opens each file found in `public/` and confirms it contains no human figure, face, silhouette, or hand. List the filenames for them. This is a legal and tonal rule, not a preference — see `docs/TM2_GUIDE.md` §1.

### T2-C2 · No hardcoded colours — MAJOR
**Run:** `grep -rnE "#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(" app components --include=*.tsx --include=*.ts | grep -v "globals.css"`
**Pass:** no output. Every colour is a token.

### T2-C3 · No colours added to the palette — MAJOR
**Run:** `git diff main...HEAD -- app/globals.css | grep "^+.*--"`
**Pass:** only the tokens listed in `docs/TM2_GUIDE.md` §1. Report any new custom property.

### T2-C4 · TierBadge is not colour-alone — BLOCKER
**Run:** read `components/ui/TierBadge.tsx`.
**Pass:** the component renders a **text label** alongside the colour. Colour-only status fails for colourblind users and dies completely in a printed or photocopied screenshot — which is how these get circulated.

### T2-C5 · Tap targets — MAJOR
**Run:** `grep -n "min-h\|h-\[" components/ui/Button.tsx components/ui/Field.tsx`
**Pass:** base classes enforce at least 48px height. Assume a cracked screen in poor light.

### T2-C6 · Mobile layout — MANUAL
**Do:** open the deployed URL at 360px width. Check `/`, `/consent`, `/checkin`.
**Pass:** no horizontal scroll, no clipped text, thumb reaches every control one-handed. Report anything that overflows.

### T2-C7 · No motion theatre — MINOR
**Run:** `grep -rn "animate-\|transition-\|@keyframes" app/\(public\) components/ui`
**Pass:** transitions on hover/focus only. Flag any pulsing, bouncing, auto-playing, or typing animation. The bot must not pretend to think — it's a check-in, not a friend.

---

## Gate D — consent and copy

### T2-D1 · Voluntariness stated in body text — BLOCKER
**Run:** `grep -rn "does not affect" app/\(public\)/page.tsx`
**Pass:** present, and `MANUAL`: confirm it renders at body size, not as fine print. It must say the check-in does not affect their case, relief, or compensation. This is both a legal point and the single most important trust signal on the page — a judge will look for it.

### T2-D2 · Consent checkboxes default unchecked — BLOCKER
**Run:** `grep -n "defaultChecked\|checked={true}" app/\(public\)/consent/page.tsx`
**Pass:** no output. Three checkboxes, all required, all off by default.

### T2-D3 · Declining is as easy as accepting — BLOCKER
**Run:** read the consent page and compare the class strings on "Continue" and "No, go back".
**Pass:** equal visual weight — same size, same prominence. A consent flow where declining is harder than accepting is not consent, it's a dark pattern, and in this domain that's disqualifying.

### T2-D4 · Consent precedes scoring — BLOCKER
**Run:** read the `/checkin` page.
**Pass:** the page cannot be used without a `consentId`. Landing on `/checkin` with no consent redirects to `/consent`. Verify by loading the URL directly.

### T2-D5 · Language toggle actually works — MAJOR
**Run:** load `/?lang=hi` and `/?lang=en` on the deployed URL.
**Pass:** the visible copy changes. A toggle that flips a flag but renders English either way is a FAIL — it's worse than no toggle, because it claims coverage you don't have.

### T2-D6 · Hindi copy is complete — MAJOR
**Run:** `grep -rn "TODO\|LOREM\|lorem\|Lorem" app/\(public\) components/ui`
**Pass:** no output. Check the Hindi strings specifically; placeholder text in the second language is the most common thing shipped by accident.

---

## Gate E — integration with TM1 and TM3

### T2-E1 · Structured questions match the spec — MAJOR
**Run:** compare the q1/q2/q3 wording and scale in `/checkin` against `docs/SCORING_AND_POLICY.md` §3.
**Pass:** identical text, 0–4 scale, same direction (0 = better, 4 = worse). A reversed scale silently inverts S1 and nobody notices until the demo behaves backwards.

### T2-E2 · q3 "not safe" reaches the API — BLOCKER
**Run:** submit a check-in with `q3 = 4`.
**Pass:** response tier is `CRITICAL` and the crisis panel renders. `q3 = 4` is a deterministic trigger, not a score input.

### T2-E3 · Bot replies stay short — MAJOR
**Run:** send five varied messages through `/checkin` on the deployed URL and record each reply length.
**Pass:** every reply is ≤ 2 sentences and ≤ 320 characters. If any exceeds it, that is TM1's Pass-2 filter failing — report it to them, don't work around it in the UI.

### T2-E4 · UI survives a long reply — MINOR
**Run:** render the chat with a mocked 600-character reply.
**Pass:** no overflow, no layout break. The filter should prevent this, but the UI shouldn't depend on it.

### T2-E5 · Model-down degradation — MAJOR
**Run:** ask TM1 to point `LLM_API_KEY` at garbage, then complete a check-in.
**Pass:** the flow completes with the fallback reply, the crisis path still works, and nothing shows a raw error to the user.

---

## Gate F — before the demo

### T2-F1 · Watch a stranger use it — MANUAL, do this on Day 3
**Do:** hand a phone to someone outside the team. Say nothing. Watch them complete a check-in without help.
**Pass:** they finish without asking a question. Write down every place they hesitate.
Fifteen minutes of this finds more than a day of self-review, and it is the only check here that tests the thing that actually matters.

### T2-F2 · Deployed state matches local — BLOCKER
**Run:** load the Vercel production URL and complete a full check-in.
**Pass:** identical behaviour to localhost. Rehearse against the deployed URL only — demoing from localhost is how teams discover on stage that a production env var was never set.

### T2-F3 · Works on a bad connection — MAJOR
**Run:** devtools, throttle to Slow 3G, load `/`.
**Pass:** the headline and the helpline number are readable within 3 seconds. Your users are not on office Wi-Fi.
