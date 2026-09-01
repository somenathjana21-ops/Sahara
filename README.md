# SIH 26094 — Dynamic Distress Monitoring (MVP)

A check-in from a victim of an atrocity arrives by chat or by a simulated IVRS
call screen. The system scores distress from deterministic signals, applies a
versioned policy to produce a risk tier, and routes rising risk to a human
counsellor together with the component breakdown that explains the score. It
does not counsel, advise, diagnose, or handle a crisis — crisis detection is
regex against a fixed lexicon, safety-critical text comes from a fixed file, and
every path terminates at a human being. Next.js 15 (App Router) · TypeScript ·
Tailwind · Supabase · Vercel.

**Deployed:** <https://sahara-ruddy.vercel.app>

This URL is **not a secret** — it is a public production URL, and it belongs in
the repo precisely so nobody has to be asked for it. Two checks in
[`docs/CHECKS_TM1.md`](docs/CHECKS_TM1.md) target it by name (T1-B0, the stub
failing closed, and T1-F3, deployed-not-local), and both previously stalled on
"needs a human to supply the URL". **Keep it current.** If the deployment moves,
change it here in the same commit — a stale URL here is worse than none, because
a check will pass or fail against the wrong origin without saying so.

**Production must set `PROJECT_TZ=Asia/Kolkata`** as a Vercel Project
Environment Variable, not in `.env.local`. It is `PROJECT_TZ` and not `TZ`
because Vercel reserves the name `TZ` and will not let you create it — the
runtime stays UTC, so the +05:30 is applied to the instant instead, by
`getTodayIST()` in [`lib/scoring/components.ts`](lib/scoring/components.ts).
That matters because S3's time-windowed rows are scored against the IST calendar
date, and between 00:00 and 05:30 IST a UTC reading lands on the previous day and
can drop both rows at once. `PROJECT_TZ` is the declaration that this deployment
is on the IST calendar, and `loadPolicy()` refuses to load without it rather than
score a date nobody has vouched for — see `assertTimezonePinned` in
[`lib/policy/engine.ts`](lib/policy/engine.ts).

Architecture, scoring, and policy are **not** explained here. See
[`docs/00_MVP_PLAN.md`](docs/00_MVP_PLAN.md),
[`docs/SAFETY_SPEC.md`](docs/SAFETY_SPEC.md), and
[`docs/SCORING_AND_POLICY.md`](docs/SCORING_AND_POLICY.md). Read
[`CLAUDE.md`](CLAUDE.md) before your first commit — the ten hard rules there are
merge blockers.

---

## Prerequisites

| | |
|---|---|
| **Node** | 22 or newer (`node -v`). The test harness uses `globSync` from `node:fs`, which does not exist before 22. |
| **npm** | 10 or newer, ships with Node 22. |
| **Supabase project** | One shared project for the team. TM3 creates it — ask for the URL and service role key rather than making your own. |
| **LLM API key** | Groq is the primary provider (free tier, high daily ceiling). Gemini and OpenRouter are supported alternatives. |

You do **not** need the Supabase CLI, Docker, or a telephony account.

---

## Clone to running

```bash
git clone <repo-url> mvp
cd mvp
npm ci
cp .env.example .env.local
```

Fill in `.env.local` (see the table below), then:

```bash
npm run seed
npm run dev
```

Open http://localhost:3000. The staff dashboard is at `/staff` and asks for
`STAFF_PASSCODE`; the simulated call screen is at `/call`.

If the Supabase project is brand new and nobody has applied the schema yet, do
that once before seeding: open the Supabase dashboard → **SQL Editor**, paste
[`supabase/schema.sql`](supabase/schema.sql), and run it top to bottom. To wipe
and start over, run [`supabase/reset.sql`](supabase/reset.sql) the same way.

---

## Environment variables

All six are **server-only**. Never prefix one with `NEXT_PUBLIC_`, never read one
from a client component, and never paste the service role key into the group
chat.

| Variable | Where to get it |
|---|---|
| `SUPABASE_URL` | Supabase dashboard → **Project Settings → API → Project URL**. |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page → **Project API keys → `service_role`**. Bypasses RLS, so it stays on the server. |
| `LLM_PROVIDER` | One of `groq`, `gemini`, `openrouter`. Use `groq` unless you are testing the provider swap. |
| `LLM_API_KEY` | Groq: https://console.groq.com/keys. Gemini: https://aistudio.google.com/apikey. OpenRouter: https://openrouter.ai/keys. |
| `LLM_MODEL` | The provider's model id, e.g. a Llama model on Groq. Ask TM1 for the id currently pinned in `policy/`. |
| `STAFF_PASSCODE` | Invent one and share it with the team. It is the only staff auth — one passcode, checked server-side, set as an httpOnly cookie. |

`.env.local` is gitignored. `.env.example` is committed and must never contain a
real value.

---

## Seeding

```bash
npm run seed
```

Seeds the golden-path persona `A-4471` and the supporting fixtures. It is
idempotent — running it twice leaves a clean database, not duplicates — so use it
to reset between rehearsals. It prints the golden-path person's UUID at the end;
you will need that UUID to POST check-ins by hand.

All personas are pseudonyms. There is no PII anywhere in the seed data, the
fixtures, or the database, and there must never be.

---

## Tests and evals

```bash
npm run test
```

Runs every `*.test.ts` in the repo. Narrow it by path substring:
`npm run test -- scoring`, `npm run test -- interlock`, `npm run test -- call`.

```bash
npm run eval -- --set safety
```

Must be **100%**. Any miss is a build blocker, not a warning — fix the code, and
never edit `evals/safety.jsonl` to make it pass. `--set dev` prints the confusion
matrix and per-language recall. Never report "accuracy": the base rate is ~0.5%.

`--provider` selects the model (`groq`, `gemini`, `openrouter`, `ollama`) or
`none`. The safety set needs no model at all — crisis detection is deterministic
code — so it runs with `none` and passes with no API key configured.

> **Current state:** `npm run eval` is wired up and all three sets are in
> `evals/`. `npm run seed` is still specified throughout the docs but is not in
> `package.json` yet — it is TM3's Day 1 task, and until it lands that command
> fails. That is intended: the pipeline is written against the finished
> contract, not the current state.

---

## Running the three CHECKS files

[`docs/CHECKS_TM1.md`](docs/CHECKS_TM1.md),
[`docs/CHECKS_TM2.md`](docs/CHECKS_TM2.md), and
[`docs/CHECKS_TM3.md`](docs/CHECKS_TM3.md) are verification suites, one per
owner. They are run by an agent, not by a shell script. Open Claude Code in the
repo root and paste the one line for your area:

```
Run every check in docs/CHECKS_TM1.md, top to bottom. Report only. Fix nothing.
```

```
Run every check in docs/CHECKS_TM2.md, top to bottom. Report only. Fix nothing.
```

```
Run every check in docs/CHECKS_TM3.md, top to bottom. Report only. Fix nothing.
```

The agent runs every check even after a failure, fixes nothing as it goes, and
ends with a results table and a `SHIPPABLE` / `NOT SHIPPABLE` verdict. Any
failing BLOCKER means NOT SHIPPABLE — there is no "nearly there". Collect the
report first, then decide what to fix.

Four slash commands in `.claude/commands/` cover the narrower loops: `/safety`
(run the safety eval and explain every miss), `/goldenpath` (seed and assert the
demo numbers), `/arch` (audit against the ten hard rules), `/lane` (flag changed
files outside your CODEOWNERS paths).

---

## Before you touch anything

Ownership is one owner per directory and is enforced by
[`.github/CODEOWNERS`](.github/CODEOWNERS). If a change requires editing another
owner's directory, say so and stop — do not refactor across those lines for
consistency. `types/contract.ts` is frozen; propose changes in the PR
description. Your guide is `docs/TM1_GUIDE.md`, `docs/TM2_GUIDE.md`, or
`docs/TM3_GUIDE.md`.
