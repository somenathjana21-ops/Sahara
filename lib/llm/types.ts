/**
 * lib/llm/types.ts — the provider seam.
 *
 * Owner: TM1. Implements docs/TM1_GUIDE.md section 4 (Prompt 5) and the JSON
 * contract in docs/SAFETY_SPEC.md section 7.
 *
 * Everything in lib/llm/ exists so that the rest of the app cannot tell which
 * model is answering. A route handler imports `getProvider` and `complete`
 * from lib/llm and never learns whether the bytes came from Groq, Gemini,
 * OpenRouter or a laptop running Ollama. Swapping one for another is an env
 * var, which is the whole point of the "switch out the model" demo
 * (TM1_GUIDE.md section 4, CHECKS_TM1.md T1-D1).
 *
 * ## What this layer is NOT
 *
 * It is not part of the safety path. Crisis detection is deterministic code in
 * lib/safety/lexicon.ts and nowhere else (CLAUDE.md rule 1), the interlock runs
 * before anything here is reached and again on whatever comes back
 * (SAFETY_SPEC.md section 2), and no file in this directory may import from
 * lib/safety/ to "help" with that. This layer has three jobs only: speak the
 * provider's wire format, retry the retryable, and refuse to hand the caller
 * anything that is not the exact JSON shape section 7 asks for.
 */

import { z } from "zod";
import { LanguageSchema } from "@/types/contract";

/* ── the seam ────────────────────────────────────────────────────────────── */

/**
 * What every provider in this directory returns, byte-identically shaped.
 *
 * `json` is deliberately `unknown`: a provider's job ends at "I got a response
 * and it parsed as JSON". Deciding whether that JSON is the thing SAFETY_SPEC
 * section 7 asked for is the job of `complete()` in ./index.ts — once, for all
 * four providers. See LlmOutputSchema below.
 *
 * `raw` is the model's own text before JSON.parse. It is kept so a schema
 * failure can be logged with the prose the model actually wrote instead of a
 * bare "invalid JSON", and so an eval run can show what a provider emitted.
 *
 * `ms` is wall-clock latency for the whole call including retries, which is
 * what the provider comparison table in TM1_GUIDE.md section 7 reports.
 */
export interface LlmRawResult {
  json: unknown;
  raw: string;
  ms: number;
}

/**
 * The adapter interface. Four implementations, one shape.
 *
 * `name` and `modelId` are not decoration: `name + ':' + modelId` is written
 * to assessments.model_version on every row (CLAUDE.md, "Every assessment row
 * records policy_version and model_version"). Use `modelVersion()` from
 * ./index.ts rather than concatenating by hand.
 */
export interface LLMProvider {
  /** Stable slug, and the accepted value of LLM_PROVIDER: 'groq' | 'gemini' | 'openrouter' | 'ollama'. */
  name: string;
  /** The resolved model, after LLM_MODEL and the provider's default. */
  modelId: string;
  complete(system: string, user: string): Promise<LlmRawResult>;
}

/* ── the model's output contract ─────────────────────────────────────────── */

/**
 * The markers the prompt allows. Closed set, copied from SAFETY_SPEC.md
 * section 7. A model that invents "suicidal" or "crisis" as a marker fails
 * validation, which is correct: markers are a counsellor-facing summary, not a
 * side channel through which a model can assert a crisis. Only the
 * deterministic triggers in SAFETY_SPEC.md section 3 do that.
 */
export const MarkerSchema = z.enum([
  "hopelessness",
  "isolation",
  "fear",
  "anger",
  "exhaustion",
  "numbness",
]);
export type Marker = z.infer<typeof MarkerSchema>;

/**
 * The three self-report questions, from SCORING_AND_POLICY.md section 3. The
 * prompt asks the model to pick the next one "from the provided question
 * list"; this is that list, closed.
 */
export const QuestionIdSchema = z.enum(["q1", "q2", "q3"]);
export type QuestionId = z.infer<typeof QuestionIdSchema>;

/**
 * The JSON block at the end of SAFETY_SPEC.md section 7, field for field.
 *
 * What is deliberately NOT here:
 *
 * - No `tier`. The model is never asked for one and may not send one; if it
 *   sends one anyway the field is stripped, not read (SAFETY_SPEC.md section 8
 *   test S7 — a model returning "Green" on a critical input is ignored).
 * - No length cap on `reply`. The 320-character rule is Pass 2's
 *   (SAFETY_SPEC.md section 6) and lives in lib/safety/interlock.ts. Enforcing
 *   it here as well would put one safety rule in two files and let them drift.
 * - `s2_score` is not coerced from a string. A model that writes "70" instead
 *   of 70 is a model not following the contract, and the caller degrading to
 *   S1/S3/S4 is a better outcome than a quietly repaired number.
 *
 * Unknown keys are stripped rather than rejected: providers legitimately add
 * their own fields, and the six below are what the pipeline reads.
 */
export const LlmOutputSchema = z.object({
  reply: z.string().min(1),
  /**
   * 0-100 linguistic distress. A SIGNAL, not a decision: 25% of one composite,
   * and it cannot by itself produce Critical (SAFETY_SPEC.md section 7).
   */
  s2_score: z.number().min(0).max(100),
  markers: z.array(MarkerSchema),
  /** Short phrases quoted from the user's own message, shown to the counsellor as evidence. */
  evidence: z.array(z.string()),
  /** Reuses the contract enum rather than redeclaring ["en","hi"] (CLAUDE.md, conventions). */
  language: LanguageSchema,
  /**
   * Case-folded before validating, then checked against the closed list.
   *
   * The live model returned "Q1" on one call and "q1" on the next from the
   * identical prompt, so the case carries no information and folding it is a
   * repair of the same kind as the code-fence unwrap in ./http.ts: it changes
   * the packaging, never the answer. An id outside the list — "q4", "sleep",
   * a question the model invented — still fails loudly, because that IS the
   * answer being wrong.
   */
  next_question_id: z
    .string()
    .transform((id) => id.trim().toLowerCase())
    .pipe(QuestionIdSchema),
});
export type LlmOutput = z.infer<typeof LlmOutputSchema>;

/** What `complete()` in ./index.ts hands back: validated output plus provenance. */
export interface LlmCall {
  output: LlmOutput;
  raw: string;
  ms: number;
  /** Exactly the string that goes into assessments.model_version. */
  modelVersion: string;
}

/* ── errors ──────────────────────────────────────────────────────────────── */

/**
 * The model could not be used. Thrown after retries are exhausted, on a
 * non-retryable HTTP status, on a timeout, and on a response that is not
 * usable JSON.
 *
 * The caller catches this and degrades: S2 is null, the composite is
 * renormalised over S1/S3/S4, the check-in still logs, and
 * `replies.llm_unavailable` is shown (SAFETY_SPEC.md section 8 test S5,
 * CHECKS_TM1.md T1-D3). It is a degradation, never a 500 — a person mid
 * check-in must not lose their session because a free tier ran out.
 */
export class LLMUnavailableError extends Error {
  readonly provider: string;
  readonly status?: number;

  constructor(
    message: string,
    opts: { provider: string; status?: number; cause?: unknown },
  ) {
    super(message, { cause: opts.cause });
    this.name = "LLMUnavailableError";
    this.provider = opts.provider;
    this.status = opts.status;
  }
}

/**
 * The provider answered, but with something that is not the JSON of
 * SAFETY_SPEC.md section 7 — prose, a markdown apology, a missing field, a
 * marker outside the enum.
 *
 * This extends LLMUnavailableError on purpose, and the reasoning is worth
 * keeping. "Fail loudly, not silently" (TM1_GUIDE.md section 4) is about never
 * inventing an s2_score the model did not produce; it is not about taking the
 * check-in down. So this is its own class, with its own name, carrying the
 * offending text in `.raw` for the log — loud — while still being caught by
 * the single `catch (e) { if (e instanceof LLMUnavailableError) degrade() }`
 * that test S5 requires. Prose from the model and a 503 from the model leave
 * the pipeline in the same state: no S2, everything else intact.
 */
export class LLMInvalidOutputError extends LLMUnavailableError {
  /** The model's own text, truncated by the thrower for logging. */
  readonly raw: string;

  constructor(
    message: string,
    opts: { provider: string; raw: string; cause?: unknown },
  ) {
    super(message, { provider: opts.provider, cause: opts.cause });
    this.name = "LLMInvalidOutputError";
    this.raw = opts.raw;
  }
}

/**
 * LLM_PROVIDER is unset, or names a provider that does not exist.
 *
 * NOT an LLMUnavailableError, and that distinction is the point: an
 * unreachable provider is a runtime condition to degrade through, whereas a
 * misconfigured one is a deployment mistake that would otherwise degrade
 * silently and forever — every assessment quietly missing S2, nobody noticing
 * until the demo. This one is meant to be noisy on the first request.
 */
export class UnknownProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnknownProviderError";
  }
}
