---
description: Audit the current branch against the 10 hard rules in CLAUDE.md.
allowed-tools: Bash(git diff:*), Bash(git status:*), Bash(git log:*), Read, Grep, Glob
---

Audit the diff on this branch against the ten hard rules in `CLAUDE.md`.
A PR violating any of them does not merge. Report only — do not fix.

## Scope

```
git diff --name-only main...HEAD
```

If `main` does not exist or there are no commits yet, fall back to
`git status --porcelain` and audit the working tree instead. Say which you used.

Read every changed file. Judge the **code as it now stands**, not the diff
hunks alone — a rule can be broken by what a change enables.

## The ten rules, and what a violation looks like

1. **Crisis detection is deterministic.** A lexicon match in
   `lib/safety/lexicon.ts` or a keypad press — never an LLM prompt, call, or
   output. *Violation:* any crisis/CRITICAL decision downstream of a model
   response, or a prompt string asking the model to detect risk.
2. **The interlock runs twice** — on user input before any model call, and on
   model output before it reaches a person. *Violation:* a path that calls the
   LLM without a preceding `checkInput`, or returns model text without
   `checkOutput`. Removing the second one is the classic regression.
3. **The LLM never writes safety-critical text.** Crisis messages, resource
   lists, and consent language come from `lib/safety/replies.ts`. *Violation:*
   any crisis string, helpline, or consent sentence built from model output or
   hardcoded outside that file.
4. **The LLM may raise a tier, never lower one, and is never the sole cause of
   CRITICAL.** Only a human closes a CRITICAL. *Violation:* a `Math.min`,
   downgrade, or model-only path to CRITICAL; any automated CRITICAL close.
5. **Non-response never lowers a score.** Missed check-ins escalate.
   *Violation:* a null/missing check-in decaying a score downward.
6. **No PII anywhere** — no name, phone, email, address, or real case number in
   the DB, seed data, fixtures, or repo. Personas are `A-4471`-style.
   *Violation:* a realistic personal name or contact detail in any fixture,
   migration, or test. Flag every instance individually.
7. **Never report accuracy.** Base rate ~0.5%. *Violation:* the word "accuracy"
   as a reported metric, or any percentage-correct figure, in eval output, UI,
   or docs. Recall on seeded criticals and per-language slices only.
8. **Never render a composite without its component breakdown.** *Violation:* a
   component rendering `composite` with no S1–S5 breakdown alongside it.
9. **S5 acoustic is weighted 0.0, intentionally.** *Violation:* a non-zero S5
   weight, or S5 removed as "dead code". Displaying it with a caveat is correct.
10. **Any minor indicator routes to a human workflow.** *Violation:* a minor
    case scored, auto-tiered, or auto-closed without a human step.

## Output

One line per violation, ranked most severe first:

```
<file>:<line>  RULE <n>  <what the code does>  →  <which clause it breaks>
```

Quote the offending line. If a rule is arguably but not clearly broken, put it
in a separate **Uncertain** section with your reasoning — do not pad the
confirmed list.

Finish with the rules you actively checked and found clean, so the reader knows
what was covered rather than merely unmentioned. Also flag any change that
crosses the ownership table in `CLAUDE.md` (see `/lane`).
