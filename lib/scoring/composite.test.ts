/**
 * lib/scoring/composite.test.ts — renormalisation and the breakdown.
 *
 * Owner: TM1. `npm run test -- composite` (CHECKS_TM1.md T1-C3, a BLOCKER).
 *
 * The one sentence this file exists to defend: a missing signal is not a calm
 * signal (SCORING_AND_POLICY.md section 4).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeComposite, type CompositeWeights } from "./composite";
import { assignTier, compositeWeights, loadPolicy } from "@/lib/policy/engine";

const policy = loadPolicy();
const W: CompositeWeights = compositeWeights(policy);

describe("computeComposite — the additive composite (section 2)", () => {
  it("is 0.35 S1 + 0.25 S2 + 0.25 S3 + 0.15 S4 when nothing is missing", () => {
    const { composite, contributions } = computeComposite(
      { s1: 50, s2: 55, s3: 90, s4: 0, s5: null },
      W,
    );
    assert.equal(composite, 53.75);
    assert.deepEqual(contributions, {
      s1: 17.5,
      s2: 13.75,
      s3: 22.5,
      s4: 0,
      s5: null,
    });
  });

  it("returns contributions, because the dashboard renders them", () => {
    // CLAUDE.md rule 8: never a composite without its breakdown.
    const { composite, contributions } = computeComposite(
      { s1: 40, s2: 40, s3: 40, s4: 40, s5: null },
      W,
    );
    const sum =
      contributions.s1! + contributions.s2! + contributions.s3! + contributions.s4!;
    assert.equal(Math.round(sum * 100) / 100, composite);
  });
});

describe("renormalisation — a missing signal is not a calm signal (section 4)", () => {
  it("rescales the remaining weights over 0.75 when S2 is null", () => {
    const { composite, effectiveWeights, missing } = computeComposite(
      { s1: 50, s2: null, s3: 90, s4: 0, s5: null },
      W,
    );
    // (0.35*50 + 0.25*90 + 0.15*0) / 0.75 = 40 / 0.75
    assert.equal(composite, 53.33);
    assert.equal(round(effectiveWeights.s1, 4), round(0.35 / 0.75, 4));
    assert.equal(effectiveWeights.s2, 0);
    assert.deepEqual(missing, ["s2", "s5"]);
  });

  it("nulls the contribution of a missing component rather than zeroing it", () => {
    const { contributions } = computeComposite(
      { s1: 50, s2: null, s3: 90, s4: 0, s5: null },
      W,
    );
    assert.equal(contributions.s2, null);
    assert.notEqual(contributions.s2, 0);
  });

  it("does NOT substitute 0 for a missing S2", () => {
    const renormalised = computeComposite(
      { s1: 95, s2: null, s3: 55, s4: 50, s5: null },
      W,
    ).composite;
    const substituted = computeComposite(
      { s1: 95, s2: 0, s3: 55, s4: 50, s5: null },
      W,
    ).composite;

    assert.equal(renormalised, 72.67);
    assert.equal(substituted, 54.5);
    assert.ok(
      renormalised > substituted,
      "reading a provider outage as calm would drag the composite down by 18 points",
    );
  });

  it("S2 = null with high S1 and S3 still reaches RED (T1-C3)", () => {
    // Same inputs as above. S3 is 55, under the s3_gte 60 rule, so RED here
    // can only come from composite_gte 70 — which the renormalised composite
    // reaches and the 0-substituted one does not.
    const renormalised = computeComposite(
      { s1: 95, s2: null, s3: 55, s4: 50, s5: null },
      W,
    );
    const substituted = computeComposite(
      { s1: 95, s2: 0, s3: 55, s4: 50, s5: null },
      W,
    );

    const tierOf = (composite: number) =>
      assignTier(composite, 0.4, false, 55, false, 2, policy).tier;

    assert.equal(tierOf(renormalised.composite), "RED");
    assert.equal(
      tierOf(substituted.composite),
      "AMBER",
      "substituting 0 for a missing S2 would have downgraded this person to AMBER",
    );
  });

  it("renormalises the same way when several components are missing", () => {
    // Only S3 and S4 survive: (0.25*80 + 0.15*40) / 0.40
    const { composite } = computeComposite(
      { s1: null, s2: null, s3: 80, s4: 40, s5: null },
      W,
    );
    assert.equal(composite, 65);
  });

  it("says in the explanation that it renormalised", () => {
    const { reasons } = computeComposite(
      { s1: 50, s2: null, s3: 90, s4: 0, s5: null },
      W,
    );
    assert.ok(reasons.some((r) => r.includes("Renormalised")));
    assert.ok(reasons.some((r) => r.includes("S2 unavailable")));
  });
});

describe("S5 is weighted 0.00 and the code refuses to be talked out of it", () => {
  it("throws if handed a non-zero S5 weight (CLAUDE.md rule 9)", () => {
    assert.throws(
      () =>
        computeComposite({ s1: 50, s2: 55, s3: 90, s4: 0, s5: 80 }, {
          ...W,
          s5: 0.1,
        }),
      /S5 must be weighted 0\.00/,
    );
  });

  it("leaves the renormalisation denominator untouched whether S5 is present or not", () => {
    const a = computeComposite({ s1: 50, s2: null, s3: 90, s4: 0, s5: 99 }, W);
    const b = computeComposite({ s1: 50, s2: null, s3: 90, s4: 0, s5: null }, W);
    assert.equal(a.composite, b.composite);
  });
});

describe("no scoreable component", () => {
  it("throws rather than reporting a composite of 0", () => {
    assert.throws(
      () =>
        computeComposite({ s1: null, s2: null, s3: null, s4: null, s5: null }, W),
      /Refusing to return 0/,
    );
  });
});

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
