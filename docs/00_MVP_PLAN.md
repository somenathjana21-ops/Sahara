# MVP Build Plan — 5 Days
## SIH 26094 · Dynamic Distress Monitoring

**Read this first. Everyone. Before opening Claude Code.**

---

## 1. What we are building

One Next.js app on Vercel, one Supabase database, one LLM behind a swappable adapter.

Three ways in, one pipeline:

```
  /checkin (chat)  ─┐
  /call (simulated  ├─→  POST /api/checkin  ─→  [ CONSENT GATE ]
   IVRS screen)    ─┘                            [ SAFETY INTERLOCK ]  ← deterministic, pre-LLM
                                                 [ LLM: reply + S2 signal ]
                                                 [ SAFETY INTERLOCK ]  ← again, on LLM output
                                                 [ SCORING: S1..S5, EWMA, z ]
                                                 [ POLICY ENGINE → tier ]
                                                 [ ALERT if Red/Critical ]
                                                        ↓
                                            /staff  (queue · trend · breakdown · disposition)
```

**The `/call` screen is the differentiator and it costs us nothing.** It's a phone-shaped UI that speaks prompts using the browser's built-in `speechSynthesis`, listens using `SpeechRecognition`, and accepts a DTMF keypad. No telephony account, no STT bill, no approval latency. We label it "Simulated IVRS" on screen. Judges get the full call experience; we get zero external dependencies.

## 2. What we are NOT building

Cut, deliberately, and say so on stage: real telephony · SMS · WhatsApp · user accounts or login · email · any PII · NHAA integration · languages beyond Hindi + English · minor flows (route to human, never score) · district/State/national dashboards (one static screenshot from the case taxonomy).

## 3. The rule that governs everything

> **The AI does not decide. It decides who a human looks at next, and why.**

Concretely, and these are not negotiable:

1. Crisis detection is **regex against a lexicon file**. Never a prompt, never a model output.
2. The LLM may **acknowledge and ask**. It may never advise, diagnose, reassure about outcomes, or handle a crisis. Its output is re-checked by the interlock before it reaches a human being.
3. The LLM may **raise** a tier. It can never be the sole cause of Critical, and can never lower a tier.
4. Missing check-ins **raise** risk. Silence is never scored as improvement.
5. No real name, phone, email, or case reference in the database or the repo. Ever.
6. Never show a composite score without its component breakdown.

## 4. Ownership — one owner per directory

| Path | Owner | Others may |
|---|---|---|
| `lib/**`, `app/api/**`, `evals/**`, `policy/**`, `scripts/fixtures.ts` | **TM1** | read only |
| `app/(public)/**`, `components/ui/**`, `app/globals.css`, `tailwind.config.ts` | **TM2** | import components |
| `app/(staff)/**`, `app/call/**`, `supabase/**`, `scripts/seed.ts` | **TM3** | read only |
| `types/contract.ts` | **TM1, frozen after Day 0** | read only |

Set `.github/CODEOWNERS` accordingly. If you need something changed outside your directory, message the owner. Do not let Claude Code "just fix it" — that is how three people produce three incompatible versions of the same object.

## 5. The seam: `types/contract.ts`

TM1 writes this in the first two hours. It is the only file all three people depend on. After Day 0 it is frozen; changes need TM1's sign-off and a message in the group.

Everyone builds against `scripts/seed.ts` fixtures, so TM2 can build the chat UI before scoring exists, and TM3 can build the dashboard before the API is real.

## 6. Five-day schedule

| | TM1 (model + policy) | TM2 (public site) | TM3 (staff + call + data) |
|---|---|---|---|
| **Day 0**<br>(3 hrs, evening) | Repo, `types/contract.ts`, `CLAUDE.md`, API stub returning fixtures, deploy to Vercel | *wait* — read `docs/TM2_GUIDE.md` §Design | Supabase project created, `supabase/schema.sql` applied, keys shared |
| **Day 1** | Safety interlock + lexicon. LLM adapter (Groq). Provider-swap test. | Design tokens, layout shell, landing page | Seed script + golden-path persona. Dashboard queue skeleton |
| **Day 2** | Scoring: S1–S4, EWMA, z-score, change point. `policy/v1.yaml`. | Chat check-in UI wired to real API | Person detail: trend chart + component breakdown |
| **Day 3** | Eval harness. Build dev set (80) + holdout (40). Tune policy on dev only. | Consent flow, crisis resource panel, mobile pass | `/call` simulated IVRS screen |
| **Day 4** | **Holdout run — once.** Escalation + disposition API. | Polish, copy, accessibility | Integration + **record fallback video by 18:00** |
| **Day 5** | **Freeze 12:00.** Rehearse ×5. Deck. Submit. | | |

**Day 4 at 18:00 the fallback video exists or the day doesn't end.** A recorded run of the golden path is what saves you when the Wi-Fi dies on stage.

## 7. The golden path — protect this above everything

One seeded persona. Three check-ins across three days. Flat, flat, spike.

- **Persona A-4471.** Hindi. Land dispossession. Accused on bail, 4th adjournment, relief 62 days overdue — 50 points of standing case pressure, deliberately held under the `s3_gte:60` threshold.
- Day −3: S3 50, composite 28.00 → Green
- Day −2: S3 50, composite 31.00 → Green (μ 28.90, σ 1.64 → floored to 8)
- Day −1: intimidation report filed; hearing (D+6) enters the 7-day window
- Day 0: S3 90, composite 53.75, z 3.11 → change point → **Red**
  Breakdown: S3 22.50 / S1 17.50 / S2 13.75 / S4 0.00

Ninety seconds. It proves dynamic monitoring, prediction, explainability, and escalation at once.

**Rules:** it is seeded by `scripts/seed.ts`, it is re-runnable with one command, it is rehearsed against the deployed Vercel URL and not localhost, and nothing merges on Day 4 or 5 that touches code it runs through.

## 8. Demo order (7 minutes)

1. Golden path on the dashboard — the trend line and the breakdown (90s)
2. Point at S3: "the strongest signal isn't the voice, it's the court calendar." Back it with the numbers — S3 contributes 22.50, more than her self-report (17.50) and more than the language model (13.75). Then: the hearing is six days out and the intimidation report was filed yesterday. She is flagged BEFORE the hearing. (60s)
3. Live `/call` — speak into it, watch the score land on the dashboard (90s)
4. Type a crisis phrase → crisis resources surface **instantly**, before any model call. Show the code. (60s)
5. Model swap: change one env var, same eval set, comparison table (45s)
6. Limitations slide (45s)

## 9. Questions you will be asked

| Q | A |
|---|---|
| "What's your accuracy?" | We don't report it. Crisis base rate is ~0.5%, so "always fine" scores 99.5%. We report recall on seeded critical cases and per-language slices. |
| "Do voice and text use the same model?" | Yes — both normalise to one CheckIn before scoring. Here's the same code path. |
| "What if the LLM says something harmful?" | It can't reach the user unchecked. The interlock runs on its output too, and safety-critical text comes from a fixed bank, not the model. |
| "Isn't emotion-from-voice unreliable?" | Yes, worst for the accents of the most marginalised callers. We extract it, display it with a caveat, and weight it **zero**. |
| "Did you use real victim data?" | No. The corpus is synthetic. Public case records were used only to build the atrocity-category taxonomy, de-identified. |
| "Your LLM is on a free tier — isn't that a privacy problem?" | It would be with real data. Free tiers may train on inputs, which is exactly why this system never sends real data through one. Production would use a paid or self-hosted endpoint. |
| "Isn't it just a chatbot?" | The chat is one of three inputs. The product is the scoring, the change-point detection, and the escalation. Here's the dashboard. |

## 10. Documents in this bundle

| File | Owner | Everyone reads? |
|---|---|---|
| `docs/00_MVP_PLAN.md` | TM1 | **Yes** |
| `CLAUDE.md` | TM1 | Goes in repo root; Claude Code reads it automatically |
| `docs/SAFETY_SPEC.md` | TM1 | **Yes** |
| `docs/SCORING_AND_POLICY.md` | TM1 | TM3 needs it for the breakdown chart |
| `supabase/schema.sql` | TM3 | **Yes** — it's the contract |
| `docs/TM1_GUIDE.md` | TM1 | |
| `docs/TM2_GUIDE.md` | TM2 | TM3 reads the Design section |
| `docs/TM3_GUIDE.md` | TM3 | |

## 11. Daily ritual

10 minutes, start of day, three questions each: what's merged, what's blocked, what am I about to touch that isn't mine. That last one prevents most of the pain.

`main` must stay deployable. If `main` is red, that is everyone's emergency, not the breaker's problem.
