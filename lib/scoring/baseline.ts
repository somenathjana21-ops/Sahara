/**
 * lib/scoring/baseline.ts — the per-person baseline. This is what "Dynamic"
 * means in the problem statement.
 *
 * Owner: TM1. Implements docs/SCORING_AND_POLICY.md section 7
 * (TM1_GUIDE.md section 5, Prompt 6).
 *
 * Population thresholds systematically under-flag reserved people and
 * over-flag expressive ones. A stoic person's small change carries more
 * information than a demonstrative person's large absolute value, so every
 * deviation here is measured against that person's own history — an EWMA mean
 * and variance carried on `persons.baseline_mean` / `persons.baseline_var`.
 *
 * Pure functions. No I/O, no clock, no database.
 */

export const DEFAULT_LAMBDA = 0.3;
export const DEFAULT_SIGMA_FLOOR = 8;
export const DEFAULT_CHANGE_POINT_Z = 2.0;
export const DEFAULT_MIN_HISTORY = 2;

/** The EWMA state carried on the `persons` row between check-ins. */
export interface Baseline {
  /** EWMA mean, mu. */
  mean: number;
  /** EWMA variance, sigma squared. Never negative. */
  variance: number;
}

/**
 * Advance the baseline by one observation.
 *
 * ```
 * mu_t     = lambda * x_t + (1 - lambda) * mu_(t-1)
 * sigma2_t = lambda * (x_t - mu_(t-1))^2 + (1 - lambda) * sigma2_(t-1)
 * ```
 *
 * Both lines read `mu_(t-1)` — the variance update uses the deviation from the
 * OLD mean, not the new one. `zScore` must be called before this function for
 * the same reason (see the ORDER note there).
 *
 * First check-in (`prevMean === null`): `mu_0 = x_0`, `sigma2_0 = 0`. The first
 * composite becomes the baseline and there is nothing to deviate from yet;
 * `zScore` returns null and lib/policy/engine.ts applies the first-contact
 * floor instead.
 */
export function updateEWMA(
  prevMean: number | null,
  prevVar: number | null,
  x: number,
  lambda: number = DEFAULT_LAMBDA,
): Baseline {
  if (prevMean === null) {
    return { mean: x, variance: 0 };
  }

  const priorVar = prevVar ?? 0;
  const deviation = x - prevMean;

  return {
    mean: lambda * x + (1 - lambda) * prevMean,
    variance: lambda * deviation * deviation + (1 - lambda) * priorVar,
  };
}

/**
 * `z_t = (x_t - mu_(t-1)) / max(sigma_(t-1), sigmaFloor)`.
 *
 * ORDER MATTERS AND THIS IS THE EASY BUG (section 7). z is measured against
 * the baseline as it stood BEFORE this check-in updates it. Call this first,
 * then `updateEWMA`. If you update mu first, every deviation gets partly
 * absorbed into the thing you are measuring against and large spikes read as
 * smaller than they are — the exact direction this system cannot afford to be
 * wrong in.
 *
 * Returns null when there is no baseline yet. Null is not zero: "no deviation
 * measurable" and "no deviation observed" are different facts and the tier
 * rules treat them differently.
 *
 * The `max(sigma, 8)` floor stops a person with a flat history from tripping
 * on trivial noise. In the section 9 worked example the true sigma is 1.64, so
 * the floor is doing all the work — which is what it is for, and worth saying
 * aloud if a judge asks how you handle three data points.
 */
export function zScore(
  x: number,
  prevMean: number | null,
  prevVar: number | null,
  sigmaFloor: number = DEFAULT_SIGMA_FLOOR,
): number | null {
  if (prevMean === null) return null;

  const sigma = Math.sqrt(Math.max(0, prevVar ?? 0));
  return (x - prevMean) / Math.max(sigma, sigmaFloor);
}

/**
 * PRD feature #4, "sudden-shift detection": a deviation test against this
 * person's own history, not a threshold crossing.
 *
 * Fires when `z > threshold` AND the person has at least `minHistory` PRIOR
 * check-ins. `historyCount` is the count before this one — at the third
 * check-in it is 2. Both conditions are required: two points give a variance
 * of one deviation, which is not a history, and firing on it would make every
 * second check-in a change point.
 */
export function isChangePoint(
  z: number | null,
  historyCount: number,
  threshold: number = DEFAULT_CHANGE_POINT_Z,
  minHistory: number = DEFAULT_MIN_HISTORY,
): boolean {
  if (z === null) return false;
  return z > threshold && historyCount >= minHistory;
}
