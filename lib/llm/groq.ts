/**
 * lib/llm/groq.ts — Groq, OpenAI-compatible chat completions, JSON mode.
 *
 * Owner: TM1. Implements docs/TM1_GUIDE.md section 4 (Prompt 5).
 *
 * The primary provider for this build. TM1_GUIDE.md section 2 gives the
 * reason: no card, and a daily ceiling high enough to run the eval sets more
 * than once, which the other free tiers are not. Verify the quota before
 * relying on it — providers cut them without notice.
 *
 * This file and ./openrouter.ts speak the same wire format and are still two
 * separate files rather than one parameterised adapter. They diverge in
 * headers, defaults and rate limits, they are each about thirty lines, and
 * "the provider file for X" being readable end to end is worth more here than
 * removing the duplication.
 */

import {
  DEFAULT_TEMPERATURE,
  MAX_OUTPUT_TOKENS,
  parseModelJson,
  postJson,
  requireEnv,
} from "./http";
import { LLMInvalidOutputError, type LLMProvider, type LlmRawResult } from "./types";

const NAME = "groq";
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Overridden by LLM_MODEL. Kept as a named constant because it ends up inside
 * assessments.model_version on every row, so changing it changes the
 * provenance of every assessment written afterwards.
 *
 * Was llama-3.3-70b-versatile. Groq announced its deprecation on 2026-06-17
 * and shut it down for free and developer tiers on 2026-08-16 — it is now
 * Enterprise-only, so it cannot be this project's default. gpt-oss-120b is
 * Groq's own named replacement for it.
 *
 * Verified against the provider's live model list on 2026-08-31. Production
 * tier, not preview. Re-verify before Day 5.
 */
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

export function createGroqProvider(): LLMProvider {
  const modelId = process.env.LLM_MODEL || DEFAULT_GROQ_MODEL;

  return {
    name: NAME,
    modelId,

    async complete(system: string, user: string): Promise<LlmRawResult> {
      // Read at call time, never at module load: server-only secret (CLAUDE.md).
      const apiKey = requireEnv(NAME, "LLM_API_KEY");

      const { envelope, ms } = await postJson({
        provider: NAME,
        url: ENDPOINT,
        headers: { authorization: `Bearer ${apiKey}` },
        body: {
          model: modelId,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          // JSON mode. The schema check in ./index.ts is what actually enforces
          // the contract; this only improves the odds of getting there.
          response_format: { type: "json_object" },
          temperature: DEFAULT_TEMPERATURE,
          max_tokens: MAX_OUTPUT_TOKENS,
        },
      });

      const raw = extractText(envelope);
      return { json: parseModelJson(NAME, raw), raw, ms };
    },
  };
}

/**
 * choices[0].message.content, defensively. A 200 with no content — an empty
 * choices array, or a response truncated by max_tokens — is a failed call, not
 * an empty reply, and must not reach the caller as one.
 */
function extractText(envelope: unknown): string {
  const choice = (
    envelope as { choices?: { message?: { content?: unknown } }[] }
  )?.choices?.[0];
  const content = choice?.message?.content;

  if (typeof content !== "string" || content.trim() === "") {
    throw new LLMInvalidOutputError(`${NAME}: response contained no message content`, {
      provider: NAME,
      raw: JSON.stringify(envelope ?? null).slice(0, 500),
    });
  }

  return content;
}
