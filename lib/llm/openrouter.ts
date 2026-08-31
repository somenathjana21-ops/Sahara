/**
 * lib/llm/openrouter.ts — OpenRouter, OpenAI-compatible, JSON mode.
 *
 * Owner: TM1. Implements docs/TM1_GUIDE.md section 4 (Prompt 5).
 *
 * Base URL https://openrouter.ai/api/v1, as specified.
 *
 * Read this before planning an eval run on it: TM1_GUIDE.md section 2 puts the
 * unfunded free tier at 20 requests per minute and 50 per day, and one pass of
 * the dev set is roughly 240 calls. It does not survive a single run. Its
 * value here is as the third entry in the provider-swap demo (CHECKS_TM1.md
 * T1-D1), where the point being made is that the safety numbers do not move.
 */

import {
  DEFAULT_TEMPERATURE,
  MAX_OUTPUT_TOKENS,
  parseModelJson,
  postJson,
  requireEnv,
} from "./http";
import { LLMInvalidOutputError, type LLMProvider, type LlmRawResult } from "./types";

const NAME = "openrouter";
const BASE_URL = "https://openrouter.ai/api/v1";
const ENDPOINT = `${BASE_URL}/chat/completions`;

/**
 * Overridden by LLM_MODEL. Ends up in assessments.model_version on every row.
 *
 * UNVERIFIED against the provider's live model list. Production tier, not
 * preview. Re-verify before Day 5.
 */
export const DEFAULT_OPENROUTER_MODEL = "meta-llama/llama-3.3-70b-instruct:free";

export function createOpenRouterProvider(): LLMProvider {
  const modelId = process.env.LLM_MODEL || DEFAULT_OPENROUTER_MODEL;

  return {
    name: NAME,
    modelId,

    async complete(system: string, user: string): Promise<LlmRawResult> {
      // Read at call time, never at module load: server-only secret (CLAUDE.md).
      const apiKey = requireEnv(NAME, "LLM_API_KEY");

      const { envelope, ms } = await postJson({
        provider: NAME,
        url: ENDPOINT,
        headers: {
          authorization: `Bearer ${apiKey}`,
          /*
           * OpenRouter attributes traffic by these two optional headers. They
           * carry the project name and nothing else — no persona, no
           * transcript, no key material — and are safe to send.
           */
          "http-referer": "https://github.com/sih-26094",
          "x-title": "SIH 26094 distress monitoring",
        },
        body: {
          model: modelId,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
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
 * choices[0].message.content, defensively.
 *
 * OpenRouter also answers 200 with a top-level `error` object when the
 * upstream model it routed to fails, so "no content" here is a routine
 * outcome rather than a theoretical one, and has to be an error and not an
 * empty reply.
 */
function extractText(envelope: unknown): string {
  const body = envelope as {
    choices?: { message?: { content?: unknown } }[];
    error?: { message?: string };
  };
  const content = body?.choices?.[0]?.message?.content;

  if (typeof content !== "string" || content.trim() === "") {
    const detail = body?.error?.message ? ` (${body.error.message})` : "";
    throw new LLMInvalidOutputError(
      `${NAME}: response contained no message content${detail}`,
      { provider: NAME, raw: JSON.stringify(envelope ?? null).slice(0, 500) },
    );
  }

  return content;
}
