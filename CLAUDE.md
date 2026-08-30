# Project: SIH 26094 — Dynamic Distress Monitoring (MVP)

Next.js 15 App Router · TypeScript · Tailwind · Supabase · deployed on Vercel.
Five-day hackathon MVP. Simplicity beats completeness.

## What this system does

Takes a check-in from a victim of an atrocity (chat or a simulated voice call),
scores distress, and routes rising risk to a human counsellor with an explanation.

## What this system does NOT do

It does not counsel, advise, diagnose, reassure, or handle a crisis itself.
Every path terminates at a human. If a task seems to need the AI to give
emotional support or safety advice, STOP and ask — that is a scope violation.

## Hard rules — a PR violating any of these does not merge

1. **Crisis detection is deterministic code.** A lexicon match in
   `lib/safety/lexicon.ts`, or a keypad press. It is NEVER an LLM prompt,
   an LLM call, or a model output. Prompts can be talked out of things; regex cannot.
2. **The interlock runs twice** — on user input before any model call, and on
   the model's output before it reaches a person. Never remove the second one.
3. **The LLM never writes safety-critical text.** Crisis messages, resource
   lists, and consent language come from `lib/safety/replies.ts`, a fixed file.
4. The LLM may **raise** a tier. It may never be the sole cause of Critical and
   may never lower a tier. Only a human closes a Critical.
5. **Non-response never lowers a score.** Missed check-ins escalate.
6. **No PII, anywhere.** No name, phone, email, address, or real case number in
   the database, the seed data, the fixtures, or the repo. Personas are
   `A-4471`-style pseudonyms. If you are about to write a realistic-looking
   Indian name into a fixture, stop.
7. **Never report "accuracy."** Base rate is ~0.5%. Report recall on seeded
   critical cases and per-language slices.
8. **Never render a composite score without its component breakdown.** The
   breakdown IS the explainability feature.
9. **S5 acoustic is weighted 0.0 and that is intentional** — not a bug, not dead
   code. Acoustic emotion inference fails hardest on the accents of the most
   marginalised users. Display it with a caveat; never score it.
10. Any minor indicator routes to a human workflow. No automated scoring.

## Ownership — do not edit outside your area

| Path | Owner |
|---|---|
| `lib/**`, `app/api/**`, `evals/**`, `policy/**` | TM1 |
| `app/(public)/**`, `components/ui/**`, `app/globals.css`, `tailwind.config.ts` | TM2 |
| `app/(staff)/**`, `app/call/**`, `supabase/**`, `scripts/seed.ts` | TM3 |
| `scripts/fixtures.ts` | TM1 |
| `types/contract.ts` | TM1 — **FROZEN**, propose changes in the PR description |

If a change requires touching another owner's directory, say so and stop.
Do not refactor across these lines "for consistency."

## Conventions

- All API inputs and outputs use the types in `types/contract.ts`. Do not define
  parallel local interfaces for the same objects.
- Server-only secrets (`SUPABASE_SERVICE_ROLE_KEY`, `LLM_API_KEY`) are read in
  route handlers only. Never in a client component. Never prefixed `NEXT_PUBLIC_`.
- LLM calls go through `lib/llm/index.ts`. Never import a provider SDK directly
  from a route.
- Every assessment row records `policy_version` and `model_version`.
- Every read of person-level data on the staff side writes an `audit_events` row.
- Tailwind only, using the tokens in `app/globals.css`. No inline hex colors,
  no new color values, no additional CSS files.

## Before starting any task

State which section of `docs/00_MVP_PLAN.md` or `docs/SAFETY_SPEC.md` your change
implements. If you can't name one, ask before writing code.

## Testing

`npm run test` must pass. `npm run eval -- --set safety` must be **100%** —
any failure is a build blocker, not a warning. If the safety eval fails, fix the
code. Do not edit `evals/safety.jsonl` to make it pass.

## Scope discipline

This is a 5-day MVP. Prefer the boring solution. Do not add: auth providers,
state management libraries, ORMs, background job queues, websockets, or a
component library. If you find yourself installing a dependency to solve a
problem a 20-line function would solve, don't.
