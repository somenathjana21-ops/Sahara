/**
 * lib/llm/ollama.ts — a model running on this laptop.
 *
 * Owner: TM1. Implements docs/TM1_GUIDE.md section 4 (Prompt 5).
 *
 * Host is http://localhost:11434 exactly as specified, with no env override:
 * one hardcoded local URL is the boring solution, and an OLLAMA_HOST that is
 * settable but undocumented in .env.example is a worse one.
 *
 * This exists for the failure TM1_GUIDE.md section 2 names — the venue Wi-Fi
 * dying five minutes before the demo. It needs no key, has no quota, and is
 * the only provider here that keeps working offline.
 *
 * Speed: a 7B model on a laptop CPU can take tens of seconds, so the timeout
 * below is much larger than the hosted default. That is fine for a fallback
 * and is not what anyone should demo on.
 */

import {
  DEFAULT_TEMPERATURE,
  MAX_OUTPUT_TOKENS,
  parseModelJson,
  postJson,
} from "./http";
import { LLMInvalidOutputError, type LLMProvider, type LlmRawResult } from "./types";

const NAME = "ollama";
const ENDPOINT = "http://localhost:11434/api/chat";

/** Local models are slow enough that the 15 s hosted budget would time out a working call. */
const OLLAMA_TIMEOUT_MS = 60_000;

/**
 * Overridden by LLM_MODEL. Ends up in assessments.model_version on every row.
 *
 * UNVERIFIED against the provider's live model list. Production tier, not
 * preview. Re-verify before Day 5. (For this provider the "live model list"
 * is whatever `ollama list` prints on the laptop being demoed from, which is
 * why it has to be re-checked on the machine, not from the docs.)
 */
export const DEFAULT_OLLAMA_MODEL = "llama3.1:8b";

export function createOllamaProvider(): LLMProvider {
  const modelId = process.env.LLM_MODEL || DEFAULT_OLLAMA_MODEL;

  return {
    name: NAME,
    modelId,

    // No requireEnv here: a local daemon has no key. The failure mode is
    // connection refused, which postJson already turns into
    // LLMUnavailableError and the caller degrades through.
    async complete(system: string, user: string): Promise<LlmRawResult> {
      const { envelope, ms } = await postJson({
        provider: NAME,
        url: ENDPOINT,
        headers: {},
        body: {
          model: modelId,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          // Ollama's JSON mode. Small local models honour it less reliably
          // than the hosted ones, which is the case the fenced-block unwrap in
          // ./http.ts and the schema check in ./index.ts are there for.
          format: "json",
          stream: false,
          options: {
            temperature: DEFAULT_TEMPERATURE,
            num_predict: MAX_OUTPUT_TOKENS,
          },
        },
        timeoutMs: OLLAMA_TIMEOUT_MS,
      });

      const raw = extractText(envelope);
      return { json: parseModelJson(NAME, raw), raw, ms };
    },
  };
}

/** message.content, defensively. `stream: false` above is what makes this one object. */
function extractText(envelope: unknown): string {
  const content = (envelope as { message?: { content?: unknown } })?.message
    ?.content;

  if (typeof content !== "string" || content.trim() === "") {
    throw new LLMInvalidOutputError(`${NAME}: response contained no message content`, {
      provider: NAME,
      raw: JSON.stringify(envelope ?? null).slice(0, 500),
    });
  }

  return content;
}
