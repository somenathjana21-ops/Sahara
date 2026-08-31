# Scoring & Policy Specification — v1.1

**Owner: TM1. TM3 must read §2, §5 and §9.**

A judge should be able to recompute a score by hand from this document. If they can't, it isn't explainable.

> **v1.1 corrects §7, §8 and §9.** The v1.0 worked example contradicted §5's own rubric and produced a golden path that was arithmetically impossible. See `docs/FIXES_AND_PROMPTS.md` §1.

---

## 1. Why additive and interpretable

The problem statement mandates Explainable AI. A trained black-box classifier cannot satisfy that without bolting on post-hoc explanation machinery you don't have time to build and can't defend.

An additive composite of five named components explains itself: every alert shows what contributed and by how much. **The interpretability is not a limitation we're accepting — it is the feature.**

---

## 2. The composite

```
composite = 0.35·S1 + 0.25·S2 + 0.25·S3 + 0.15·S4 + 0.00·S5
```

Each component is 0–100. Composite is 0–100.

| | Component | Weight | Source |
|---|---|---|---|
| S1 | Self-report | 0.35 | 3 structured questions, tap or keypad |
| S2 | Linguistic distress | 0.25 | LLM, from transcript |
| S3 | **Case context** | 0.25 | Deterministic, from the `cases` row |
| S4 | Engagement | 0.15 | Missed check-ins, latency, abandonment |
| S5 | Acoustic / paralinguistic | **0.00** | Extracted, displayed with caveat, **never scored** |

**S5's zero is deliberate and is a talking point, not an omission.** Acoustic emotion inference degrades sharply across accent, dialect, gender and recording conditions — meaning it is least accurate for the most marginalised callers, which is precisely backwards for this population. We compute it, show it to the counsellor labelled low-confidence, and give it no influence. Put a comment in the code saying so, or someone will "fix" it.

---

## 3. S1 — Self-report

Three questions, 0–4 each. Asked by tap on `/checkin`, by keypad on `/call`.

| ID | Question | Scale |
|---|---|---|
| q1 | How have you been feeling since we last spoke? | 0 = much better … 4 = much worse |
| q2 | How much has this been affecting your sleep and eating? | 0 = not at all … 4 = a great deal |
| q3 | Do you feel safe right now? | 0 = yes … 4 = no |

`S1 = (q1 + q2 + q3) / 12 × 100`

**q3 = 4 is a Critical trigger on its own** (SAFETY_SPEC §3). It does not go through the composite.

---

## 4. S2 — Linguistic, and the nullable components

Comes back from the LLM as `s2_score` with `markers` and `evidence`. If the provider is unavailable, `S2 = null` and the composite is renormalised over the remaining weights. Never default it to 0 — a missing signal is not a calm signal.

**S2 is not the only nullable component. S1 is too, and for the same reason.**

`checkins.structured` defaults to `'{}'`, and a call or a chat can be abandoned **before the first structured answer** — the keypad flow on `/call` ends when the line drops, not when the person has answered q1. When no question was answered, `S1 = null`. When some were, S1 renormalises over the questions actually answered: `sum / (answered × 4) × 100`, not `sum / 12 × 100`, so two answers of 2 read as 50 and not as 33.

Substituting 0 for an unanswered S1 would put the words "much better, not at all, yes I feel safe" in the mouth of someone who said nothing at all. That is a worse failure than the S2 case, because S1 carries the largest weight in the composite.

**Renormalisation raises the composite; it does not lower it.** The remaining weights are scaled up over a smaller denominator, so the components that *are* present carry proportionally more. Worked: with S2 missing the denominator is 0.75, and S1 = 95 / S3 = 55 / S4 = 50 gives 72.67 — Red — where substituting 0 for S2 would give 54.50 and Amber. This is deliberate and is the same direction as §6: **a person who stops answering does not thereby look calmer.** Silence in the engagement signal escalates, and silence in the self-report signal must not quietly de-escalate what remains.

Which components may be null:

| | Nullable | When |
|---|---|---|
| S1 | **yes** | abandoned before the first structured answer |
| S2 | **yes** | LLM provider unavailable, or output failed schema validation |
| S3 | no | deterministic from the `cases` row; always computable |
| S4 | no | deterministic from the `persons` row; always computable |
| S5 | **yes** | no audio on the channel — every `chat` check-in. Weight is 0.00 either way |

Because S3 and S4 can always be computed, the renormalisation denominator never falls below 0.40 and a composite always exists. If it ever reaches 0, that is a bug and the code throws rather than reporting a composite of 0.

---

## 5. S3 — Case context (build this first, demo it loudest)

The problem statement's own background names the stressors: threats, intimidation, repeated court appearances, delays in investigation and trial, social ostracism, economic hardship. Every one of those is **knowable from a case record and a calendar.** No NLP, no voice parsing, no model.

```
S3 = min(100, sum of the applicable rows below)
```

| # | Condition | Points | Kind | Rationale |
|---|---|---|---|---|
| 1 | Intimidation report filed in the last 14 days | **+25** | **time-windowed** | Strongest single predictor; a direct pre-crisis signal |
| 2 | Accused released on bail | +20 | static | Named in the PS background; the fear is concrete |
| 3 | Next hearing within 7 days | +15 | **time-windowed** | Anticipatory distress is measurable and predictable |
| 4 | Relief instalment overdue > 30 days | +15 | static | Economic hardship, and it compounds daily |
| 5 | Adjournment count ≥ 3 | +10 | static | "Delays in investigation and trial" — the grinding one |
| 6 | Social boycott flag on the case | +10 | static | Isolation removes the buffer everything else depends on |
| 7 | Case open longer than 365 days | +5 | static | Duration alone wears people down |

**The `kind` column is load-bearing.** Rows 1 and 3 change on their own as the calendar advances; the rest change only when someone edits the case file. **S3 moving over time is entirely down to rows 1 and 3**, and the golden path in §9 depends on that. Any demo persona whose S3 never moves has no story.

**S3 is computed at check-in time and frozen into `assessments.components`.** The `cases` row holds current state only. Never recompute a historical S3 from today's case row — it will be wrong, and the trend chart will lie.

This is the centrepiece of the pitch: more predictive than parsing a distressed person's voice, trivially explainable, needs no training data, and **no other team will have it.**

---

## 6. S4 — Engagement

| Condition | Points |
|---|---|
| 1 missed scheduled check-in | +25 |
| 2 missed | +50 |
| 3+ missed | +75 and force minimum tier Amber |
| Call or chat abandoned mid-flow | +20 |
| Response latency > 3× this person's own median | +15 |

**S4 can only increase.** Silence can mean recovery, a lost phone, coercion preventing contact, or crisis. Scoring it as improvement is the failure mode that gets people killed. Write a test asserting three missed check-ins never lower a composite.

---

## 7. Per-person baseline — this is what "Dynamic" means

Population thresholds systematically under-flag reserved people and over-flag expressive ones. A stoic person's small change carries more information than a demonstrative person's large absolute value.

```
Initialisation (first check-in):
  μ₀  = x₀            ← the first composite becomes the baseline
  σ²₀ = 0
  z is undefined. Use the first-contact floor instead.

Subsequent check-ins:
  z_t  = (x_t − μ_(t−1)) / max(σ_(t−1), 8)        ← compute FIRST
  μ_t  = 0.3 · x_t + 0.7 · μ_(t−1)                  (λ = 0.3)
  σ²_t = 0.3 · (x_t − μ_(t−1))² + 0.7 · σ²_(t−1)
```

**Order matters and this is the easy bug.** `z_t` is measured against the baseline *before* this check-in updates it. If you update μ first, every deviation gets partly absorbed into the thing you're measuring against, and large spikes read as smaller than they are — the exact direction you cannot afford to be wrong in.

The `max(σ, 8)` floor stops a person with a flat history from tripping on trivial noise. In §9 the true σ is 1.64, so the floor is doing all the work — which is what it's for, and worth saying aloud if a judge asks how you handle three data points.

**Change point** fires when `z > 2.0` AND the person has ≥ 2 prior check-ins. This is PRD feature #4, "sudden-shift detection": a deviation test against the person's own history, not a threshold crossing.

**First-contact floor:** with no baseline, a raw composite ≥ 60 assigns at least Amber. Otherwise a first-time caller in genuine distress reads as "no deviation" and gets nothing.

---

## 8. `policy/v1.yaml`

```yaml
version: "1.1.0"
signed_by: "TM1"

weights:
  s1_self_report: 0.35
  s2_linguistic:  0.25
  s3_case_context: 0.25
  s4_engagement:  0.15
  s5_acoustic:    0.00

baseline:
  ewma_lambda: 0.3
  sigma_floor: 8
  change_point_z: 2.0
  min_history_for_change_point: 2

tiers:
  # evaluated top to bottom, first match wins
  - tier: RED
    any_of:
      - change_point: true
      - composite_gte: 70
      - s3_gte: 60
  - tier: AMBER
    any_of:
      - composite_gte: 45
      - z_gte: 1.2
      - first_contact_composite_gte: 60
      - missed_checkins_gte: 3
  - tier: GREEN
    default: true

floors:
  model_may_lower_tier: false
  critical_requires_deterministic_trigger: true

escalation:
  CRITICAL: { ack_required: true,  sla_minutes: 0,     immediate_resources: true }
  RED:      { ack_required: true,  sla_minutes: 30 }
  AMBER:    { ack_required: false, sla_minutes: 1440 }
  GREEN:    { ack_required: false, sla_minutes: 10080 }   # 7 days
```

> **Two traps in this file.**
>
> **`GREEN` was missing in v1.0** while `QueueItem.slaMinutes` is required, which forced the fixture to invent 1440. Now explicit at 7 days.
>
> **`s3_gte: 60` is load-bearing and easy to break.** It escalates a case whose *file* is alarming even when the person says they're fine — which is the entire point of S3. It also means **any persona must keep S3 under 60 during its flat baseline**, or your GREEN check-ins come back RED. §9 respects this. Check every new persona against it.

---

## 9. Worked example — the golden path

Persona **A-4471**. Land dispossession, trial stage.

**Standing case pressure (static rows):** accused on bail +20, relief 62 days overdue +15, 4 adjournments +10, case open 400 days +5 = **50**. Under the 60 threshold, so it does not fire RED on its own.

**The moving parts:** the intimidation report is filed on **D−1**, and the hearing on **D+6** enters the 7-day window on **D−1**. Both time-windowed rows flip on the same night.

### Check-in 1 — D−3

```
q1=1, q2=1, q3=1  →  S1 = 3/12 × 100                    = 25
S2 (LLM)                                                 = 27
S3 = 50 static; no intimidation, hearing 9 days out      = 50
S4                                                       = 0

composite = 0.35(25) + 0.25(27) + 0.25(50) + 0.15(0)
          =   8.75   +   6.75   +  12.50   +    0        = 28.00

First contact: μ₀ = 28.00, σ²₀ = 0, z undefined.
28 < 60 → first-contact floor not met.                     TIER: GREEN
```

### Check-in 2 — D−2

```
S1 = 25 · S2 = 39 · S3 = 50 · S4 = 0
composite = 8.75 + 9.75 + 12.50 + 0                      = 31.00

z = (31.00 − 28.00) / max(0, 8) = 3 / 8                  = 0.375   (< 1.2)
History = 1 < min_history 2 → no change point.             TIER: GREEN

Update: μ₁  = 0.3(31) + 0.7(28)                          = 28.90
        σ²₁ = 0.3(31 − 28)² + 0.7(0) = 2.70   → σ₁       = 1.64
```

### Check-in 3 — D0, created live on stage

Overnight an intimidation report is filed, and the hearing crosses into the 7-day window.

```
q1=3, q2=2, q3=1  →  S1 = 6/12 × 100                     = 50
S2 (LLM)                                                  = 55
S3 = 50 static + 25 intimidation + 15 hearing             = 90
S4                                                        = 0

composite = 0.35(50) + 0.25(55) + 0.25(90) + 0.15(0)
          =  17.50   +  13.75   +  22.50   +    0         = 53.75

z = (53.75 − 28.90) / max(1.64, 8) = 24.85 / 8            = 3.11  → CHANGE POINT
```

**TIER: RED**, matched rule `change_point`.

### What the counsellor sees

| Component | Raw | Weighted contribution |
|---|---|---|
| **S3 case context** | 90 | **22.50** ← largest |
| S1 self-report | 50 | 17.50 |
| S2 linguistic | 55 | 13.75 |
| S4 engagement | 0 | 0.00 |
| S5 acoustic | *displayed* | **0.00 — never scored** |

### The three sentences that are the demo

All three are true of the numbers above. Check that before you say them.

1. Her self-report moved from mild to moderate and her language got somewhat more distressed — but **the thing that moved most was the case file.** S3 went 50 → 50 → 90, and it is the largest single contribution.
2. A composite of 53.75 is not alarming in absolute terms. It fires because it is **3.11 standard deviations above her own baseline.** That is what "dynamic" means, and it is why a fixed threshold would have missed her.
3. The hearing is six days away and the intimidation report was filed yesterday. **She is flagged before the hearing, not after it** — prediction, from a court calendar, with no model involved in the part that mattered most.

---

## 10. The tuning loop

1. **Author** `policy/v1.yaml` by hand from this document.
2. **Test** against `evals/dev.jsonl` (80 items). Print a confusion matrix of expected vs assigned tier.
3. **Improve** — adjust the YAML only. Bump the version. Re-run. Repeat.
4. **Test on unknown data** — `evals/holdout.jsonl` (40 items), **exactly once, on Day 4.** Report whatever it says. If you tune after seeing it the number is worthless, and you'll know it while you're presenting.

**Report:** recall on Critical, per-tier confusion, per-language slices. **Not accuracy.**

**Hard constraint on tuning:** if you change any weight or threshold, re-run §9 and update this document in the same commit. A spec whose worked example no longer matches the code is worse than having no worked example — a judge will try to recompute it, and v1.0 is proof of how easily that drifts.

Stop when the dev-set result stops improving, not after a fixed number of rounds.
