---
description: Seed, POST the D0 check-in, and assert the demo numbers exactly.
allowed-tools: Bash(npm run:*), Bash(npx tsx:*), Bash(curl:*), Read, Grep
---

Reproduce the on-stage golden path end to end and assert every number the demo
narration depends on. Source of truth: `docs/SCORING_AND_POLICY.md` §"Check-in 3
— D0". Report only; do not edit code to make an assertion pass.

## 1. Seed

```
npm run seed
```

(or `npx tsx scripts/seed.ts` if no `seed` script is defined). This must load
persona **A-4471** and the two prior check-ins — D-3 composite 28.00 and D-2
composite 31.00 — which produce the baseline μ = 28.90, σ = 1.64. **If the
baseline rows are missing, the z-score is wrong and every assertion below is
meaningless** — stop and say the seed did not take.

## 2. POST the D0 check-in

```
curl -s -X POST http://localhost:3000/api/checkin \
  -H 'content-type: application/json' \
  -d '{"personId":"11111111-1111-1111-1111-111111111111",
       "consentId":"22222222-2222-2222-2222-222222222222",
       "channel":"chat",
       "structured":{"q1":3,"q2":2,"q3":1}}'
```

The D0 case context also requires the intimidation report and the hearing
inside the 7-day window (S3 = 50 static + 25 intimidation + 15 hearing = 90).
If the seed does not set those, S3 will read 50 and the composite will not
reach 53.75.

## 3. Assert — all of these, exactly

| Assertion | Required value |
|---|---|
| `tier` | **RED** |
| matched rule | `change_point` |
| `change_point` | **true** |
| `composite` | **53.75** (exact, not ~53.8) |
| `z` | **3.11** |
| S3 contribution | **22.50 — the largest single contribution** |
| S1 contribution | 17.50 |
| S2 contribution | 13.75 |
| S4 contribution | 0.00 |
| S5 acoustic | displayed, weighted **0.00 — never scored** |

Raw components: S1 = 50, S2 = 55, S3 = 90, S4 = 0.

S5 at 0.0 is intentional (CLAUDE.md rule 9). If it contributes anything
non-zero, that is a **failure**, not a rounding artefact.

## 4. Print the full breakdown

Print every component — raw score *and* weighted contribution — as a table.
Never print the composite alone: the breakdown **is** the explainability
feature (CLAUDE.md rule 8). Also print `policy_version` and `model_version`
from the assessment row.

## 5. If the route is still the stub

`app/api/checkin/route.ts` currently always returns GREEN and does no scoring.
If you get GREEN with no breakdown, report it as **"not built yet — golden path
unverified"**, list which of the assertions above could not be evaluated, and
stop. Do not describe a stub response as a pass.
