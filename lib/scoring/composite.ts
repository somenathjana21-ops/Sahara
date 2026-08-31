/**
 * lib/scoring/composite.ts — the additive composite and its breakdown.
 *
 * Owner: TM1. Implements docs/SCORING_AND_POLICY.md sections 2 and 4
 * (TM1_GUIDE.md section 5, Prompt 6).
 *
 * ```
 * composite = 0.35*S1 + 0.25*S2 + 0.25*S3 + 0.15*S4 + 0.00*S5
 * ```
 *
 * The contributions are returned alongside the composite because the dashboard
 * renders them and because CLAUDE.md rule 8 forbids showing a composite
 * without its breakdown. The breakdown IS the explainability feature — an
 * additive composite of five named components explains itself, which is the
 * entire reason this is not a trained classifier (section 1).
 *
 * Pure. No I/O.
 */

import type {
  ComponentContributions,
  ComponentScores,
} from "@/types/contract";

/** The weights from `policy/v1.yaml`, keyed to match ComponentScores. */
export interface CompositeWeights {
  s1: number;
  s2: number;
  s3: number;
  s4: number;
  /** MUST be 0. See the guard in computeComposite and CLAUDE.md rule 9. */
  s5: number;
}

export interface CompositeResult {
  /** 0-100, rounded to 2dp so it matches the document a judge is recomputing. */
  composite: number;
  /** Weighted value of each component; null wherever the component is null. */
  contributions: ComponentContributions;
  /**
   * The weights actually applied after renormalisation. Equal to the policy
   * weights when nothing is missing; scaled up when something is.
   */
  effectiveWeights: CompositeWeights;
  /** Component keys that were null and therefore excluded. */
  missing: (keyof ComponentScores)[];
  /** One line per component, for `assessments.explanation`. */
  reasons: string[];
}

const KEYS = ["s1", "s2", "s3", "s4", "s5"] as const;

/** Two decimal places, matching the precision the worked example is written in. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Weights get four decimals because a renormalised one is not round: with S2
 * missing, 0.35 becomes 0.4667 and the counsellor should see that, not "0.47".
 */
function fmtWeight(w: number): string {
  return String(Math.round(w * 10_000) / 10_000);
}

/**
 * Compute the composite, RENORMALISING over the weights of the components that
 * are actually present.
 *
 * NEVER SUBSTITUTE 0 FOR A MISSING SIGNAL (section 4). If the LLM provider is
 * unreachable, S2 is null and the remaining weights are rescaled over 0.75 —
 * the person is scored on what is known about them. Defaulting S2 to 0 would
 * read a provider outage as evidence of calm and drag every composite down by
 * up to 25 points at exactly the moment the system is already degraded.
 *
 * Two guards, both deliberate:
 *
 * - A non-zero S5 weight throws. That zero is a design decision
 *   (SCORING_AND_POLICY.md section 2, CLAUDE.md rule 9); see the block comment
 *   in ./components.ts. Because its weight is 0, S5 being null or present
 *   changes neither the composite nor the renormalisation denominator.
 * - Every scoreable component being null throws rather than returning 0.
 *   There is no composite to report and 0 would be a false statement of calm.
 *   In practice this cannot happen: S3 and S4 are deterministic from the case
 *   row and the person row and are always computable.
 */
export function computeComposite(
  components: ComponentScores,
  weights: CompositeWeights,
): CompositeResult {
  if (weights.s5 !== 0) {
    throw new Error(
      "S5 must be weighted 0.00 (SCORING_AND_POLICY.md section 2, CLAUDE.md rule 9). " +
        `Got ${weights.s5}. Acoustic emotion inference is least accurate for the ` +
        "callers this system exists for; it is displayed with a caveat and never scored.",
    );
  }

  const present = KEYS.filter((k) => components[k] !== null);
  const missing = KEYS.filter((k) => components[k] === null);

  const denominator = present.reduce((sum, k) => sum + weights[k], 0);
  if (denominator === 0) {
    throw new Error(
      "No scoreable component is present, so there is no composite to report. " +
        "Refusing to return 0: a missing signal is not a calm signal " +
        "(SCORING_AND_POLICY.md section 4).",
    );
  }

  const effectiveWeights = {} as CompositeWeights;
  const contributions = {} as ComponentContributions;
  const reasons: string[] = [];
  let composite = 0;

  for (const k of KEYS) {
    const score = components[k];
    if (score === null) {
      effectiveWeights[k] = 0;
      contributions[k] = null;
      continue;
    }
    const w = weights[k] / denominator;
    const contribution = round2(w * score);
    effectiveWeights[k] = w;
    contributions[k] = contribution;
    composite += w * score;
  }

  for (const k of KEYS) {
    const score = components[k];
    if (score === null) {
      reasons.push(`${k.toUpperCase()} unavailable: excluded and weights renormalised.`);
    } else if (weights[k] === 0) {
      reasons.push(
        `${k.toUpperCase()} ${round2(score)}: displayed only, weighted 0.00 and contributing nothing.`,
      );
    } else {
      reasons.push(
        `${k.toUpperCase()} ${round2(score)} x ${fmtWeight(effectiveWeights[k])} = ${contributions[k]}.`,
      );
    }
  }

  if (missing.length > 0) {
    reasons.push(
      `Renormalised over the remaining weights (denominator ${round2(denominator)}); ` +
        "a missing signal was not read as 0.",
    );
  }

  return {
    composite: round2(composite),
    contributions,
    effectiveWeights,
    missing,
    reasons,
  };
}
