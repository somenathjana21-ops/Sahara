/**
 * lib/llm/gemini.ts — Google AI Studio, generateContent, JSON mode.
 *
 * Owner: TM1. Implements docs/TM1_GUIDE.md section 4 (Prompt 5).
 *
 * The one provider here that is not OpenAI-shaped: the system prompt goes in
 * `systemInstruction`, the turn goes in `contents`, JSON mode is
 * `responseMimeType`, and the text comes back split across `parts`. That is
 * the whole reason the adapter pattern exists — the difference stops at this
 * file, and ./index.ts hands the caller the same object either way.
 *
 * Quota warning from TM1_GUIDE.md section 2: the free Flash tier was cut
 * sharply in December 2025 and the real numbers vary by region. Check AI
 * Studio for your own project before planning an eval run around it.
 */

import {
  DEFAULT_TEMPERATURE,
  MAX_OUTPUT_TOKENS,
  parseModelJson,
  postJson,
  requireEnv,
} from "./http";
import { LLMInvalidOutputError, type LLMProvider, type LlmRawResult } from "./types";

const NAME = "gemini";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Overridden by LLM_MODEL. Ends up in assessments.model_version on every row.
 *
 * UNVERIFIED against the provider's live model list. Production tier, not
 * preview. Re-verify before Day 5.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";

export function createGeminiProvider(): LLMProvider {
  // 'models/gemini-2.0-flash' and 'gemini-2.0-flash' are both things people
  // paste out of AI Studio; the path wants the bare id.
  const modelId = (process.env.LLM_MODEL || DEFAULT_GEMINI_MODEL).replace(
    /^models\//,
    "",
  );

  return {
    name: NAME,
    modelId,

    async complete(system: string, user: string): Promise<LlmRawResult> {
      // Read at call time, never at module load: server-only secret (CLAUDE.md).
      const apiKey = requireEnv(NAME, "LLM_API_KEY");

      const { envelope, ms } = await postJson({
        provider: NAME,
        // The key goes in a header, not the documented ?key= query parameter.
        // A URL travels into proxy logs and error strings; a header does not.
        url: `${API_BASE}/${encodeURIComponent(modelId)}:generateContent`,
        headers: { "x-goog-api-key": apiKey },
        body: {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: DEFAULT_TEMPERATURE,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
          },
        },
      });

      const raw = extractText(envelope);
      return { json: parseModelJson(NAME, raw), raw, ms };
    },
  };
}

interface GeminiEnvelope {
  candidates?: {
    content?: { parts?: { text?: unknown }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
}

/**
 * candidates[0].content.parts[].text, joined.
 *
 * Google returns 200 with zero candidates when its own safety filters block
 * the exchange, and this system's traffic is exactly the material those
 * filters fire on: people describing violence done to them, and people in
 * crisis. That is a routine outcome here, not an edge case.
 *
 * A block is treated as the model being unusable for this turn, so the caller
 * degrades to S1/S3/S4 (SAFETY_SPEC.md section 8 test S5). Nothing safety
 * critical is lost by that: the interlock already ran on this input before the
 * request was made and has already decided whether a human is being contacted
 * (SAFETY_SPEC.md section 2). All that is missing is the S2 signal.
 */
function extractText(envelope: unknown): string {
  const body = envelope as GeminiEnvelope;
  const candidate = body?.candidates?.[0];

  const text = (candidate?.content?.parts ?? [])
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();

  if (text === "") {
    const reason =
      body?.promptFeedback?.blockReason ?? candidate?.finishReason ?? "no candidates";
    throw new LLMInvalidOutputError(
      `${NAME}: response contained no text (${reason})`,
      { provider: NAME, raw: JSON.stringify(envelope ?? null).slice(0, 500) },
    );
  }

  return text;
}
