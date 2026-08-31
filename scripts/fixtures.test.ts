/**
 * scripts/fixtures.test.ts — the golden path must stay arithmetically real.
 *
 * Owner: TM1. Guards docs/SCORING_AND_POLICY.md section 9 (v1.1).
 *
 * v1.0 shipped a worked example whose numbers did not add up and whose S3
 * never moved. Nothing caught it because nothing checked. This does.
 */

import { strict as assert } from "node:assert";
import test from "node:test";

import { goldenPathPersonDetail } from "./fixtures";

/** docs/SCORING_AND_POLICY.md section 2, mirrored in policy/v1.yaml. */
const WEIGHTS = { s1: 0.35, s2: 0.25, s3: 0.25, s4: 0.15, s5: 0.0 } as const;
const KEYS = ["s1", "s2", "s3", "s4", "s5"] as const;

const assessments = goldenPathPersonDetail.assessments;

test("golden path has the three seeded check-ins", () => {
  assert.equal(assessments.length, 3);
});

test("contributions sum to the composite on all three rows", () => {
  for (const a of assessments) {
    const sum = KEYS.reduce((t, k) => t + (a.contributions[k] ?? 0), 0);
    assert.ok(
      Math.abs(sum - a.composite) < 0.005,
      `${a.created_at}: contributions sum to ${sum}, composite is ${a.composite}`,
    );
  }
});

test("each contribution is its component times its weight", () => {
  for (const a of assessments) {
    for (const k of KEYS) {
      const component = a.components[k];
      const contribution = a.contributions[k];
      if (component === null) {
        assert.equal(
          contribution,
          null,
          `${a.created_at}: ${k} is null but contributed ${contribution}. A missing signal is not a calm signal.`,
        );
        continue;
      }
      assert.ok(
        Math.abs((contribution ?? 0) - component * WEIGHTS[k]) < 0.005,
        `${a.created_at}: ${k} = ${component} should contribute ${component * WEIGHTS[k]}, not ${contribution}`,
      );
    }
  }
});

// The stored-vs-recomputed assertion that used to live here has moved to
// lib/scoring/scoring.test.ts. CHECKS_TM1.md T1-C12 runs
// `npm run test -- scoring`, and scripts/ is not on that path, so the check
// could never actually reach it here.

test("the flat baseline stays under the s3_gte:60 RED rule", () => {
  for (const a of assessments.slice(0, 2)) {
    assert.ok(
      (a.components.s3 ?? 0) < 60,
      `${a.created_at}: S3 ${a.components.s3} would fire RED on a GREEN day`,
    );
    assert.equal(a.tier, "GREEN");
  }
});

test("S3 is the largest contribution on day 0 — demo beat #2 says so out loud", () => {
  const day0 = assessments[2];
  const s3 = day0.contributions.s3 ?? 0;
  assert.equal(s3, 22.5);
  for (const k of ["s1", "s2", "s4", "s5"] as const) {
    assert.ok(
      s3 > (day0.contributions[k] ?? 0),
      `S3 contributed ${s3}, ${k} contributed ${day0.contributions[k]} — beat #2 is a lie`,
    );
  }
});
