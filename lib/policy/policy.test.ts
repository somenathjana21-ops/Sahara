/**
 * lib/policy/policy.test.ts — the policy file and the tier rules.
 *
 * Owner: TM1. `npm run test -- policy`.
 *
 * Covers CHECKS_TM1.md T1-C2 (S5 weighted zero), T1-C4 (the model cannot cause
 * CRITICAL), T1-C5 (the model cannot lower a tier) and T1-C7 (first-contact
 * floor) — all BLOCKERs.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assignTier,
  clearPolicyCache,
  compositeWeights,
  escalationFor,
  loadPolicy,
  parsePolicy,
  type Policy,
} from "./engine";
import { parseYaml } from "./yaml";

const policy = loadPolicy();

/* ── the file itself ─────────────────────────────────────────────────────── */

describe("loadPolicy — policy/v1.yaml (SCORING_AND_POLICY section 8)", () => {
  it("loads and validates the real file", () => {
    assert.equal(policy.version, "1.1.0");
    assert.equal(policy.signed_by, "TM1");
  });

  it("carries the section 2 weights, summing to 1.00", () => {
    assert.deepEqual(policy.weights, {
      s1_self_report: 0.35,
      s2_linguistic: 0.25,
      s3_case_context: 0.25,
      s4_engagement: 0.15,
      s5_acoustic: 0,
    });
    const w = compositeWeights(policy);
    assert.equal(w.s1 + w.s2 + w.s3 + w.s4 + w.s5, 1);
  });

  it("carries the section 7 baseline constants", () => {
    assert.deepEqual(policy.baseline, {
      ewma_lambda: 0.3,
      sigma_floor: 8,
      change_point_z: 2.0,
      min_history_for_change_point: 2,
    });
  });

  it("keeps the tier rules in order: RED, AMBER, GREEN default", () => {
    assert.deepEqual(
      policy.tiers.map((r) => r.tier),
      ["RED", "AMBER", "GREEN"],
    );
    assert.ok("default" in policy.tiers[2]);
  });

  it("has an escalation row for every tier, GREEN included", () => {
    assert.equal(escalationFor(policy, "CRITICAL").sla_minutes, 0);
    assert.equal(escalationFor(policy, "RED").sla_minutes, 30);
    assert.equal(escalationFor(policy, "AMBER").sla_minutes, 1440);
    // Missing in v1.0, which forced the fixture to invent 1440 for a required
    // QueueItem.slaMinutes. Now explicit at 7 days.
    assert.equal(escalationFor(policy, "GREEN").sla_minutes, 10080);
    assert.equal(escalationFor(policy, "CRITICAL").immediate_resources, true);
  });

  it("declares the two floors", () => {
    assert.equal(policy.floors.model_may_lower_tier, false);
    assert.equal(policy.floors.critical_requires_deterministic_trigger, true);
  });

  it("caches by path and clears on request", () => {
    assert.equal(loadPolicy(), policy);
    clearPolicyCache();
    assert.notEqual(loadPolicy(), policy);
  });
});

/* ── the guards baked into the schema ────────────────────────────────────── */

function withLine(find: string, replace: string): string {
  const source = SAMPLE_POLICY;
  assert.ok(source.includes(find), `sample policy has no line "${find}"`);
  return source.replace(find, replace);
}

/** A minimal, valid policy, used to prove what the validator rejects. */
const SAMPLE_POLICY = `version: "1.1.0"
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
  - tier: RED
    any_of:
      - change_point: true
  - tier: GREEN
    default: true

floors:
  model_may_lower_tier: false
  critical_requires_deterministic_trigger: true

escalation:
  CRITICAL: { ack_required: true,  sla_minutes: 0, immediate_resources: true }
  RED:      { ack_required: true,  sla_minutes: 30 }
  AMBER:    { ack_required: false, sla_minutes: 1440 }
  GREEN:    { ack_required: false, sla_minutes: 10080 }   # 7 days
`;

describe("the policy validator (T1-C2)", () => {
  it("accepts the sample", () => {
    assert.equal(parsePolicy(SAMPLE_POLICY).version, "1.1.0");
  });

  it("REFUSES a non-zero S5 weight", () => {
    // SCORING_AND_POLICY section 2, CLAUDE.md rule 9. Someone "completing"
    // the zero should break the build, not quietly start scoring acoustics.
    assert.throws(() =>
      parsePolicy(withLine("s5_acoustic:    0.00", "s5_acoustic:    0.10")),
    );
  });

  it("REFUSES a tier rule that declares CRITICAL", () => {
    // The policy engine has no vocabulary for CRITICAL, so no amount of
    // tuning can give the composite a route to it (SAFETY_SPEC section 3).
    assert.throws(() => parsePolicy(withLine("- tier: RED", "- tier: CRITICAL")));
  });

  it("REFUSES model_may_lower_tier: true", () => {
    assert.throws(() =>
      parsePolicy(withLine("model_may_lower_tier: false", "model_may_lower_tier: true")),
    );
  });

  it("REFUSES a tier list with no default rule", () => {
    assert.throws(() =>
      parsePolicy(SAMPLE_POLICY.replace("  - tier: GREEN\n    default: true\n", "")),
    );
  });

  it("REFUSES an unknown condition key", () => {
    // A typo'd `composite_gt` would never fire, and a rule that never fires is
    // a tier nobody is ever assigned.
    assert.throws(() =>
      parsePolicy(withLine("- change_point: true", "- composite_gt: 70")),
    );
  });

  it("REFUSES a missing escalation row", () => {
    assert.throws(() =>
      parsePolicy(
        SAMPLE_POLICY.replace("  GREEN:    { ack_required: false, sla_minutes: 10080 }   # 7 days\n", ""),
      ),
    );
  });
});

describe("the YAML subset reader", () => {
  it("reads the constructs policy/v1.yaml actually uses", () => {
    const parsed = parseYaml(SAMPLE_POLICY) as Record<string, unknown>;
    assert.equal(parsed.version, "1.1.0");
    assert.deepEqual((parsed.weights as Record<string, number>).s5_acoustic, 0);
    assert.deepEqual(parsed.tiers, [
      { tier: "RED", any_of: [{ change_point: true }] },
      { tier: "GREEN", default: true },
    ]);
    assert.deepEqual((parsed.escalation as Record<string, unknown>).RED, {
      ack_required: true,
      sla_minutes: 30,
    });
  });

  it("strips trailing comments but not a # inside a quoted string", () => {
    assert.deepEqual(parseYaml('a: 1 # note\nb: "x # y"\n'), { a: 1, b: "x # y" });
  });

  it("rejects tabs and unsupported constructs with a line number", () => {
    assert.throws(() => parseYaml("a:\n\tb: 1\n"), /line 2/);
    assert.throws(() => parseYaml("a: [1, 2]\n"), /flow sequences/);
    assert.throws(() => parseYaml("a:\n"), /has no value/);
  });
});

/* ── tier assignment ─────────────────────────────────────────────────────── */

/** assignTier with the golden-path shape, so each test varies one thing. */
function tier(
  o: Partial<{
    composite: number;
    z: number | null;
    changePoint: boolean;
    s3: number | null;
    firstContact: boolean;
    missedCount: number;
    policy: Policy;
  }> = {},
) {
  return assignTier(
    o.composite ?? 30,
    o.z === undefined ? 0.2 : o.z,
    o.changePoint ?? false,
    o.s3 === undefined ? 50 : o.s3,
    o.firstContact ?? false,
    o.missedCount ?? 0,
    o.policy ?? policy,
  );
}

describe("assignTier — top to bottom, first match wins (section 8)", () => {
  it("RED on a change point", () => {
    const d = tier({ changePoint: true });
    assert.equal(d.tier, "RED");
    assert.equal(d.matchedRule, "change_point");
  });

  it("RED on composite >= 70", () => {
    assert.deepEqual(pick(tier({ composite: 70 })), ["RED", "composite_gte"]);
    assert.equal(tier({ composite: 69.99 }).tier, "AMBER");
  });

  it("RED on S3 >= 60 even when the composite is calm", () => {
    // The whole point of S3: the case file escalates when the person says
    // they are fine (section 8, "s3_gte: 60 is load-bearing").
    assert.deepEqual(pick(tier({ composite: 20, s3: 60 })), ["RED", "s3_gte"]);
    assert.equal(tier({ composite: 20, s3: 59 }).tier, "GREEN");
  });

  it("AMBER on composite >= 45, z >= 1.2, or 3 missed check-ins", () => {
    assert.deepEqual(pick(tier({ composite: 45 })), ["AMBER", "composite_gte"]);
    assert.deepEqual(pick(tier({ z: 1.2 })), ["AMBER", "z_gte"]);
    assert.deepEqual(pick(tier({ missedCount: 3 })), [
      "AMBER",
      "missed_checkins_gte",
    ]);
  });

  it("applies the first-contact floor at composite >= 60 (T1-C7)", () => {
    // No baseline means no deviation to measure, so a first-time caller in
    // genuine distress would otherwise read as "no change" and get nothing.
    // Section 7's floor is "a raw composite >= 60 assigns AT LEAST Amber", and
    // that is what is asserted here: the tier, not which clause named it.
    assert.equal(
      tier({ composite: 60, z: null, firstContact: true, s3: 40 }).tier,
      "AMBER",
    );
    assert.equal(
      tier({ composite: 100, z: null, firstContact: true, s3: 40 }).tier,
      "RED",
      "at least Amber, not exactly Amber",
    );
    assert.equal(
      tier({ composite: 28, z: null, firstContact: true, s3: 50 }).tier,
      "GREEN",
      "the golden path's first check-in is below the floor",
    );
  });

  it("the first-contact clause is subsumed by composite_gte 45, by design", () => {
    // `composite_gte: 45` precedes `first_contact_composite_gte: 60` in the
    // same any_of, and every composite >= 60 is also >= 45, so the earlier
    // clause always names the match. The floor still does its job — it
    // guarantees the outcome even if composite_gte is later tuned above 60 —
    // but do not expect to see it in matchedRule. Section 10 tuning note: if
    // you raise composite_gte past 60, this clause starts firing on its own.
    const d = tier({ composite: 60, z: null, firstContact: true, s3: 40 });
    assert.equal(d.matchedRule, "composite_gte");

    const raised = parsePolicy(
      SAMPLE_POLICY.replace(
        "  - tier: GREEN\n    default: true\n",
        "  - tier: AMBER\n    any_of:\n      - composite_gte: 80\n      - first_contact_composite_gte: 60\n  - tier: GREEN\n    default: true\n",
      ),
    );
    const floored = tier({
      composite: 60,
      z: null,
      firstContact: true,
      s3: 40,
      policy: raised,
    });
    assert.deepEqual(pick(floored), ["AMBER", "first_contact_composite_gte"]);
  });

  it("GREEN by default, and says so", () => {
    const d = tier({ composite: 28, z: null, firstContact: true, s3: 50 });
    assert.equal(d.tier, "GREEN");
    assert.equal(d.matchedRule, "default");
    assert.ok(d.explanation.join(" ").includes("default"));
  });

  it("treats a null z and a null S3 as not-evaluated, never as passing", () => {
    assert.equal(tier({ z: null, s3: null, composite: 10 }).tier, "GREEN");
  });

  it("explains itself in sentences a counsellor can read", () => {
    const d = tier({ changePoint: true, z: 3.11 });
    assert.ok(d.explanation[0].includes("3.11"));
    assert.ok(d.explanation.join(" ").includes("policy 1.1.0"));
  });
});

/* ── the hard rules ──────────────────────────────────────────────────────── */

describe("the model cannot cause CRITICAL (T1-C4)", () => {
  it("never returns CRITICAL from the composite path, at any input", () => {
    // A mocked LLM returning s2_score 100 on a non-crisis transcript: S2 is
    // 25% of the composite and cannot exceed it. Even every component at 100
    // and a change point tops out at RED.
    for (const composite of [0, 45, 70, 99, 100]) {
      for (const changePoint of [false, true]) {
        const d = tier({ composite, changePoint, s3: 100, z: 9, missedCount: 9 });
        assert.notEqual(d.tier, "CRITICAL", `composite ${composite}`);
        assert.equal(d.triggerSource, "policy");
      }
    }
  });

  it("rejects a CRITICAL floor that claims a source outside section 3", () => {
    assert.throws(
      () =>
        assignTier(10, 0, false, 10, false, 0, policy, {
          tier: "CRITICAL",
          // @ts-expect-error 'policy' is excluded from DeterministicTrigger on
          // purpose; this proves the runtime guard as well as the type.
          source: "policy",
        }),
      /CRITICAL requires a deterministic trigger source/,
    );
  });

  it("accepts CRITICAL from each of the three permitted sources", () => {
    for (const source of ["lexicon", "panic_key", "self_report_q3"] as const) {
      const d = assignTier(10, 0, false, 10, false, 0, policy, {
        tier: "CRITICAL",
        source,
      });
      assert.equal(d.tier, "CRITICAL");
      assert.equal(d.triggerSource, source);
      assert.equal(d.matchedRule, source);
    }
  });
});

describe("the policy engine cannot lower a deterministic tier (T1-C5)", () => {
  it("keeps CRITICAL when the composite would have said GREEN", () => {
    const d = assignTier(5, -1, false, 0, false, 0, policy, {
      tier: "CRITICAL",
      source: "lexicon",
    });
    assert.equal(d.tier, "CRITICAL");
    assert.ok(d.explanation.join(" ").includes("never lowered"));
  });

  it("keeps a deterministic RED when the composite would have said AMBER", () => {
    const d = assignTier(50, 0.2, false, 50, false, 0, policy, {
      tier: "RED",
      source: "panic_key",
    });
    assert.equal(d.tier, "RED");
  });

  it("still RAISES above a deterministic floor — the model may raise", () => {
    // CLAUDE.md rule 4: the LLM may raise a tier, never lower one.
    const d = assignTier(80, 0.2, false, 90, false, 0, policy, {
      tier: "AMBER",
      source: "panic_key",
    });
    assert.equal(d.tier, "RED");
    assert.equal(d.triggerSource, "policy");
    assert.ok(d.explanation.join(" ").includes("never lower one"));
  });

  it("is monotone in every escalating input", () => {
    // No input that should raise concern may lower the assigned tier.
    const order = { GREEN: 0, AMBER: 1, RED: 2, CRITICAL: 3 } as const;
    let previous = -1;
    for (const missedCount of [0, 1, 2, 3, 4, 5]) {
      const t = order[tier({ composite: 30, missedCount }).tier];
      assert.ok(t >= previous, `missed_count ${missedCount} lowered the tier`);
      previous = t;
    }
  });
});

function pick(d: { tier: string; matchedRule: string }): [string, string] {
  return [d.tier, d.matchedRule];
}
