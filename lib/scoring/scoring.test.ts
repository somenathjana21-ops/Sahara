/**
 * lib/scoring/scoring.test.ts — components, baseline, and the golden path.
 *
 * Owner: TM1. `npm run test -- scoring`.
 *
 * The worked-example block at the bottom is CHECKS_TM1.md T1-C1, a BLOCKER and
 * the regression guard for the entire demo. If it goes red, the golden path is
 * broken and nothing else in this repo matters until it is green again.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Case, CheckIn, Person } from "@/types/contract";
import {
  daysSince,
  daysUntil,
  extractS5,
  q3IsCriticalTrigger,
  scoreS1,
  scoreS3,
  scoreS4,
} from "./components";
import { isChangePoint, updateEWMA, zScore } from "./baseline";
import { computeComposite, type CompositeWeights } from "./composite";
import {
  ACCEPTED_TZ,
  assignTier,
  compositeWeights,
  loadPolicy,
} from "@/lib/policy/engine";
import { goldenPathPersonDetail } from "@/scripts/fixtures";

/* ── the golden-path persona, A-4471 ─────────────────────────────────────── */

const PERSON_ID = "11111111-1111-1111-1111-111111111111";

/**
 * scripts/fixtures.ts, with dates frozen against Day 0 = 2026-08-30.
 *
 * Static rows total 50: bail +20, relief 62 days overdue +15, 4 adjournments
 * +10, case open 400 days +5. Deliberately under the `s3_gte: 60` RED rule so
 * the flat baseline stays GREEN. The two time-windowed rows are OUTSIDE their
 * windows on D-3 and D-2 and INSIDE on D0 — that, and only that, is why S3
 * goes 50 -> 50 -> 90.
 */
const goldenCase: Case = {
  id: "33333333-3333-3333-3333-333333333333",
  person_id: PERSON_ID,
  atrocity_category: "Property - Land Dispossession",
  stage: "trial",
  next_hearing_date: "2026-09-05",
  adjournment_count: 4,
  bail_status: "accused_on_bail",
  relief_due_date: "2026-06-29",
  relief_paid: false,
  social_boycott_flag: false,
  last_intimidation_report: "2026-08-29",
  opened_at: "2025-07-26",
};

/** Local-midnight dates: `daysSince` reads local calendar fields. */
const D_MINUS_3 = new Date(2026, 7, 27);
const D_MINUS_2 = new Date(2026, 7, 28);
const D_ZERO = new Date(2026, 7, 30);

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: PERSON_ID,
    pseudonym: "A-4471",
    language: "hi",
    is_minor_flag: false,
    baseline_mean: null,
    baseline_var: null,
    checkin_count: 0,
    missed_count: 0,
    created_at: "2025-07-26T10:00:00+05:30",
    ...overrides,
  };
}

function checkin(overrides: Partial<CheckIn> = {}): CheckIn {
  return {
    id: "44444444-4444-4444-4444-000000000001",
    person_id: PERSON_ID,
    consent_id: "22222222-2222-2222-2222-222222222222",
    channel: "chat",
    transcript: null,
    structured: {},
    abandoned: false,
    created_at: "2026-08-30T09:12:00+05:30",
    ...overrides,
  };
}

/* ── S1 ──────────────────────────────────────────────────────────────────── */

describe("scoreS1 — self-report (SCORING_AND_POLICY section 3)", () => {
  it("is (q1 + q2 + q3) / 12 x 100", () => {
    assert.equal(scoreS1({ q1: 1, q2: 1, q3: 1 }), 25);
    assert.equal(scoreS1({ q1: 3, q2: 2, q3: 1 }), 50);
    assert.equal(scoreS1({ q1: 0, q2: 0, q3: 0 }), 0);
    assert.equal(scoreS1({ q1: 4, q2: 4, q3: 4 }), 100);
  });

  it("returns null, not 0, when nothing was answered", () => {
    assert.equal(scoreS1({}), null);
  });

  it("renormalises over the questions actually answered", () => {
    // A call abandoned after q1. 3 of 4, not 3 of 12.
    assert.equal(scoreS1({ q1: 3 }), 75);
    assert.equal(scoreS1({ q1: 2, q2: 2 }), 50);
  });

  it("flags q3 = 4 as a deterministic CRITICAL trigger", () => {
    assert.equal(q3IsCriticalTrigger({ q1: 0, q2: 0, q3: 4 }), true);
    assert.equal(q3IsCriticalTrigger({ q1: 4, q2: 4, q3: 3 }), false);
    assert.equal(q3IsCriticalTrigger({}), false);
  });
});

/* ── S3 ──────────────────────────────────────────────────────────────────── */

describe("scoreS3 — case context (SCORING_AND_POLICY section 5)", () => {
  it("is 50 on D-3 and D-2: static rows only", () => {
    assert.equal(scoreS3(goldenCase, D_MINUS_3).score, 50);
    assert.equal(scoreS3(goldenCase, D_MINUS_2).score, 50);
  });

  it("is 90 on D0, once both time-windowed rows fire", () => {
    assert.equal(scoreS3(goldenCase, D_ZERO).score, 90);
  });

  it("does not count an intimidation report dated in the future", () => {
    // The report is filed on D-1. On D-3 it has not happened yet, and reading
    // it as "within the last 14 days" would put S3 at 75 on the flat baseline.
    const reasons = scoreS3(goldenCase, D_MINUS_3).reasons.join(" ");
    assert.ok(!reasons.includes("Intimidation"));
    assert.ok(scoreS3(goldenCase, D_ZERO).reasons.join(" ").includes("yesterday"));
  });

  it("does not count a hearing that has already passed", () => {
    const past = { ...goldenCase, next_hearing_date: "2026-08-25" };
    assert.equal(scoreS3(past, D_ZERO).score, 90 - 15);
  });

  it("keeps the static rows under the s3_gte 60 RED threshold", () => {
    // policy/v1.yaml escalates on S3 alone at 60. If a persona's flat baseline
    // reaches it, every GREEN check-in comes back RED (section 8).
    assert.ok(scoreS3(goldenCase, D_MINUS_3).score < 60);
  });

  it("names every row that fired", () => {
    const { reasons } = scoreS3(goldenCase, D_ZERO);
    assert.equal(reasons.length, 6);
    assert.ok(reasons.some((r) => r.includes("bail")));
    assert.ok(reasons.some((r) => r.includes("62 days overdue")));
    assert.ok(reasons.some((r) => r.includes("4 adjournments")));
    assert.ok(reasons.some((r) => r.includes("400 days")));
  });

  it("caps at 100 when every row applies", () => {
    const worst: Case = {
      ...goldenCase,
      social_boycott_flag: true,
      last_intimidation_report: "2026-08-28",
      next_hearing_date: "2026-09-01",
    };
    // 25 + 20 + 15 + 15 + 10 + 10 + 5 = 100.
    assert.equal(scoreS3(worst, D_ZERO).score, 100);
  });

  it("scores 0 with reasons on a case with nothing on file", () => {
    const quiet: Case = {
      ...goldenCase,
      bail_status: "accused_in_custody",
      adjournment_count: 0,
      relief_paid: true,
      relief_due_date: null,
      next_hearing_date: null,
      last_intimidation_report: null,
      opened_at: "2026-08-01",
    };
    const { score, reasons } = scoreS3(quiet, D_ZERO);
    assert.equal(score, 0);
    assert.equal(reasons.length, 1);
  });

  it("counts whole calendar days in both directions", () => {
    assert.equal(daysSince("2026-08-29", D_ZERO), 1);
    assert.equal(daysUntil("2026-09-05", D_ZERO), 6);
    assert.equal(daysSince("2025-07-26", D_ZERO), 400);
  });
});

/* ── the row 3 boundary ──────────────────────────────────────────────────── */

/**
 * THE 7-DAY HEARING WINDOW IS INCLUSIVE AT BOTH ENDS: it fires for
 * `0 <= daysUntil <= 7`. Exactly 7 days out FIRES. 8 days out does not. A
 * hearing dated today fires; a hearing already past does not.
 *
 * Section 5 says only "next hearing within 7 days" and does not settle the
 * endpoint, so this file settles it. Inclusive is the escalating reading, and
 * the escalating reading is the correct default everywhere in this system:
 * an off-by-one that drops row 3 costs 15 points of S3 on the day before a
 * hearing, which is exactly when anticipatory distress is highest.
 *
 * This is not academic. The golden path's hearing sits at D+6 — ONE DAY inside
 * the boundary. Anything that shifts the effective date by two days (a UTC
 * server plus a late-night demo, a seed script computing `current_date + 6`
 * against a different zone than the scorer reads) lands exactly here. That
 * margin is why the boundary gets a test instead of a comment.
 */
describe("S3 row 3 — the 7-day hearing window boundary", () => {
  /** The golden case with only the hearing moved, so row 3 is the sole variable. */
  function s3WithHearing(daysOut: number): number {
    const hearing = new Date(D_ZERO);
    hearing.setDate(hearing.getDate() + daysOut);
    const iso = [
      hearing.getFullYear(),
      String(hearing.getMonth() + 1).padStart(2, "0"),
      String(hearing.getDate()).padStart(2, "0"),
    ].join("-");
    return scoreS3({ ...goldenCase, next_hearing_date: iso }, D_ZERO).score;
  }

  // 90 = row 3 fired (+15). 75 = it did not. Everything else is held constant.
  const FIRED = 90;
  const NOT_FIRED = 75;

  it("fires at exactly 7 days out — the window is INCLUSIVE", () => {
    assert.equal(s3WithHearing(7), FIRED);
  });

  it("does not fire at 8 days out", () => {
    assert.equal(s3WithHearing(8), NOT_FIRED);
  });

  it("fires at 6 days out, which is where the golden path sits", () => {
    assert.equal(s3WithHearing(6), FIRED);
    assert.equal(daysUntil("2026-09-05", D_ZERO), 6, "one day inside the boundary");
  });

  it("fires on the day of the hearing itself", () => {
    assert.equal(s3WithHearing(0), FIRED);
  });

  it("does not fire for a hearing that has already passed", () => {
    // A past hearing is not anticipatory distress; row 5 (adjournments) is
    // what carries the aftermath.
    assert.equal(s3WithHearing(-1), NOT_FIRED);
  });

  it("does not fire when there is no hearing scheduled", () => {
    assert.equal(
      scoreS3({ ...goldenCase, next_hearing_date: null }, D_ZERO).score,
      NOT_FIRED,
    );
  });
});

/* ── timezone ────────────────────────────────────────────────────────────── */

describe("scoreS3 reads IST calendar days, not UTC ones", () => {
  it("the test process is pinned to Asia/Kolkata", () => {
    // scripts/run-tests.mjs sets this, and lib/policy/engine.ts refuses to
    // load a policy without it. If this assertion fails, every date-dependent
    // number below is measuring the machine, not the code.
    // Either spelling of the zone is accepted; they are the same zone.
    assert.ok(
      (ACCEPTED_TZ as readonly string[]).includes(process.env.TZ ?? ""),
      `TZ is ${process.env.TZ}, expected one of ${ACCEPTED_TZ.join(" | ")}`,
    );
  });

  it("scores S3 = 90 on the evening of D0", () => {
    assert.equal(scoreS3(goldenCase, new Date("2026-08-30T19:00:00+05:30")).score, 90);
  });

  it("scores S3 = 90 after midnight IST, where the UTC date is a day behind", () => {
    // 2026-08-31T02:00+05:30 is 2026-08-30T20:30Z. A UTC process reads Aug 30,
    // an IST process reads Aug 31. Both still score 90 here — this persona's
    // windows are wide enough to survive one day of slip at this instant.
    assert.equal(scoreS3(goldenCase, new Date("2026-08-31T02:00:00+05:30")).score, 90);
  });

  it("is 90 and not 50 at the window boundary — the demo-breaking instant", () => {
    // 2026-08-29T02:00+05:30 is 2026-08-28T20:30Z, and this is where a UTC
    // process actually breaks: it reads Aug 28, which puts the intimidation
    // report (filed Aug 29) in the FUTURE and the hearing (Sep 5) 8 days out.
    // Both time-windowed rows drop at once and S3 falls 90 -> 50, a 40-point
    // swing on the component the whole pitch rests on.
    const { score, reasons } = scoreS3(
      goldenCase,
      new Date("2026-08-29T02:00:00+05:30"),
    );
    assert.equal(score, 90, "a UTC-reading process scores this instant as 50");
    assert.ok(reasons.some((r) => r.includes("Intimidation")));
    assert.ok(reasons.some((r) => r.includes("Next hearing")));
  });
});

/* ── S4 ──────────────────────────────────────────────────────────────────── */

describe("scoreS4 — engagement (SCORING_AND_POLICY section 6)", () => {
  it("steps 0 / 25 / 50 / 75 with missed check-ins", () => {
    for (const [missed, expected] of [
      [0, 0],
      [1, 25],
      [2, 50],
      [3, 75],
      [7, 75],
    ] as const) {
      assert.equal(
        scoreS4(person({ missed_count: missed }), checkin()).score,
        expected,
        `missed_count ${missed}`,
      );
    }
  });

  it("adds 20 for abandonment and 15 for a slow reply", () => {
    assert.equal(scoreS4(person(), checkin({ abandoned: true })).score, 20);
    assert.equal(
      scoreS4(person(), checkin(), { responseMs: 40_000, personMedianMs: 10_000 })
        .score,
      15,
    );
    // Exactly 3x is not "over 3x".
    assert.equal(
      scoreS4(person(), checkin(), { responseMs: 30_000, personMedianMs: 10_000 })
        .score,
      0,
    );
  });

  it("caps at 100", () => {
    const score = scoreS4(
      person({ missed_count: 4 }),
      checkin({ abandoned: true }),
      { responseMs: 99_000, personMedianMs: 1_000 },
    ).score;
    assert.equal(score, 100);
  });

  it("says out loud that 3+ missed forces a minimum of Amber", () => {
    const { reasons } = scoreS4(person({ missed_count: 3 }), checkin());
    assert.ok(reasons.join(" ").includes("Amber"));
  });

  it("NEVER decreases as missed_count rises (CLAUDE.md rule 5)", () => {
    let previous = -1;
    for (let missed = 0; missed <= 10; missed++) {
      const { score } = scoreS4(person({ missed_count: missed }), checkin());
      assert.ok(
        score >= previous,
        `missed_count ${missed} lowered S4 from ${previous} to ${score}`,
      );
      previous = score;
    }
  });
});

/* ── S5 ──────────────────────────────────────────────────────────────────── */

describe("extractS5 — acoustic, weighted 0.00 on purpose (section 2)", () => {
  it("is null when there is no audio", () => {
    assert.equal(extractS5(null).score, null);
  });

  it("returns a score and always a low-confidence caveat", () => {
    const s5 = extractS5({
      pitchVariabilityPct: 80,
      speechRateDeviationPct: 40,
      pauseRatioPct: 60,
    });
    assert.equal(s5.score, 60);
    assert.equal(s5.confidence, "low");
    assert.ok(s5.caveat.includes("0.00"));
  });

  it("contributes nothing to the composite even at 100", () => {
    const weights = compositeWeights(loadPolicy());
    const withS5 = computeComposite(
      { s1: 25, s2: 27, s3: 50, s4: 0, s5: 100 },
      weights,
    );
    const withoutS5 = computeComposite(
      { s1: 25, s2: 27, s3: 50, s4: 0, s5: null },
      weights,
    );
    assert.equal(withS5.composite, withoutS5.composite);
    assert.equal(withS5.contributions.s5, 0);
  });
});

/* ── baseline ────────────────────────────────────────────────────────────── */

describe("baseline — EWMA and z (SCORING_AND_POLICY section 7)", () => {
  it("initialises mu to the first composite and sigma squared to 0", () => {
    assert.deepEqual(updateEWMA(null, null, 28), { mean: 28, variance: 0 });
    assert.equal(zScore(28, null, null), null);
  });

  it("updates mu and sigma squared against the PRE-update mean", () => {
    const b = updateEWMA(28, 0, 31);
    assert.equal(round(b.mean, 2), 28.9);
    assert.equal(round(b.variance, 2), 2.7);
    assert.equal(round(Math.sqrt(b.variance), 2), 1.64);
  });

  it("measures z against mu_(t-1), not the updated mean", () => {
    // The easy bug in section 7. Updating mu first gives (53.75 - 36.355) / 8
    // = 2.17 instead of 3.11 — the spike reads as a third smaller, in the one
    // direction this system cannot afford to be wrong in.
    const before = zScore(53.75, 28.9, 2.7);
    const updated = updateEWMA(28.9, 2.7, 53.75);
    const after = zScore(53.75, updated.mean, updated.variance);
    assert.ok(before !== null && after !== null);
    assert.ok(before > after);
    assert.equal(round(before, 2), 3.11);
  });

  it("applies the sigma floor of 8", () => {
    // True sigma is 1.64 here, so the floor does all the work.
    assert.equal(zScore(53.75, 28.9, 2.7), 24.85 / 8);
    // A person with a genuinely wide history divides by their own sigma.
    assert.equal(zScore(100, 50, 400), 50 / 20);
  });

  it("needs z > 2.0 AND at least 2 prior check-ins", () => {
    assert.equal(isChangePoint(3.11, 2), true);
    assert.equal(isChangePoint(3.11, 1), false, "one prior check-in is not a history");
    assert.equal(isChangePoint(2.0, 5), false, "the threshold is strict");
    assert.equal(isChangePoint(0.375, 1), false);
    assert.equal(isChangePoint(null, 9), false);
  });
});

/* ── the golden path (CHECKS_TM1.md T1-C1 — BLOCKER) ─────────────────────── */

/**
 * SCORING_AND_POLICY.md section 9, recomputed end to end.
 *
 * NOTE ON THE EXPECTED NUMBERS. The v1.0 draft of this spec asserted composite
 * 55.1 and z 3.15; docs/FIXES_AND_PROMPTS.md section 1 shows that golden path
 * was arithmetically impossible (S3 never moved, and `s3_gte: 60` would have
 * fired RED on the flat baseline). v1.1 fixes it to 53.75 and 3.11 by moving
 * the hearing to D+6 and the intimidation report to D-1. Those are the numbers
 * in the current spec, in `scripts/fixtures.ts`, in `supabase/schema.sql` and
 * in CHECKS_TM1.md T1-C1, so they are what this asserts. If you are here
 * because a prompt said 55.1 / 3.15, that prompt predates the fix.
 */
describe("golden path — SCORING_AND_POLICY section 9 (BLOCKER)", () => {
  const policy = loadPolicy();
  const weights: CompositeWeights = compositeWeights(policy);

  /** One check-in, scored exactly as app/api/checkin will score it. */
  function runCheckIn(input: {
    structured: { q1: number; q2: number; q3: number };
    s2: number | null;
    today: Date;
    prevMean: number | null;
    prevVar: number | null;
    historyCount: number;
  }) {
    const s1 = scoreS1(input.structured);
    const s3 = scoreS3(goldenCase, input.today);
    const s4 = scoreS4(person(), checkin());

    const { composite, contributions } = computeComposite(
      { s1, s2: input.s2, s3: s3.score, s4: s4.score, s5: null },
      weights,
    );

    // ORDER: z first, against the baseline as it stood BEFORE this check-in.
    const z = zScore(
      composite,
      input.prevMean,
      input.prevVar,
      policy.baseline.sigma_floor,
    );
    const changePoint = isChangePoint(
      z,
      input.historyCount,
      policy.baseline.change_point_z,
      policy.baseline.min_history_for_change_point,
    );
    const baseline = updateEWMA(
      input.prevMean,
      input.prevVar,
      composite,
      policy.baseline.ewma_lambda,
    );

    const decision = assignTier(
      composite,
      z,
      changePoint,
      s3.score,
      input.prevMean === null,
      0,
      policy,
    );

    return { s1, s3: s3.score, composite, contributions, z, changePoint, baseline, decision };
  }

  const one = runCheckIn({
    structured: { q1: 1, q2: 1, q3: 1 },
    s2: 27,
    today: D_MINUS_3,
    prevMean: null,
    prevVar: null,
    historyCount: 0,
  });

  const two = runCheckIn({
    structured: { q1: 1, q2: 1, q3: 1 },
    s2: 39,
    today: D_MINUS_2,
    prevMean: one.baseline.mean,
    prevVar: one.baseline.variance,
    historyCount: 1,
  });

  const three = runCheckIn({
    structured: { q1: 3, q2: 2, q3: 1 },
    s2: 55,
    today: D_ZERO,
    prevMean: two.baseline.mean,
    prevVar: two.baseline.variance,
    historyCount: 2,
  });

  it("check-in 1, D-3: composite 28.00, no z, GREEN", () => {
    assert.equal(one.s1, 25);
    assert.equal(one.s3, 50);
    assert.equal(one.composite, 28);
    assert.equal(one.z, null);
    assert.equal(one.changePoint, false);
    assert.equal(one.decision.tier, "GREEN");
    assert.equal(one.baseline.mean, 28);
    assert.equal(one.baseline.variance, 0);
  });

  it("check-in 2, D-2: composite 31.00, z 0.375, GREEN, mu -> 28.90", () => {
    assert.equal(two.composite, 31);
    assert.equal(two.z, 0.375);
    assert.equal(
      two.changePoint,
      false,
      "one prior check-in is below min_history_for_change_point",
    );
    assert.equal(two.decision.tier, "GREEN");
    assert.equal(round(two.baseline.mean, 2), 28.9);
    assert.equal(round(two.baseline.variance, 2), 2.7);
  });

  it("check-in 3, D0: composite 53.75 +/- 0.5", () => {
    assert.equal(three.s1, 50);
    assert.equal(three.s3, 90);
    assert.ok(
      Math.abs(three.composite - 53.75) <= 0.5,
      `composite was ${three.composite}, expected 53.75 +/- 0.5`,
    );
  });

  it("check-in 3, D0: z 3.11 +/- 0.05", () => {
    assert.ok(three.z !== null);
    assert.ok(
      Math.abs(three.z - 3.11) <= 0.05,
      `z was ${three.z}, expected 3.11 +/- 0.05`,
    );
  });

  it("check-in 3, D0: tier RED, matched rule change_point", () => {
    assert.equal(three.changePoint, true);
    assert.equal(three.decision.tier, "RED");
    assert.equal(three.decision.matchedRule, "change_point");
    assert.equal(three.decision.triggerSource, "policy");
  });

  it("S3's contribution of 22.50 is the largest of the four", () => {
    // Demo beat #2 says this out loud: "the thing that moved most was the
    // case file". If S1 ever overtakes S3 here, the pitch stops being true.
    const { s1, s2, s3, s4 } = three.contributions;
    assert.equal(s3, 22.5);
    assert.equal(s1, 17.5);
    assert.equal(s2, 13.75);
    assert.equal(s4, 0);
    assert.ok(s3! > s1! && s3! > s2! && s3! > s4!);
  });

  it("S3 moves 50 -> 50 -> 90, and that is the whole story", () => {
    assert.deepEqual([one.s3, two.s3, three.s3], [50, 50, 90]);
  });

  /**
   * CHECKS_TM1.md T1-C12 — S3 is a snapshot, not a recomputation.
   *
   * Moved here from scripts/fixtures.test.ts, which asserted the same thing
   * but sits on a path `npm run test -- scoring` does not match, so the check's
   * own command never reached it.
   *
   * The end-to-end version of this guard — reading a historical assessment
   * back from the database — lands with the read path on Day 2. Until then
   * this asserts the stored components only.
   */
  it("a historical assessment keeps its STORED S3, not today's (T1-C12)", () => {
    const stored = goldenPathPersonDetail.assessments.map((a) => a.components.s3);
    assert.deepEqual(stored, [50, 50, 90]);

    // The same case row scored against TODAY, whenever today is. If any read
    // path ever recomputes instead of reading `components`, the first two
    // points move off 50 and the trend chart starts lying about the past.
    const recomputedNow = scoreS3(goldenCase, new Date()).score;
    for (const [i, a] of goldenPathPersonDetail.assessments.slice(0, 2).entries()) {
      assert.equal(
        a.components.s3,
        50,
        `assessment ${i} must report the 50 it was scored with, never ${recomputedNow}`,
      );
    }
  });

  it("a rising missed_count never lowers the composite (CLAUDE.md rule 5)", () => {
    let previous = -1;
    for (let missed = 0; missed <= 6; missed++) {
      const s4 = scoreS4(person({ missed_count: missed }), checkin());
      const { composite } = computeComposite(
        { s1: 50, s2: 55, s3: 90, s4: s4.score, s5: null },
        weights,
      );
      assert.ok(
        composite >= previous,
        `missed_count ${missed} lowered the composite from ${previous} to ${composite}`,
      );
      previous = composite;
    }
  });
});

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
