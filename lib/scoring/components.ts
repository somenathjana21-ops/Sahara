/**
 * lib/scoring/components.ts — the five named components, as pure functions.
 *
 * Owner: TM1. Implements docs/SCORING_AND_POLICY.md sections 2-6
 * (TM1_GUIDE.md section 5, Prompt 6).
 *
 * No I/O. No database, no fetch, no clock. `today` is passed in so an
 * assessment can be recomputed by hand from a document and a date, which is
 * the whole claim in SCORING_AND_POLICY.md section 1: "a judge should be able
 * to recompute a score by hand".
 *
 * Nothing here decides a tier. These functions return numbers and the reasons
 * for them; lib/policy/engine.ts turns a composite into a tier, and only
 * SAFETY_SPEC.md section 3's deterministic triggers produce CRITICAL.
 */

import type {
  Case,
  CheckIn,
  Person,
  StructuredAnswers,
} from "@/types/contract";

/* ── dates ───────────────────────────────────────────────────────────────── */

const MS_PER_DAY = 86_400_000;

/**
 * Whole-day arithmetic on calendar days, not instants.
 *
 * `cases` dates are Postgres `date` columns — 'YYYY-MM-DD', no time, no zone.
 * `today` is read through its LOCAL calendar fields, because "the hearing is
 * six days away" is a statement about the counsellor's calendar, not about
 * UTC. Both sides are then projected onto UTC midnight so the subtraction is
 * exact and never lands on a DST-shortened day.
 */
function dayOfIso(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`scoreS3: expected a YYYY-MM-DD date, got "${iso}"`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function dayOfDate(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole days from `iso` to `today`. Positive = in the past. */
export function daysSince(iso: string, today: Date): number {
  return (dayOfDate(today) - dayOfIso(iso)) / MS_PER_DAY;
}

/** Whole days from `today` to `iso`. Positive = in the future. */
export function daysUntil(iso: string, today: Date): number {
  return -daysSince(iso, today);
}

/* ── S1 — self-report (SCORING_AND_POLICY.md section 3) ──────────────────── */

/** The three questions, in the order the composite reads them. */
const S1_QUESTIONS = ["q1", "q2", "q3"] as const;

/** Each answer is 0-4, so three answers span 0-12 (section 3). */
const MAX_PER_ANSWER = 4;

/**
 * `S1 = (q1 + q2 + q3) / 12 x 100`.
 *
 * Returns null, never 0, when nothing was answered. The column is nullable and
 * the composite renormalises (section 4); a call abandoned before the first
 * keypad press is a MISSING self-report, and a missing signal is not a calm
 * signal. Substituting 0 here would read "much better, not at all, safe" from
 * a person who said nothing at all.
 *
 * A partially answered set renormalises over the questions actually answered,
 * for the same reason: `checkins.structured` defaults to '{}' and a call can
 * end mid-flow (types/contract.ts, StructuredAnswersSchema).
 *
 * q3 = 4 does NOT come through here. It is a deterministic CRITICAL trigger on
 * its own and bypasses the composite entirely — see `q3IsCriticalTrigger`.
 */
export function scoreS1(structured: StructuredAnswers): number | null {
  const answers = S1_QUESTIONS.map((q) => structured[q]).filter(
    (a): a is number => typeof a === "number",
  );
  if (answers.length === 0) return null;

  const sum = answers.reduce((a, b) => a + b, 0);
  return (sum / (answers.length * MAX_PER_ANSWER)) * 100;
}

/**
 * SAFETY_SPEC.md section 3: "S1 self-report question 3 answered 'not safe'"
 * is a CRITICAL trigger in its own right, with `trigger_source` of
 * 'self_report_q3'. Deterministic, one comparison, no model.
 *
 * It lives beside scoreS1 so the two readings of q3 stay in one file: the
 * composite reads q3 as a 0-4 severity, and this reads the top of that scale
 * as an assertion of danger. They are not the same question.
 */
export function q3IsCriticalTrigger(structured: StructuredAnswers): boolean {
  return structured.q3 === 4;
}

/* ── S3 — case context (SCORING_AND_POLICY.md section 5) ─────────────────── */

/**
 * The section 5 table, row for row, in table order.
 *
 * `kind` is load-bearing and is carried into the reason strings: rows 1 and 3
 * are time-windowed and move on their own as the calendar advances, the other
 * four move only when someone edits the case file. S3 changing over time is
 * entirely down to those two rows, and the golden path in section 9 depends on
 * it. A persona whose S3 never moves has no story.
 */
export interface S3Row {
  id: number;
  points: number;
  kind: "time-windowed" | "static";
  applies(c: Case, today: Date): boolean;
  reason(c: Case, today: Date): string;
}

const INTIMIDATION_WINDOW_DAYS = 14;
const HEARING_WINDOW_DAYS = 7;
const RELIEF_OVERDUE_DAYS = 30;
const ADJOURNMENT_THRESHOLD = 3;
const CASE_AGE_DAYS = 365;

export const S3_ROWS: readonly S3Row[] = [
  {
    id: 1,
    points: 25,
    kind: "time-windowed",
    // "in the last 14 days" is a window that has already opened: a report
    // dated in the future has not been filed yet. That `>= 0` is exactly why
    // S3 is 50 on D-3 and 90 on D0 in section 9 — drop it and the flat
    // baseline turns RED and the demo dies.
    applies: (c, today) => {
      if (c.last_intimidation_report === null) return false;
      const d = daysSince(c.last_intimidation_report, today);
      return d >= 0 && d <= INTIMIDATION_WINDOW_DAYS;
    },
    reason: (c, today) =>
      `Intimidation report filed ${describeDaysAgo(
        daysSince(c.last_intimidation_report as string, today),
      )} (+25).`,
  },
  {
    id: 2,
    points: 20,
    kind: "static",
    applies: (c) => c.bail_status === "accused_on_bail",
    reason: () => "Accused released on bail (+20).",
  },
  {
    id: 3,
    points: 15,
    kind: "time-windowed",
    applies: (c, today) => {
      if (c.next_hearing_date === null) return false;
      const d = daysUntil(c.next_hearing_date, today);
      return d >= 0 && d <= HEARING_WINDOW_DAYS;
    },
    reason: (c, today) =>
      `Next hearing ${describeDaysAhead(
        daysUntil(c.next_hearing_date as string, today),
      )} (+15).`,
  },
  {
    id: 4,
    points: 15,
    kind: "static",
    applies: (c, today) => {
      if (c.relief_paid || c.relief_due_date === null) return false;
      return daysSince(c.relief_due_date, today) > RELIEF_OVERDUE_DAYS;
    },
    reason: (c, today) =>
      `Relief instalment ${daysSince(
        c.relief_due_date as string,
        today,
      )} days overdue (+15).`,
  },
  {
    id: 5,
    points: 10,
    kind: "static",
    applies: (c) => c.adjournment_count >= ADJOURNMENT_THRESHOLD,
    reason: (c) => `${c.adjournment_count} adjournments on the record (+10).`,
  },
  {
    id: 6,
    points: 10,
    kind: "static",
    applies: (c) => c.social_boycott_flag,
    reason: () => "Social boycott flagged on the case (+10).",
  },
  {
    id: 7,
    points: 5,
    kind: "static",
    applies: (c, today) => daysSince(c.opened_at, today) > CASE_AGE_DAYS,
    reason: (c, today) => `Case open ${daysSince(c.opened_at, today)} days (+5).`,
  },
];

function describeDaysAgo(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function describeDaysAhead(days: number): string {
  if (days === 0) return "is today";
  if (days === 1) return "is tomorrow";
  return `is ${days} days away`;
}

export interface ComponentResult {
  score: number;
  reasons: string[];
}

/**
 * `S3 = min(100, sum of the applicable rows)` — section 5.
 *
 * Deterministic. No NLP, no voice parsing, no model: the problem statement's
 * own stressors (threats, bail, hearing delay, unpaid relief, ostracism) are
 * all knowable from a case record and a calendar. This is the centrepiece of
 * the pitch and the most explainable number in the system.
 *
 * SNAPSHOT, NOT A RECOMPUTATION. The caller freezes the returned score into
 * `assessments.components` at check-in time. Never re-run this against today's
 * `cases` row to redraw a historical point — rows 1 and 3 will have moved and
 * the trend chart will lie (section 5, CHECKS_TM1.md T1-C12).
 */
export function scoreS3(caseRow: Case, today: Date): ComponentResult {
  const reasons: string[] = [];
  let sum = 0;

  for (const row of S3_ROWS) {
    if (!row.applies(caseRow, today)) continue;
    sum += row.points;
    reasons.push(row.reason(caseRow, today));
  }

  if (reasons.length === 0) {
    reasons.push("No case-context factors apply on this date (0).");
  }

  return { score: Math.min(100, sum), reasons };
}

/* ── S4 — engagement (SCORING_AND_POLICY.md section 6) ───────────────────── */

/**
 * Response latency for this check-in against this person's OWN median, which
 * is the only comparison section 6 permits. Optional: the MVP does not record
 * per-message timings on every channel, and an absent measurement adds nothing
 * rather than defaulting to "prompt".
 */
export interface LatencySignal {
  responseMs: number;
  personMedianMs: number;
}

const MISSED_POINTS = [0, 25, 50, 75] as const;
const ABANDONED_POINTS = 20;
const SLOW_RESPONSE_POINTS = 15;
const SLOW_RESPONSE_MULTIPLE = 3;

/**
 * Missed check-ins, abandonment, latency. Section 6, row for row.
 *
 * S4 CAN ONLY INCREASE, and every clause below is additive and non-negative
 * for exactly that reason. Silence can mean recovery, a lost phone, coercion
 * preventing contact, or crisis, and there is no way to tell which from the
 * silence. Scoring it as improvement is the failure mode that gets people
 * killed (section 6, CLAUDE.md rule 5). The monotonicity test in
 * scoring.test.ts is not decoration — it is the guard on that sentence.
 *
 * The missed-check-in points are a step function (1 -> 25, 2 -> 50, 3+ -> 75),
 * not 25 per miss. 3+ additionally forces a minimum tier of Amber; that floor
 * is the `missed_checkins_gte: 3` rule in policy/v1.yaml, applied by
 * lib/policy/engine.ts, not here — this function returns a number, never a tier.
 */
export function scoreS4(
  person: Person,
  checkin: CheckIn,
  latency?: LatencySignal,
): ComponentResult {
  const reasons: string[] = [];
  let sum = 0;

  const missed = person.missed_count;
  if (missed > 0) {
    const points = MISSED_POINTS[Math.min(missed, 3)];
    sum += points;
    reasons.push(
      missed >= 3
        ? `${missed} missed scheduled check-ins (+${points}; forces a minimum tier of Amber).`
        : `${missed} missed scheduled check-in${missed === 1 ? "" : "s"} (+${points}).`,
    );
  }

  if (checkin.abandoned) {
    sum += ABANDONED_POINTS;
    reasons.push(`Check-in abandoned mid-flow (+${ABANDONED_POINTS}).`);
  }

  if (
    latency !== undefined &&
    latency.personMedianMs > 0 &&
    latency.responseMs > SLOW_RESPONSE_MULTIPLE * latency.personMedianMs
  ) {
    sum += SLOW_RESPONSE_POINTS;
    reasons.push(
      `Response latency over ${SLOW_RESPONSE_MULTIPLE}x this person's own median (+${SLOW_RESPONSE_POINTS}).`,
    );
  }

  if (reasons.length === 0) {
    reasons.push("Engaged as scheduled: nothing missed, nothing abandoned (0).");
  }

  return { score: Math.min(100, sum), reasons };
}

/* ── S5 — acoustic (SCORING_AND_POLICY.md section 2) ─────────────────────── */

/**
 * ================= WEIGHT 0.00. DELIBERATE. DO NOT "FIX". =================
 *
 * docs/SCORING_AND_POLICY.md section 2, and CLAUDE.md hard rule 9.
 *
 * S5 is EXTRACTED and DISPLAYED to the counsellor with a low-confidence
 * caveat, and it is given NO influence on the composite. That zero is a
 * deliberate design decision and a talking point, not an unfinished TODO, not
 * dead code, and not a bug someone forgot to close.
 *
 * The reason: acoustic emotion inference degrades sharply across accent,
 * dialect, gender and recording conditions. It is therefore LEAST accurate for
 * the most marginalised callers — which is precisely backwards for the
 * population this system exists to serve. A weighted S5 would push its largest
 * errors onto the users least able to absorb them.
 *
 * If you are about to give this a non-zero weight: the composite refuses to
 * run with one (`computeComposite` in ./composite.ts throws), and
 * `policy/v1.yaml` fails zod validation at load. Both guards are intentional.
 * Change the document first, or leave it alone.
 * =========================================================================
 */
export const S5_CAVEAT =
  "Low confidence. Acoustic inference is unreliable across accent, dialect and line quality; shown for context only and contributes 0.00 to the composite.";

export interface AcousticFeatures {
  /** Pitch variability as a percentage of this person's own observed range. */
  pitchVariabilityPct: number;
  /** Absolute speech-rate deviation from this person's median, as a percentage. */
  speechRateDeviationPct: number;
  /** Share of the turn spent in silence, as a percentage. */
  pauseRatioPct: number;
}

export interface AcousticSignal {
  /** 0-100, or null when there is no audio (every `chat` check-in). */
  score: number | null;
  /** Always "low". See S5_CAVEAT. */
  confidence: "low";
  caveat: string;
  reasons: string[];
}

/**
 * Extract S5 for display. The number it returns is never multiplied by
 * anything but 0.00 — see the block comment above.
 */
export function extractS5(features: AcousticFeatures | null): AcousticSignal {
  if (features === null) {
    return {
      score: null,
      confidence: "low",
      caveat: S5_CAVEAT,
      reasons: [
        "No audio on this channel, so no acoustic signal was extracted.",
      ],
    };
  }

  const parts = [
    features.pitchVariabilityPct,
    features.speechRateDeviationPct,
    features.pauseRatioPct,
  ].map((p) => Math.min(100, Math.max(0, p)));

  const score = parts.reduce((a, b) => a + b, 0) / parts.length;

  return {
    score,
    confidence: "low",
    caveat: S5_CAVEAT,
    reasons: [
      `Pitch variability ${parts[0]}%, speech-rate deviation ${parts[1]}%, pause ratio ${parts[2]}%.`,
      "Displayed only. Weighted 0.00 in the composite (SCORING_AND_POLICY.md section 2).",
    ],
  };
}
