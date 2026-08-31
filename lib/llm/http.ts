/**
 * lib/llm/http.ts — the transport every provider shares.
 *
 * Owner: TM1. Implements the retry and failure requirements of
 * docs/TM1_GUIDE.md section 4 (Prompt 5): "Retry twice with exponential
 * backoff on 429 and 5xx. On total failure, throw LLMUnavailableError."
 *
 * Prompt 5 names five files and this is a sixth. It exists because the retry
 * loop, the timeout, the 429/5xx classification and the fenced-JSON unwrap are
 * identical for all four providers, and four copies of a retry loop is four
 * places for the backoff to be wrong in a different way. The providers differ
 * only in URL, headers, request body and where the model's text sits in the
 * response — which is exactly what each provider file still contains.
 *
 * Nothing here is safety logic. It never inspects the user's text.
 */

import { LLMInvalidOutputError, LLMUnavailableError } from "./types";

/**
 * "Retry twice" — three attempts in total. Free tiers are the normal case for
 * this project (TM1_GUIDE.md section 2: Groq 30 req/min, OpenRouter 20/min),
 * so a 429 during an eval run is expected traffic, not an incident.
 */
export const MAX_RETRIES = 2;

/** First backoff step. Doubles per retry: ~400 ms, then ~800 ms, plus jitter. */
export const BASE_BACKOFF_MS = 400;

/**
 * A 429 can carry Retry-After asking for minutes. Waiting that long inside a
 * check-in request is not an option — the person is sitting in front of the
 * screen — so an oversized Retry-After is capped and, if the cap is not
 * enough, the call fails and the pipeline degrades to S1/S3/S4.
 */
export const MAX_RETRY_AFTER_MS = 5_000;

/** Hosted providers. A check-in that waits longer than this has already failed the user. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Sampling settings, shared so the four providers are compared on equal terms
 * (CHECKS_TM1.md T1-D1) rather than on whoever happened to pick a different
 * temperature. Low, not zero: the prompt wants one short acknowledgement, and
 * greedy decoding on some models degenerates into repeating the user verbatim.
 */
export const DEFAULT_TEMPERATURE = 0.2;

/** Two sentences plus the section-7 JSON. 512 is generous; a model needing more is off-task. */
export const MAX_OUTPUT_TOKENS = 512;

/** How much model text to keep on an LLMInvalidOutputError, so a log line stays a log line. */
const RAW_LOG_CHARS = 500;

export interface PostJsonOptions {
  /** Provider slug, for the error message and for LLMUnavailableError.provider. */
  provider: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs?: number;
}

/** The provider's decoded response envelope, plus how long getting it took. */
export interface PostJsonResult {
  envelope: unknown;
  ms: number;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 429 and 5xx are transient by definition — rate limit, overloaded pool, bad
 * gateway. Everything else in the 4xx range (401 bad key, 400 malformed body,
 * 404 wrong model id) will fail identically on the next two attempts, so
 * retrying it only makes the user wait longer for the same failure.
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Retry-After, as either delta-seconds or an HTTP date. Absent or unparseable => use the backoff. */
function retryAfterMs(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (!header) return null;

  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());

  return null;
}

/**
 * Exponential backoff with full jitter. The jitter matters during an eval run:
 * 80 items retrying on the same deterministic 400/800 ms schedule would walk
 * into the next rate-limit window together.
 */
function backoffMs(attempt: number): number {
  const ceiling = BASE_BACKOFF_MS * 2 ** attempt;
  return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
}

/**
 * POST JSON, retry the retryable, and return the decoded envelope.
 *
 * Every failure path out of this function is an LLMUnavailableError, which the
 * caller degrades through (SAFETY_SPEC.md section 8 test S5). It never throws
 * a bare fetch error at a route handler.
 */
export async function postJson({
  provider,
  url,
  headers,
  body,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: PostJsonOptions): Promise<PostJsonResult> {
  const startedAt = Date.now();
  let lastError: LLMUnavailableError | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res: Response;

    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      /*
       * DNS failure, connection refused (the usual Ollama case), or the
       * timeout above. All transient in principle, so they take the retry
       * path rather than failing the call outright.
       */
      lastError = new LLMUnavailableError(
        `${provider}: request failed (${(cause as Error)?.message ?? "network error"})`,
        { provider, cause },
      );
      if (attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt));
        continue;
      }
      break;
    }

    if (res.ok) {
      const text = await res.text();
      try {
        return { envelope: JSON.parse(text), ms: Date.now() - startedAt };
      } catch (cause) {
        /*
         * A 200 whose body is not JSON is not the model failing the section-7
         * contract — it is the transport failing — so this is a plain
         * LLMUnavailableError and not LLMInvalidOutputError.
         */
        throw new LLMUnavailableError(
          `${provider}: response body was not JSON`,
          { provider, status: res.status, cause },
        );
      }
    }

    const detail = (await res.text().catch(() => "")).slice(0, 200);
    lastError = new LLMUnavailableError(
      `${provider}: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`,
      { provider, status: res.status },
    );

    if (!isRetryableStatus(res.status) || attempt === MAX_RETRIES) break;

    const requested = retryAfterMs(res);
    const wait =
      requested === null
        ? backoffMs(attempt)
        : Math.min(requested, MAX_RETRY_AFTER_MS);
    await sleep(wait);
  }

  throw (
    lastError ??
    new LLMUnavailableError(`${provider}: request failed`, { provider })
  );
}

/**
 * Turn the model's own text into JSON, or fail loudly.
 *
 * The one liberty taken is unwrapping a fenced code block, because a model in
 * JSON mode wrapping its object in ```json is a formatting habit rather than a
 * refusal to answer, and local models do it constantly. Nothing else is
 * repaired: there is no hunting for the first `{` in a paragraph, so "I'm
 * sorry, I can't help with that" fails, which is the required behaviour
 * (TM1_GUIDE.md section 4: a model that returns prose instead of JSON must
 * fail loudly, not silently).
 */
export function parseModelJson(provider: string, raw: string): unknown {
  const text = stripCodeFence(raw.trim());

  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new LLMInvalidOutputError(
      `${provider}: model returned text that is not JSON`,
      { provider, raw: raw.slice(0, RAW_LOG_CHARS), cause },
    );
  }
}

/** ```json\n{...}\n``` => {...}. Only an exact wrap; anything else is left alone to fail. */
function stripCodeFence(text: string): string {
  if (!text.startsWith("```") || !text.endsWith("```")) return text;
  return text
    .replace(/^```[a-zA-Z]*\s*\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
}

/**
 * Read a server-only secret at call time, never at module load.
 *
 * At module load this file may be evaluated during `next build`, where the
 * variable is legitimately absent. A missing key is also reported as
 * LLMUnavailableError rather than a crash: the deployment is broken either
 * way, but the person mid check-in still gets a logged row, a score on
 * S1/S3/S4 and a working interlock (CHECKS_TM1.md T1-D3).
 */
export function requireEnv(provider: string, name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new LLMUnavailableError(`${provider}: ${name} is not set`, {
      provider,
    });
  }
  return value;
}
