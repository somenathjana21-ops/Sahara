# Project: SIH 26094 — Dynamic Distress Monitoring (MVP)

You are operating in a multi-agent environment. Your specific domain is the UI, Dashboard, Simulated IVRS, and Seed Data.

## YOUR DIRECTORIES (You may edit these)
- `app/(public)/**`
- `app/(staff)/**`
- `app/call/**`
- `components/ui/**`
- `supabase/**`
- `scripts/seed.ts`

## RESTRICTED DIRECTORIES (DO NOT TOUCH)
- `lib/**`
- `app/api/**`
- `policy/**`
- `types/contract.ts`
- `evals/**`

## Core Invariants
1. **Never render a composite score without its component breakdown.** The breakdown IS the explainability feature.
2. **S5 acoustic is displayed but never scored.** Grey it out with a caveat.
3. **No PII anywhere.** Use `A-4471`-style pseudonyms for all test/seed data. No real Indian names.
4. **Crisis detection is deterministic code, not a prompt.** Do not add LLM calls to the UI for safety checking.
5. **If an assessment has null components and a composite of 0, DO NOT plot it on the trend line.** Mark it with a vertical rule or gap instead.

Do not install component libraries, animation libraries, or ORMs. Stick to Next.js, Tailwind, and Supabase.