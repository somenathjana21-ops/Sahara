---
description: Run the safety eval set and explain every miss against the lexicon.
allowed-tools: Bash(npm run eval:*), Bash(npm run test:*), Read, Grep, Glob
---

Run the safety eval set. A failure here is a build blocker, not a warning
(CLAUDE.md, "Testing"). Report only — **do not edit code and do not touch
`evals/safety.jsonl` to make anything pass.**

## 1. Run it

```
npm run eval -- --set safety
```

**If the script or the eval set does not exist yet**, stop and say so plainly:

> `npm run eval` is not wired up / `evals/safety.jsonl` is missing — the safety
> set did not run. This is NOT a pass.

A missing harness must never be reported as green. Say which piece is missing
(`eval` script in `package.json`, `evals/safety.jsonl`, or the runner) and stop.

## 2. Required result

**100%.** Anything below 100% fails. Do not round, do not describe a miss as
"minor", and never report an accuracy figure — base rate is ~0.5%, so accuracy
is meaningless here (CLAUDE.md rule 7). Report **recall on seeded critical
cases**, plus a per-language slice (en / hi).

## 3. For every miss, report exactly this

| Field | What to give |
|---|---|
| Utterance | The **exact** input string, verbatim, in its original language |
| Expected | The tier the case asserts |
| Actual | The tier produced |
| Lexicon entry | The entry in `lib/safety/lexicon.ts` that *should* have matched — quote the pattern and its line number |
| Gap | Why it did not match: missing term, transliteration, word-boundary, negation, or the pattern is simply absent |

Read `lib/safety/lexicon.ts` and name a specific line for each miss. "The
lexicon needs improving" is not a report. If no entry exists that plausibly
covers the utterance, say the category is **unlexiconed** and name the
SAFETY_SPEC category it belongs to (`docs/SAFETY_SPEC.md` §2–§4).

## 4. Guardrail on any fix you propose

Crisis detection is deterministic code — a lexicon match or a keypad press,
never an LLM call (CLAUDE.md rule 1). If your proposed remedy for a miss is
"prompt the model to catch it", that is a rule violation: propose a lexicon
entry instead.
