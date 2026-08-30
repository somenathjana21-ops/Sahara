/**
 * scripts/fixtures.ts — the golden path, hardcoded.
 *
 * Owner: TM1 (TM1_GUIDE.md section 3, Prompt 3).
 * Implements 00_MVP_PLAN.md section 7 — the 90 seconds the demo rests on.
 * Numbers are docs/SCORING_AND_POLICY.md section 9 (v1.1) verbatim, so a judge
 * can recompute them by hand from the document.
 *
 * This is stub data so TM2 and TM3 can build tonight, before scoring or the
 * database exist. It is NOT the seed: scripts/seed.ts (TM3, Day 1) writes the
 * real rows with dates computed relative to the run date. Dates here are
 * frozen against Day 0 = 2026-08-30 so fixtures stay deterministic.
 *
 * NO PII. Pseudonyms only. If you are about to put a realistic Indian name in
 * this file, stop.
 *
 * Every object below is validated against types/contract.ts at module load.
 */

import {
  type Alert,
  AlertSchema,
  type Assessment,
  AssessmentSchema,
  type Case,
  CaseSchema,
  type Person,
  PersonSchema,
  type PersonDetail,
  PersonDetailSchema,
  type QueueItem,
  QueueItemSchema,
} from "@/types/contract";

const POLICY_VERSION = "1.1.0";
/** Real value comes from lib/llm/prompt.ts once it exists (SAFETY_SPEC.md section 7). */
const MODEL_VERSION = "fixture-stub@0.1.0";

const PERSON_ID = "11111111-1111-1111-1111-111111111111";
const CASE_ID = "33333333-3333-3333-3333-333333333333";

/* ── the golden-path persona: A-4471 ─────────────────────────────────────── */

/**
 * Frozen at the moment the RED alert lands. baseline_mean / baseline_var are
 * the PRE-third-check-in values (28.90 / 2.70, straight from section 9) because
 * z is computed against mu_(t-1); lib/scoring updates them after scoring.
 *
 * sigma is sqrt(2.70) = 1.64, well below the sigma_floor of 8, so the floor is
 * what the z-score actually divides by. That is the floor doing its job.
 */
const person: Person = {
  id: PERSON_ID,
  pseudonym: "A-4471",
  language: "hi",
  is_minor_flag: false,
  baseline_mean: 28.9,
  baseline_var: 2.7,
  checkin_count: 3,
  missed_count: 0,
  created_at: "2025-07-26T10:00:00+05:30",
};

/**
 * supabase/schema.sql seed, with relative dates resolved against Day 0 = 2026-08-30.
 *
 * The four static rows total 50 and never move. The two time-windowed rows
 * (intimidation, hearing) are both OUTSIDE their windows on D-3 and D-2 and
 * both INSIDE on D0 — that is the whole reason S3 goes 50 -> 50 -> 90.
 * 50 is deliberately under the s3_gte:60 RED rule; raise it and the flat
 * baseline turns RED and the demo dies.
 */
const goldenCase: Case = {
  id: CASE_ID,
  person_id: PERSON_ID,
  atrocity_category: "Property - Land Dispossession",
  stage: "trial",
  next_hearing_date: "2026-09-05", // D+6: 9 days out at D-3, inside 7 days at D0 -> +15 at D0 only
  adjournment_count: 4, //                                                        -> +10 always
  bail_status: "accused_on_bail", //                                              -> +20 always
  relief_due_date: "2026-06-29", // 62 days overdue                               -> +15 always
  relief_paid: false,
  social_boycott_flag: false,
  last_intimidation_report: "2026-08-29", // D-1: filed yesterday                  -> +25 at D0 only
  opened_at: "2025-07-26", // 400 days ago                                        -> +5 always
};

/* ── three assessments: flat, flat, spike ────────────────────────────────── */

/**
 * Day -3. First check-in, so there is no baseline yet and no z-score.
 * composite = 0.35(25) + 0.25(27) + 0.25(50) + 0.15(0)
 *           =   8.75   +   6.75   +  12.50   +    0     = 28.00
 */
const assessmentDayMinus3: Assessment = {
  id: "55555555-5555-5555-5555-000000000001",
  checkin_id: "44444444-4444-4444-4444-000000000001",
  person_id: PERSON_ID,
  components: { s1: 25, s2: 27, s3: 50, s4: 0, s5: null },
  contributions: { s1: 8.75, s2: 6.75, s3: 12.5, s4: 0, s5: null },
  composite: 28,
  z_score: null,
  change_point: false,
  tier: "GREEN",
  trigger_source: "policy",
  explanation: [
    "First check-in: no baseline yet, so no deviation test was run.",
    "S3 case context 50: accused released on bail, relief 62 days overdue, 4th adjournment, case open over a year.",
    "No intimidation report on file and the hearing is 9 days out, so neither time-windowed row applies.",
  ],
  policy_version: POLICY_VERSION,
  model_version: MODEL_VERSION,
  created_at: "2026-08-27T09:12:00+05:30",
};

/**
 * Day -2. One prior check-in, so still below min_history_for_change_point (2).
 * composite = 0.35(25) + 0.25(39) + 0.25(50) + 0.15(0)
 *           =   8.75   +   9.75   +  12.50   +    0     = 31.00
 * z = (31.00 - 28.00) / max(0, 8) = 3 / 8 = 0.375
 */
const assessmentDayMinus2: Assessment = {
  id: "55555555-5555-5555-5555-000000000002",
  checkin_id: "44444444-4444-4444-4444-000000000002",
  person_id: PERSON_ID,
  components: { s1: 25, s2: 39, s3: 50, s4: 0, s5: null },
  contributions: { s1: 8.75, s2: 9.75, s3: 12.5, s4: 0, s5: null },
  composite: 31,
  z_score: 0.375,
  change_point: false,
  tier: "GREEN",
  trigger_source: "policy",
  explanation: [
    "z = 0.375 against this person's own baseline: below the 2.0 change-point threshold.",
    "Only one prior check-in, below the minimum history of 2, so no change point could fire.",
    "S3 case context still 50: the case file has not moved.",
  ],
  policy_version: POLICY_VERSION,
  model_version: MODEL_VERSION,
  created_at: "2026-08-28T09:05:00+05:30",
};

/**
 * Day 0 — the spike. Overnight an intimidation report was filed and the
 * hearing crossed into the 7-day window, so S3 goes 50 -> 90.
 * composite = 0.35(50) + 0.25(55) + 0.25(90) + 0.15(0)
 *           =  17.50   +  13.75   +  22.50   +    0     = 53.75
 * z = (53.75 - 28.90) / max(1.64, 8) = 24.85 / 8 = 3.11 -> change point
 */
const assessmentDay0: Assessment = {
  id: "55555555-5555-5555-5555-000000000003",
  checkin_id: "44444444-4444-4444-4444-000000000003",
  person_id: PERSON_ID,
  components: { s1: 50, s2: 55, s3: 90, s4: 0, s5: null },
  contributions: { s1: 17.5, s2: 13.75, s3: 22.5, s4: 0, s5: null },
  composite: 53.75,
  z_score: 3.11,
  change_point: true,
  tier: "RED",
  trigger_source: "policy",
  explanation: [
    "Change point fired: z = 3.11 exceeds the 2.0 threshold in policy 1.1.0.",
    "S3 case context 90: intimidation reported yesterday, hearing in 6 days, accused released on bail, relief 62 days overdue, 4th adjournment.",
    "S3 contributes 22.50 — more than the self-report (17.50) and more than the language model (13.75). The case file is the strongest signal.",
    "Composite 53.75 is not high in absolute terms. It fires because it is 3.11 standard deviations above this person's own baseline of 28.90.",
    "S5 acoustic was extracted but is weighted 0.00 and did not contribute.",
  ],
  policy_version: POLICY_VERSION,
  model_version: MODEL_VERSION,
  created_at: "2026-08-30T09:41:00+05:30",
};

/** RED is ack-required, SLA 30 minutes (docs/SCORING_AND_POLICY.md section 8). */
const redAlert: Alert = {
  id: "66666666-6666-6666-6666-666666666666",
  assessment_id: assessmentDay0.id,
  person_id: PERSON_ID,
  tier: "RED",
  sla_minutes: 30,
  created_at: "2026-08-30T09:41:00+05:30",
  acked_at: null,
  acked_by: null,
  disposition: null,
};

/* ── exports ─────────────────────────────────────────────────────────────── */

/** A quiet case, for the row above the spike in TM3's queue. */
export const greenQueueItem: QueueItem = QueueItemSchema.parse({
  personId: "88888888-8888-8888-8888-888888888888",
  pseudonym: "B-2210",
  tier: "GREEN",
  composite: 22,
  changePoint: false,
  createdAt: "2026-08-30T08:15:00+05:30",
  acked: true,
  slaMinutes: 10080,
});

/** The golden path as it appears in the counsellor queue. */
export const redQueueItem: QueueItem = QueueItemSchema.parse({
  personId: PERSON_ID,
  pseudonym: "A-4471",
  tier: "RED",
  composite: 53.75,
  changePoint: true,
  createdAt: "2026-08-30T09:41:00+05:30",
  acked: false,
  slaMinutes: 30,
});

/** Assessments are oldest first: 28.00, 31.00, 53.75 — the trend line TM3 draws. */
export const goldenPathPersonDetail: PersonDetail = PersonDetailSchema.parse({
  person: PersonSchema.parse(person),
  case: CaseSchema.parse(goldenCase),
  assessments: [
    assessmentDayMinus3,
    assessmentDayMinus2,
    assessmentDay0,
  ].map((a) => AssessmentSchema.parse(a)),
  alerts: [redAlert].map((a) => AlertSchema.parse(a)),
});
