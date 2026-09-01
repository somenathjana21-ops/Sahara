/**
 * lib/policy/engine.ts — composite in, tier out.
 *
 * Owner: TM1. Implements docs/SCORING_AND_POLICY.md sections 7 and 8 and
 * docs/SAFETY_SPEC.md section 3 (TM1_GUIDE.md section 5, Prompt 6).
 *
 * The tier rules live in `policy/v1.yaml`, not in this file. That separation
 * is the tuning loop in section 10: adjust the YAML, bump the version, re-run
 * the eval, repeat. Code changes are not part of tuning.
 *
 * WHAT THIS FILE MAY NOT DO, enforced below and tested in ./policy.test.ts:
 *
 *   1. It may not produce CRITICAL. Only the deterministic triggers of
 *      SAFETY_SPEC.md section 3 — 'lexicon', 'panic_key', 'self_report_q3' —
 *      do that. A policy file that declares a CRITICAL tier rule fails to load.
 *   2. It may not LOWER a tier already set by a deterministic trigger. The
 *      model may raise Green -> Amber -> Red; it may never lower anything
 *      (CLAUDE.md rule 4).
 *   3. Nothing here consults an LLM, and nothing here may.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { TierSchema, TriggerSourceSchema } from "@/types/contract";
import type { Tier, TriggerSource } from "@/types/contract";
import type { CompositeWeights } from "@/lib/scoring/composite";
import { parseYaml } from "./yaml";

/* ── the policy file's shape ─────────────────────────────────────────────── */

const WeightsSchema = z.object({
  s1_self_report: z.number().min(0).max(1),
  s2_linguistic: z.number().min(0).max(1),
  s3_case_context: z.number().min(0).max(1),
  s4_engagement: z.number().min(0).max(1),
  /**
   * Pinned to 0 by the validator, not merely defaulted to it.
   *
   * SCORING_AND_POLICY.md section 2 and CLAUDE.md rule 9: acoustic emotion
   * inference is least accurate for exactly the callers this system exists
   * for, so S5 is extracted, displayed with a caveat, and never scored. If
   * someone "completes" the zero, the policy stops loading rather than
   * silently starting to weight it. That is the intended failure.
   */
  s5_acoustic: z.literal(0),
});

const BaselineSchema = z.object({
  ewma_lambda: z.number().gt(0).max(1),
  sigma_floor: z.number().positive(),
  change_point_z: z.number().positive(),
  min_history_for_change_point: z.number().int().nonnegative(),
});

/**
 * One clause of a rule's `any_of`. Exactly one key per clause, matching the
 * section 8 vocabulary. Unknown keys are rejected rather than ignored: a
 * typo'd `composite_gt` would silently never fire, and a rule that never fires
 * is a tier nobody is ever assigned.
 */
const ConditionSchema = z
  .union([
    z.object({ change_point: z.literal(true) }).strict(),
    z.object({ composite_gte: z.number() }).strict(),
    z.object({ s3_gte: z.number() }).strict(),
    z.object({ z_gte: z.number() }).strict(),
    z.object({ first_contact_composite_gte: z.number() }).strict(),
    z.object({ missed_checkins_gte: z.number().int() }).strict(),
  ])
  .describe("a single tier condition");

export type Condition = z.infer<typeof ConditionSchema>;

/**
 * A tier rule. `TierSchema.exclude(["CRITICAL"])` is guard 1 from the header
 * comment, applied at parse time: the policy engine has no vocabulary for
 * CRITICAL, so no amount of tuning can give the composite a route to it.
 */
const TierRuleSchema = z.union([
  z
    .object({
      tier: TierSchema.exclude(["CRITICAL"]),
      any_of: z.array(ConditionSchema).min(1),
    })
    .strict(),
  z
    .object({
      tier: TierSchema.exclude(["CRITICAL"]),
      default: z.literal(true),
    })
    .strict(),
]);

export type TierRule = z.infer<typeof TierRuleSchema>;

const EscalationEntrySchema = z.object({
  ack_required: z.boolean(),
  sla_minutes: z.number().int().nonnegative(),
  immediate_resources: z.boolean().optional(),
});

/**
 * Every tier needs an entry. `QueueItem.slaMinutes` is required, so a missing
 * GREEN forces the caller to invent one — which is what happened in v1.0 and
 * is why section 8 now states 10080 explicitly.
 */
const EscalationSchema = z.object({
  CRITICAL: EscalationEntrySchema,
  RED: EscalationEntrySchema,
  AMBER: EscalationEntrySchema,
  GREEN: EscalationEntrySchema,
});

export const PolicySchema = z
  .object({
    version: z.string().min(1),
    signed_by: z.string().min(1),
    weights: WeightsSchema,
    baseline: BaselineSchema,
    tiers: z.array(TierRuleSchema).min(1),
    floors: z
      .object({
        model_may_lower_tier: z.literal(false),
        critical_requires_deterministic_trigger: z.literal(true),
      })
      .strict(),
    escalation: EscalationSchema,
  })
  .strict()
  .refine((p) => p.tiers.some((r) => "default" in r), {
    message:
      "the tier list needs a `default: true` rule, or a check-in can match nothing and be assigned no tier",
  });

export type Policy = z.infer<typeof PolicySchema>;

/* ── loading ─────────────────────────────────────────────────────────────── */

export const DEFAULT_POLICY_PATH = "policy/v1.yaml";

/* ── the timezone interlock ──────────────────────────────────────────────── */

/** The canonical name. What every environment SHOULD be set to. */
export const REQUIRED_TZ = "Asia/Kolkata";

/**
 * Both accepted spellings of the same zone.
 *
 * "Asia/Calcutta" is the older IANA name for "Asia/Kolkata" — identical rules,
 * identical offset, no separate history. It is still the system default on
 * plenty of machines (this repo's own dev laptop resolves to it), so rejecting
 * it would fail a correctly configured setup and cost someone half an hour
 * chasing a timezone bug that isn't one. What the guard exists to catch is an
 * UNPINNED zone — a UTC server silently reading yesterday's date — and both
 * spellings rule that out equally.
 */
export const ACCEPTED_TZ = [REQUIRED_TZ, "Asia/Calcutta"] as const;

/**
 * FAIL CLOSED ON AN UNPINNED TIMEZONE. A wrong date is worse than a failed boot.
 *
 * `scoreS3` in lib/scoring/components.ts reads `today` through its LOCAL
 * calendar fields, because "the hearing is six days away" is a statement about
 * the counsellor's calendar and not about UTC. That makes S3 a function of the
 * PROCESS timezone, and Vercel runs UTC while this system is used in IST.
 *
 * Between 00:00 and 05:30 IST the UTC calendar date is still the previous day.
 * Both of S3's time-windowed rows are evaluated against that date, so a server
 * reading UTC can drop BOTH of them at once. Measured on the A-4471 case row:
 * at the instant 2026-08-29T02:00+05:30, an IST process scores S3 = 90 and a
 * UTC process scores S3 = 50. That is a 40-point swing on the component the
 * whole pitch rests on, from nothing but an unset environment variable, and it
 * would appear and disappear depending on what time of night the demo runs.
 *
 * So the policy refuses to load at all unless the timezone is pinned. A route
 * that 500s is diagnosable in ten seconds; a composite that is quietly 10
 * points light is not diagnosable at all, least of all on stage.
 *
 * This must be set as a real environment variable in every environment that
 * runs the pipeline, Vercel Production included. See README.md, "Deployed".
 *
 * WHY `PROJECT_TZ` AND NOT `TZ`. Vercel reserves the name `TZ` — it cannot be
 * created as a Project Environment Variable at all — so the deployed runtime
 * stays UTC no matter what this guard demands of it. Two things follow. The
 * guard checks a name we are actually permitted to set, and the date math
 * stopped depending on the process zone at all: `getTodayIST()` in
 * lib/scoring/components.ts applies the +05:30 to the INSTANT, so S3 reads
 * Indian calendar days on a UTC server.
 *
 * That makes `PROJECT_TZ` a declaration rather than a mechanism — this
 * deployment is operating on the IST calendar — and it still fails closed
 * without it, deliberately. An environment where nobody has stated which
 * calendar the case dates belong to does not get to score them.
 */
function assertTimezonePinned(): void {
  if ((ACCEPTED_TZ as readonly string[]).includes(process.env.PROJECT_TZ ?? "")) {
    return;
  }

  throw new Error(
    `PROJECT_TZ must be "${REQUIRED_TZ}" (or its older alias "Asia/Calcutta"), got ${
      process.env.PROJECT_TZ === undefined
        ? "an unset PROJECT_TZ"
        : `"${process.env.PROJECT_TZ}"`
    }. ` +
      "S3's time-windowed rows are evaluated against the IST calendar date, so an " +
      "undeclared timezone silently changes the score (SCORING_AND_POLICY.md " +
      "section 5). Set PROJECT_TZ=" +
      REQUIRED_TZ +
      " in the environment — in Vercel that is a Project Environment Variable, not " +
      ".env.local. It is PROJECT_TZ and not TZ because Vercel reserves TZ and will " +
      "not let you create it.",
  );
}

/** Parse and validate policy YAML from a string. Used by loadPolicy and tests. */
export function parsePolicy(source: string): Policy {
  return PolicySchema.parse(parseYaml(source));
}

let cached: { path: string; policy: Policy } | null = null;

/**
 * Read and zod-validate `policy/v1.yaml`.
 *
 * Server-side only — it touches the filesystem, so it belongs in route
 * handlers and scripts, never a client component. Cached per path because the
 * file cannot change within a request and every check-in reads it.
 *
 * A validation failure throws. It is not recoverable: without a policy there
 * is no tier, and assigning GREEN by default because a YAML key was misspelled
 * is the worst available outcome.
 *
 * The timezone check runs FIRST, before the cache, so a process that is going
 * to score dates wrongly cannot get as far as reading a weight.
 */
export function loadPolicy(policyPath: string = DEFAULT_POLICY_PATH): Policy {
  assertTimezonePinned();

  const resolved = path.isAbsolute(policyPath)
    ? policyPath
    : path.join(process.cwd(), policyPath);

  if (cached !== null && cached.path === resolved) return cached.policy;

  const policy = parsePolicy(readFileSync(resolved, "utf8"));
  cached = { path: resolved, policy };
  return policy;
}

/** Drop the cache. For tests that load more than one policy file. */
export function clearPolicyCache(): void {
  cached = null;
}

/** The section 8 weight keys, mapped onto the keys computeComposite wants. */
export function compositeWeights(policy: Policy): CompositeWeights {
  return {
    s1: policy.weights.s1_self_report,
    s2: policy.weights.s2_linguistic,
    s3: policy.weights.s3_case_context,
    s4: policy.weights.s4_engagement,
    s5: policy.weights.s5_acoustic,
  };
}

/* ── tier assignment ─────────────────────────────────────────────────────── */

/** Severity order, used only to compare two tiers. Never to compute one. */
const TIER_ORDER: Record<Tier, number> = {
  GREEN: 0,
  AMBER: 1,
  RED: 2,
  CRITICAL: 3,
};

/** The only trigger sources that may produce CRITICAL (SAFETY_SPEC.md section 3). */
export const CRITICAL_TRIGGER_SOURCES = [
  "lexicon",
  "panic_key",
  "self_report_q3",
] as const satisfies readonly TriggerSource[];

/**
 * A tier already set outside the composite, before assignTier runs: a lexicon
 * hit on the user's input, keypad 0 on `/call`, or q3 answered "not safe".
 *
 * `source` is never 'policy'. 'policy' is this engine's own output, and the
 * engine cannot floor itself.
 */
export interface DeterministicTrigger {
  tier: Tier;
  source: Exclude<TriggerSource, "policy">;
}

export interface TierDecision {
  tier: Tier;
  /**
   * The condition key that matched ("change_point", "composite_gte", "s3_gte",
   * "z_gte", "first_contact_composite_gte", "missed_checkins_gte", "default"),
   * or the trigger source when a deterministic trigger set the floor.
   */
  matchedRule: string;
  /** What goes in `assessments.trigger_source`. */
  triggerSource: TriggerSource;
  /** Human-readable, for `assessments.explanation`. */
  explanation: string[];
}

interface ConditionOutcome {
  matched: boolean;
  key: string;
  line: string;
}

function evaluate(
  condition: Condition,
  composite: number,
  z: number | null,
  changePoint: boolean,
  s3: number | null,
  firstContact: boolean,
  missedCount: number,
  policy: Policy,
): ConditionOutcome {
  if ("change_point" in condition) {
    return {
      matched: changePoint,
      key: "change_point",
      line: changePoint
        ? `Change point fired: z = ${fmt(z)} exceeds the ${policy.baseline.change_point_z} threshold in policy ${policy.version}.`
        : "No change point: this check-in is not a significant deviation from this person's own baseline.",
    };
  }

  if ("composite_gte" in condition) {
    const threshold = condition.composite_gte;
    const matched = composite >= threshold;
    return {
      matched,
      key: "composite_gte",
      line: `Composite ${fmt(composite)} ${matched ? "reaches" : "is below"} the ${threshold} threshold.`,
    };
  }

  if ("s3_gte" in condition) {
    const threshold = condition.s3_gte;
    const matched = s3 !== null && s3 >= threshold;
    return {
      matched,
      key: "s3_gte",
      line:
        s3 === null
          ? "S3 case context unavailable, so the case-file threshold was not evaluated."
          : `S3 case context ${fmt(s3)} ${matched ? "reaches" : "is below"} the ${threshold} threshold; the case file alone can escalate.`,
    };
  }

  if ("z_gte" in condition) {
    const threshold = condition.z_gte;
    const matched = z !== null && z >= threshold;
    return {
      matched,
      key: "z_gte",
      line:
        z === null
          ? "No baseline yet, so no deviation test was run."
          : `z = ${fmt(z)} ${matched ? "reaches" : "is below"} the ${threshold} threshold.`,
    };
  }

  if ("first_contact_composite_gte" in condition) {
    const threshold = condition.first_contact_composite_gte;
    const matched = firstContact && composite >= threshold;
    return {
      matched,
      key: "first_contact_composite_gte",
      line: firstContact
        ? `First contact with no baseline: composite ${fmt(composite)} ${matched ? "meets" : "is below"} the ${threshold} floor.`
        : "Not a first contact, so the first-contact floor does not apply.",
    };
  }

  const threshold = condition.missed_checkins_gte;
  const matched = missedCount >= threshold;
  return {
    matched,
    key: "missed_checkins_gte",
    line: `${missedCount} missed check-in${missedCount === 1 ? "" : "s"} ${matched ? "reaches" : "is below"} the ${threshold} threshold; silence never lowers a tier.`,
  };
}

function fmt(n: number | null): string {
  if (n === null) return "n/a";
  return String(Math.round(n * 100) / 100);
}

/**
 * Evaluate the tier rules top to bottom, first match wins.
 *
 * `historyCount`/`changePoint`/`z` come from lib/scoring/baseline.ts, and
 * `firstContact` means "no baseline existed before this check-in", i.e. z is
 * null. The caller passes them; this function has no clock and no database.
 *
 * `deterministic` is the floor. If a lexicon hit, a panic key, or q3 = "not
 * safe" already set a tier, the result is the MORE severe of that tier and the
 * policy's — never the less severe. That is CLAUDE.md rule 4 and
 * `floors.model_may_lower_tier: false`, in code rather than in a comment.
 */
export function assignTier(
  composite: number,
  z: number | null,
  changePoint: boolean,
  s3: number | null,
  firstContact: boolean,
  missedCount: number,
  policy: Policy,
  deterministic: DeterministicTrigger | null = null,
): TierDecision {
  if (deterministic !== null) {
    if (
      deterministic.tier === "CRITICAL" &&
      !(CRITICAL_TRIGGER_SOURCES as readonly string[]).includes(deterministic.source)
    ) {
      throw new Error(
        `CRITICAL requires a deterministic trigger source of ${CRITICAL_TRIGGER_SOURCES.join(" | ")} ` +
          `(SAFETY_SPEC.md section 3). Got '${deterministic.source}'.`,
      );
    }
  }

  const explanation: string[] = [];
  let matchedRule = "default";
  let policyTier: Tier = "GREEN";

  outer: for (const rule of policy.tiers) {
    if ("default" in rule) {
      policyTier = rule.tier;
      matchedRule = "default";
      explanation.push(
        `No escalation rule matched, so the default tier ${rule.tier} applies.`,
      );
      break;
    }

    for (const condition of rule.any_of) {
      const outcome = evaluate(
        condition,
        composite,
        z,
        changePoint,
        s3,
        firstContact,
        missedCount,
        policy,
      );
      if (outcome.matched) {
        policyTier = rule.tier;
        matchedRule = outcome.key;
        explanation.push(outcome.line);
        explanation.push(
          `Tier ${rule.tier}, matched rule '${outcome.key}' in policy ${policy.version}.`,
        );
        break outer;
      }
    }
  }

  if (deterministic === null) {
    return {
      tier: policyTier,
      matchedRule,
      triggerSource: "policy",
      explanation,
    };
  }

  // The floor. Take the more severe of the two, never the less severe.
  if (TIER_ORDER[deterministic.tier] >= TIER_ORDER[policyTier]) {
    return {
      tier: deterministic.tier,
      matchedRule: deterministic.source,
      triggerSource: deterministic.source,
      explanation: [
        `Tier ${deterministic.tier} set deterministically by ${deterministic.source} (SAFETY_SPEC.md section 3).`,
        `The composite would have assigned ${policyTier}; a deterministic trigger is never lowered by the policy engine.`,
        ...explanation,
      ],
    };
  }

  return {
    tier: policyTier,
    matchedRule,
    triggerSource: "policy",
    explanation: [
      ...explanation,
      `Raised above the ${deterministic.tier} set by ${deterministic.source}: the policy engine may raise a tier, never lower one.`,
    ],
  };
}

/** The escalation row for a tier: ack requirement and SLA. Section 8. */
export function escalationFor(policy: Policy, tier: Tier) {
  return policy.escalation[tier];
}
