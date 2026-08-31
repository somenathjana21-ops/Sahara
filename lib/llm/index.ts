/**
 * lib/llm/index.ts — the only door into the model.
 *
 * Owner: TM1. Implements docs/TM1_GUIDE.md section 4 (Prompt 5).
 *
 * Route handlers import from here and from nowhere else in this directory. No
 * route, and nothing under lib/safety/, may import a provider file directly
 * (CHECKS_TM1.md T1-D2: `grep -rn "groq\|generativeai\|openrouter\|openai" app
 * lib --include=*.ts | grep -v "^lib/llm/"` must print nothing).
 *
 * Typical call site, and the shape test S5 depends on:
 *
 *   try {
 *     const call = await complete(SYSTEM_PROMPT, turn);
 *     s2 = call.output.s2_score;                 // a signal, never a decision
 *     modelVersionForRow = call.modelVersion;
 *   } catch (e) {
 *     if (!(e instanceof LLMUnavailableError)) throw e;
 *     s2 = null;                                  // degrade: S1/S3/S4 only
 *     reply = replies.llm_unavailable;
 *   }
 *
 * The interlock runs before this call and again on `call.output.reply`
 * afterwards (SAFETY_SPEC.md section 2). Nothing in this file does either —
 * putting a lexicon check in here would put crisis detection behind a network
 * call, which is the failure CLAUDE.md rule 1 exists to prevent.
 */

import { createGeminiProvider } from "./gemini";
import { createGroqProvider } from "./groq";
import { createOllamaProvider } from "./ollama";
import { createOpenRouterProvider } from "./openrouter";
import { PROMPT_VERSION } from "./prompt";
import {
  LLMInvalidOutputError,
  LlmOutputSchema,
  UnknownProviderError,
  type LLMProvider,
  type LlmCall,
} from "./types";

export {
  LLMInvalidOutputError,
  LLMUnavailableError,
  LlmOutputSchema,
  MarkerSchema,
  UnknownProviderError,
  type LLMProvider,
  type LlmCall,
  type LlmOutput,
  type LlmRawResult,
  type Marker,
} from "./types";
export { PROMPT_VERSION, SYSTEM_PROMPT } from "./prompt";

/**
 * Every accepted value of LLM_PROVIDER. The keys are the whole configuration
 * surface, and each value is a factory rather than an instance so that
 * LLM_MODEL is read per call and a test can change it between cases.
 */
const PROVIDERS: Record<string, () => LLMProvider> = {
  groq: createGroqProvider,
  gemini: createGeminiProvider,
  openrouter: createOpenRouterProvider,
  ollama: createOllamaProvider,
};

/** For the error message, and for the eval runner's --compare flag. */
export const PROVIDER_NAMES = Object.keys(PROVIDERS);

/**
 * Resolve LLM_PROVIDER to an adapter.
 *
 * Throws UnknownProviderError — deliberately not an LLMUnavailableError — when
 * the variable is unset or misspelled. See the note on that class in ./types:
 * a typo that silently degraded every assessment to "no S2" would look exactly
 * like a working system right up until someone read the breakdown on stage.
 *
 * `name` is a parameter so the eval runner can drive all four in one process
 * (TM1_GUIDE.md section 7, --compare groq,gemini,openrouter).
 */
export function getProvider(name = process.env.LLM_PROVIDER): LLMProvider {
  const key = (name ?? "").trim().toLowerCase();

  if (key === "") {
    throw new UnknownProviderError(
      `LLM_PROVIDER is not set. Set it to one of: ${PROVIDER_NAMES.join(", ")}.`,
    );
  }

  const factory = PROVIDERS[key];
  if (!factory) {
    throw new UnknownProviderError(
      `LLM_PROVIDER="${name}" is not a known provider. Valid values: ${PROVIDER_NAMES.join(", ")}.`,
    );
  }

  return factory();
}

/**
 * The exact string written to assessments.model_version:
 *
 *   groq:openai/gpt-oss-120b+prompt-1.0.0
 *
 * This resolves the conflict between TM1_GUIDE.md section 4, which specifies
 * `provider.name + ':' + modelId`, and SAFETY_SPEC.md section 7, which says
 * PROMPT_VERSION goes into model_version on every assessment. Both are true of
 * the string above: one column, both facts, `split("+")` to get them apart,
 * and no change to the frozen types/contract.ts.
 *
 * Both halves are needed to interpret a row. The model decides what S2 looks
 * like; the prompt decides what the model was asked for. An assessment scored
 * under a different prompt is not comparable to this one even on identical
 * hardware, and six months from now the string is the only surviving record of
 * which was in force.
 *
 * Build it here rather than by hand at the call site, so every row in the
 * table is comparable and a provider swap is visible in the data instead of
 * being something you have to remember happened.
 */
export function modelVersion(provider: LLMProvider): string {
  return `${provider.name}:${provider.modelId}+prompt-${PROMPT_VERSION}`;
}

/**
 * Call the model and return output that has been checked against
 * SAFETY_SPEC.md section 7, or throw.
 *
 * This is where validation lives — once, for all four providers, so a model
 * cannot be trusted more on one provider than another. `LlmRawResult.json` is
 * `unknown` up to this line and typed after it.
 *
 * Both failure modes (provider unreachable, model wrote prose) leave the
 * caller in the same place: catch LLMUnavailableError, set S2 null, keep the
 * check-in. Nothing here invents a score.
 */
export async function complete(
  system: string,
  user: string,
  provider: LLMProvider = getProvider(),
): Promise<LlmCall> {
  try {
    const { json, raw, ms } = await provider.complete(system, user);

    const parsed = LlmOutputSchema.safeParse(json);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      throw new LLMInvalidOutputError(
        `${provider.name}: model output did not match the SAFETY_SPEC section 7 schema — ${issues}`,
        { provider: provider.name, raw, cause: parsed.error },
      );
    }

    return {
      output: parsed.data,
      raw,
      ms,
      modelVersion: modelVersion(provider),
    };
  } catch (error) {
    if (error instanceof LLMInvalidOutputError) logInvalidOutput(provider, error);
    throw error;
  }
}

/**
 * Observability, not control flow. The rethrow above is untouched: the caller
 * still degrades to S1/S3/S4 exactly as it does for an outage.
 *
 * The reason this needs its own line in the log is that the two failures look
 * identical from the outside and are not the same thing. An outage is loud and
 * temporary — the free tier is down, someone notices. A model that has quietly
 * stopped emitting section-7 JSON produces tiers that look completely normal,
 * with S2 null on every single row, forever, and nothing anywhere says so. The
 * one is weather; the other is a broken instrument reporting fair conditions.
 *
 * One line, structured, greppable: `grep llm_invalid_output` over a run tells
 * you whether a provider is broken rather than unlucky, and the raw excerpt
 * says what it emitted instead.
 *
 * console.warn, not console.error: this is a degradation the system is
 * designed to absorb, and it must not page anyone at 3am. It is also NOT the
 * Pass-2 rejection count from SAFETY_SPEC.md section 6 — that metric counts
 * replies the interlock threw away, which is a different event with a
 * different meaning, and the two must not be added together.
 */
function logInvalidOutput(
  provider: LLMProvider,
  error: LLMInvalidOutputError,
): void {
  /*
   * JSON.stringify, so a model that emitted three paragraphs still produces
   * exactly one log line — newlines inside .raw come out escaped.
   *
   * `raw` is model output, and the model is echoing a person in distress: this
   * excerpt can contain their words. It is capped at 120 characters and goes
   * to the server log only. Do not widen it, do not add the user's message
   * next to it, and do not put it anywhere a staff UI can render (CLAUDE.md
   * rule 6).
   */
  console.warn(
    JSON.stringify({
      event: "llm_invalid_output",
      provider: provider.name,
      modelId: provider.modelId,
      raw: error.raw.slice(0, INVALID_OUTPUT_LOG_CHARS),
    }),
  );
}

/** Enough to tell prose from JSON from an empty string. Not enough to be a transcript. */
const INVALID_OUTPUT_LOG_CHARS = 120;
