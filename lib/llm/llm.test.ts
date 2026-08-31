/**
 * lib/llm/llm.test.ts — the adapter's own tests.
 *
 * Owner: TM1. Covers the parts of docs/CHECKS_TM1.md gate D that can be
 * checked without a network or a key:
 *
 *   T1-D1  providers are interchangeable  ── partly: asserts all four produce
 *                                            the identical LlmCall shape from
 *                                            their own wire format. The full
 *                                            check is three eval runs.
 *   T1-D3  degradation on failure         ── asserts every failure path throws
 *                                            LLMUnavailableError, which is what
 *                                            the route catches to score on
 *                                            S1/S3/S4 (SAFETY_SPEC.md S5)
 *   T1-D4  output is schema-validated     ── covered below
 *
 * No test here contacts a provider: `fetch` is replaced for the duration of
 * each case. A test suite that needs a key is a test suite nobody runs.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  LLMInvalidOutputError,
  LLMUnavailableError,
  PROMPT_VERSION,
  PROVIDER_NAMES,
  SYSTEM_PROMPT,
  UnknownProviderError,
  complete,
  getProvider,
  modelVersion,
} from "@/lib/llm";
import { MAX_RETRIES } from "@/lib/llm/http";

/* ── harness ─────────────────────────────────────────────────────────────── */

/** The section-7 object, as a well-behaved model would return it. */
const GOOD_OUTPUT = {
  reply: "Thank you for telling me. How have you been sleeping this week?",
  s2_score: 62,
  markers: ["exhaustion"],
  evidence: ["cannot sleep"],
  language: "en",
  next_question_id: "q1",
};

/** `attempt` is 1-based, so a handler can answer 429 once and then succeed. */
type FetchHandler = (
  url: string,
  init: RequestInit,
  attempt: number,
) => Response;

/** Replace global fetch for one case, count the attempts, always restore. */
async function withFetch<T>(
  handler: FetchHandler,
  run: (calls: { count: number }) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  const calls = { count: 0 };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.count += 1;
    return handler(String(input), init ?? {}, calls.count);
  }) as typeof fetch;

  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

/** The four wire formats, each wrapping the model's text where that provider puts it. */
const ENVELOPES: Record<string, (text: string) => unknown> = {
  groq: (text) => ({ choices: [{ message: { content: text } }] }),
  openrouter: (text) => ({ choices: [{ message: { content: text } }] }),
  gemini: (text) => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  ollama: (text) => ({ message: { content: text } }),
};

/** Env is process-wide; every case that touches it puts it back. */
async function withEnv(
  vars: Record<string, string | undefined>,
  run: () => Promise<void> | void,
): Promise<void> {
  const saved = new Map(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await run();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** Capture console.warn for one case, and always restore it. */
async function withWarn<T>(
  run: () => Promise<T>,
): Promise<{ result: T | undefined; warnings: string[] }> {
  const original = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };

  try {
    return { result: await run(), warnings };
  } catch {
    // The invalid-output cases reject by design; the warnings are the subject.
    return { result: undefined, warnings };
  } finally {
    console.warn = original;
  }
}

/**
 * Silence console.warn for a case that provokes an invalid output for some
 * other reason. Without this, the tests below print a dozen real
 * llm_invalid_output records into the middle of the test log.
 */
async function muteWarn<T>(run: () => Promise<T>): Promise<T> {
  const original = console.warn;
  console.warn = () => {};
  try {
    return await run();
  } finally {
    console.warn = original;
  }
}

/* ── getProvider ─────────────────────────────────────────────────────────── */

test("every accepted LLM_PROVIDER value resolves to a provider of that name", () => {
  assert.deepEqual([...PROVIDER_NAMES].sort(), [
    "gemini",
    "groq",
    "ollama",
    "openrouter",
  ]);

  for (const name of PROVIDER_NAMES) {
    assert.equal(getProvider(name).name, name);
  }
});

test("LLM_PROVIDER is what selects the provider, and case and whitespace do not matter", async () => {
  await withEnv({ LLM_PROVIDER: "gemini", LLM_MODEL: undefined }, () => {
    assert.equal(getProvider().name, "gemini");
  });
  assert.equal(getProvider("  GROQ  ").name, "groq");
});

test("an unset LLM_PROVIDER throws a clear error naming the valid values", async () => {
  await withEnv({ LLM_PROVIDER: undefined }, () => {
    assert.throws(
      () => getProvider(),
      (e: unknown) => {
        assert.ok(e instanceof UnknownProviderError);
        for (const name of PROVIDER_NAMES) assert.match(e.message, new RegExp(name));
        return true;
      },
    );
  });
});

test("an unknown LLM_PROVIDER is a config error, NOT an availability error", () => {
  assert.throws(
    () => getProvider("gpt5"),
    (e: unknown) => {
      assert.ok(e instanceof UnknownProviderError);
      /*
       * The distinction matters more than it looks. If a typo degraded like an
       * outage, every assessment would silently lose S2 and the system would
       * look healthy while doing so.
       */
      assert.ok(!(e instanceof LLMUnavailableError));
      return true;
    },
  );
});

/* ── model_version ───────────────────────────────────────────────────────── */

test("modelVersion is exactly <provider>:<modelId>+prompt-<PROMPT_VERSION>", async () => {
  await withEnv({ LLM_MODEL: "openai/gpt-oss-120b" }, () => {
    // The literal string, not a template, so a change to either half of the
    // format has to be made here deliberately.
    assert.equal(
      modelVersion(getProvider("groq")),
      "groq:openai/gpt-oss-120b+prompt-1.0.0",
    );
  });

  const groq = getProvider("groq");
  assert.equal(
    modelVersion(groq),
    `groq:${groq.modelId}+prompt-${PROMPT_VERSION}`,
  );

  // Both facts have to survive a round trip through the one column, which is
  // what "splittable on +" has to mean for a query over assessments.
  const [model, prompt] = modelVersion(groq).split("+");
  assert.equal(model, `groq:${groq.modelId}`);
  assert.equal(prompt, `prompt-${PROMPT_VERSION}`);
});

test("a provider swap and a prompt bump are both visible in model_version", async () => {
  await withEnv({ LLM_MODEL: "fixed-model" }, () => {
    const versions = PROVIDER_NAMES.map((n) => modelVersion(getProvider(n)));
    assert.equal(new Set(versions).size, PROVIDER_NAMES.length);
    for (const v of versions) {
      assert.match(v, /^[a-z]+:.+\+prompt-\d+\.\d+\.\d+$/);
    }
  });
});

/* ── T1-D1: one shape out of four wire formats ───────────────────────────── */

test("all four providers return the identical LlmCall from their own envelope", async () => {
  for (const name of PROVIDER_NAMES) {
    await withEnv(
      { LLM_API_KEY: "test-key", LLM_MODEL: "fixed-model" },
      async () => {
        const call = await withFetch(
          () => json(ENVELOPES[name](JSON.stringify(GOOD_OUTPUT))),
          () => complete(SYSTEM_PROMPT, "i cannot sleep", getProvider(name)),
        );

        assert.deepEqual(call.output, GOOD_OUTPUT);
        assert.equal(
          call.modelVersion,
          `${name}:fixed-model+prompt-${PROMPT_VERSION}`,
        );
        assert.equal(typeof call.ms, "number");
        assert.equal(typeof call.raw, "string");
      },
    );
  }
});

test("the system prompt reaches the provider unmodified, in that provider's own field", async () => {
  await withEnv({ LLM_API_KEY: "test-key" }, async () => {
    let groqBody = "";
    await withFetch(
      (_url, init) => {
        groqBody = String(init.body);
        return json(ENVELOPES.groq(JSON.stringify(GOOD_OUTPUT)));
      },
      () => complete(SYSTEM_PROMPT, "hello", getProvider("groq")),
    );
    assert.equal(JSON.parse(groqBody).messages[0].content, SYSTEM_PROMPT);

    let geminiBody = "";
    await withFetch(
      (_url, init) => {
        geminiBody = String(init.body);
        return json(ENVELOPES.gemini(JSON.stringify(GOOD_OUTPUT)));
      },
      () => complete(SYSTEM_PROMPT, "hello", getProvider("gemini")),
    );
    assert.equal(
      JSON.parse(geminiBody).systemInstruction.parts[0].text,
      SYSTEM_PROMPT,
    );
  });
});

test("the Gemini key travels in a header, never in the URL", async () => {
  await withEnv({ LLM_API_KEY: "secret-key" }, async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    await withFetch(
      (url, init) => {
        seenUrl = url;
        seenHeaders = (init.headers ?? {}) as Record<string, string>;
        return json(ENVELOPES.gemini(JSON.stringify(GOOD_OUTPUT)));
      },
      () => complete(SYSTEM_PROMPT, "hello", getProvider("gemini")),
    );

    assert.ok(!seenUrl.includes("secret-key"));
    assert.equal(seenHeaders["x-goog-api-key"], "secret-key");
  });
});

/* ── T1-D4: prose must fail loudly ───────────────────────────────────────── */

test("prose instead of JSON throws, and throws something the caller degrades through", async () => {
  await withEnv({ LLM_API_KEY: "test-key" }, async () => {
    await assert.rejects(
      muteWarn(() =>
        withFetch(
          () => json(ENVELOPES.groq("I'm sorry, I can't help with that.")),
          () => complete(SYSTEM_PROMPT, "hello", getProvider("groq")),
        ),
      ),
      (e: unknown) => {
        assert.ok(e instanceof LLMInvalidOutputError);
        // Loud: the offending text is carried for the log.
        assert.match(e.raw, /I'm sorry/);
        // And still degradable, per SAFETY_SPEC section 8 test S5.
        assert.ok(e instanceof LLMUnavailableError);
        return true;
      },
    );
  });
});

test("invalid output is counted: one structured warn line, with provider, model and the prose", async () => {
  await withEnv(
    { LLM_API_KEY: "test-key", LLM_MODEL: "fixed-model" },
    async () => {
      const { warnings } = await withWarn(() =>
        withFetch(
          () => json(ENVELOPES.groq("I'm sorry, I can't help with that.")),
          () => complete(SYSTEM_PROMPT, "hello", getProvider("groq")),
        ),
      );

      assert.equal(warnings.length, 1);
      // One line: a model that writes paragraphs must not write paragraphs
      // into the log.
      assert.ok(!warnings[0].includes("\n"));

      const record = JSON.parse(warnings[0]);
      assert.equal(record.event, "llm_invalid_output");
      assert.equal(record.provider, "groq");
      assert.equal(record.modelId, "fixed-model");
      assert.match(record.raw, /I'm sorry/);
      assert.ok(record.raw.length <= 120);
    },
  );
});

test("a valid response warns about nothing", async () => {
  await withEnv({ LLM_API_KEY: "test-key" }, async () => {
    const { result, warnings } = await withWarn(() =>
      withFetch(
        () => json(ENVELOPES.groq(JSON.stringify(GOOD_OUTPUT))),
        () => complete(SYSTEM_PROMPT, "hello", getProvider("groq")),
      ),
    );

    assert.deepEqual(warnings, []);
    assert.equal(result?.output.s2_score, 62);
  });
});

test("an outage does NOT warn — only a broken instrument does", async () => {
  await withEnv({ LLM_API_KEY: "test-key" }, async () => {
    const { warnings } = await withWarn(() =>
      withFetch(
        () => json({ error: "bad gateway" }, 502),
        () => complete(SYSTEM_PROMPT, "hello", getProvider("groq")),
      ),
    );

    /*
     * The point of the warn line is to separate these two. A 502 is visible
     * elsewhere and self-resolves; a provider that has stopped emitting
     * section-7 JSON does not, and would otherwise look like normal traffic
     * with S2 null on every row.
     */
    assert.deepEqual(warnings, []);
  });
});

test("next_question_id is case-folded, but an id outside the list still fails", async () => {
  await withEnv({ LLM_API_KEY: "test-key" }, async () => {
    for (const [sent, expected] of [
      ["Q1", "q1"],
      ["q2", "q2"],
      ["  Q3 ", "q3"],
    ]) {
      const call = await withFetch(
        () =>
          json(
            ENVELOPES.groq(
              JSON.stringify({ ...GOOD_OUTPUT, next_question_id: sent }),
            ),
          ),
        () => complete(SYSTEM_PROMPT, "hello", getProvider("groq")),
      );
      assert.equal(call.output.next_question_id, expected);
    }

    // Folding the case is a repair. Inventing a question is not.
    for (const bad of ["q4", "sleep", "Q_SLEEP", ""]) {
      await assert.rejects(
        muteWarn(() =>
          withFetch(
            () =>
              json(
                ENVELOPES.groq(
                  JSON.stringify({ ...GOOD_OUTPUT, next_question_id: bad }),
                ),
              ),
            () => complete(SYSTEM_PROMPT, "hello", getProvider("groq")),
          ),
        ),
        (e: unknown) => e instanceof LLMInvalidOutputError,
        `next_question_id="${bad}" should have been rejected`,
      );
    }
  });
});

test("JSON that misses the section 7 contract is rejected, never repaired", async () => {
  const bad: [string, unknown][] = [
    ["missing s2_score", { ...GOOD_OUTPUT, s2_score: undefined }],
    ["s2_score as a string", { ...GOOD_OUTPUT, s2_score: "62" }],
    ["s2_score out of range", { ...GOOD_OUTPUT, s2_score: 140 }],
    ["a marker outside the enum", { ...GOOD_OUTPUT, markers: ["suicidal"] }],
    ["a language outside en|hi", { ...GOOD_OUTPUT, language: "ta" }],
    ["an empty reply", { ...GOOD_OUTPUT, reply: "" }],
  ];

  await withEnv({ LLM_API_KEY: "test-key" }, async () => {
    for (const [label, body] of bad) {
      await assert.rejects(
        muteWarn(() =>
          withFetch(
            () => json(ENVELOPES.groq(JSON.stringify(body))),
            () => complete(SYSTEM_PROMPT, "hello", getProvider("groq")),
          ),
        ),
        (e: unknown) => e instanceof LLMInvalidOutputError,
        label,
      );
    }
  });
});

test("a tier volunteered by the model is stripped, not read (S7)", async () => {
  await withEnv({ LLM_API_KEY: "test-key" }, async () => {
    const call = await withFetch(
      () =>
        json(
          ENVELOPES.groq(JSON.stringify({ ...GOOD_OUTPUT, tier: "GREEN" })),
        ),
      () => complete(SYSTEM_PROMPT, "hello", getProvider("groq")),
    );

    assert.deepEqual(call.output, GOOD_OUTPUT);
    assert.ok(!("tier" in call.output));
  });
});

test("a fenced code block is unwrapped; a sentence wrapped around JSON is not", async () => {
  await withEnv({ LLM_API_KEY: "test-key" }, async () => {
    const fenced = "```json\n" + JSON.stringify(GOOD_OUTPUT) + "\n```";
    const call = await withFetch(
      () => json(ENVELOPES.ollama(fenced)),
      () => complete(SYSTEM_PROMPT, "hello", getProvider("ollama")),
    );
    assert.deepEqual(call.output, GOOD_OUTPUT);

    await assert.rejects(
      muteWarn(() =>
        withFetch(
          () =>
            json(
              ENVELOPES.ollama(`Here you go: ${JSON.stringify(GOOD_OUTPUT)}`),
            ),
          () => complete(SYSTEM_PROMPT, "hello", getProvider("ollama")),
        ),
      ),
      (e: unknown) => e instanceof LLMInvalidOutputError,
    );
  });
});

/* ── retries and T1-D3 degradation ───────────────────────────────────────── */

test("a 429 is retried and the call still succeeds", async () => {
  await withEnv({ LLM_API_KEY: "test-key" }, async () => {
    const call = await withFetch(
      (_url, _init, attempt) =>
        attempt === 1
          ? // retry-after: 0 keeps the test fast and exercises the header path.
            json({ error: "rate limited" }, 429, { "retry-after": "0" })
          : json(ENVELOPES.groq(JSON.stringify(GOOD_OUTPUT))),
      async (calls) => {
        const result = await complete(
          SYSTEM_PROMPT,
          "hello",
          getProvider("groq"),
        );
        assert.equal(calls.count, 2);
        return result;
      },
    );

    assert.equal(call.output.s2_score, 62);
  });
});

test("a 5xx is retried exactly twice, then becomes LLMUnavailableError", async () => {
  await withEnv({ LLM_API_KEY: "test-key" }, async () => {
    await withFetch(
      () => json({ error: "bad gateway" }, 502),
      async (calls) => {
        await assert.rejects(
          complete(SYSTEM_PROMPT, "hello", getProvider("groq")),
          (e: unknown) => {
            assert.ok(e instanceof LLMUnavailableError);
            assert.equal(e.status, 502);
            assert.equal(e.provider, "groq");
            return true;
          },
        );
        assert.equal(calls.count, MAX_RETRIES + 1);
      },
    );
  });
});

test("a 401 is not retried — the next two attempts would fail identically", async () => {
  await withEnv({ LLM_API_KEY: "garbage" }, async () => {
    await withFetch(
      () => json({ error: "invalid api key" }, 401),
      async (calls) => {
        await assert.rejects(
          complete(SYSTEM_PROMPT, "hello", getProvider("groq")),
          (e: unknown) => e instanceof LLMUnavailableError,
        );
        assert.equal(calls.count, 1);
      },
    );
  });
});

test("a network failure degrades rather than escaping as a raw fetch error", async () => {
  await withEnv({ LLM_PROVIDER: "ollama" }, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed: ECONNREFUSED");
    }) as typeof fetch;

    try {
      await assert.rejects(
        complete(SYSTEM_PROMPT, "hello"),
        (e: unknown) => e instanceof LLMUnavailableError,
      );
    } finally {
      globalThis.fetch = original;
    }
  });
});

test("a missing LLM_API_KEY degrades; it does not crash the check-in", async () => {
  await withEnv({ LLM_API_KEY: undefined }, async () => {
    await assert.rejects(
      complete(SYSTEM_PROMPT, "hello", getProvider("groq")),
      (e: unknown) => {
        assert.ok(e instanceof LLMUnavailableError);
        assert.match(e.message, /LLM_API_KEY/);
        return true;
      },
    );
  });
});

/* ── the prompt ──────────────────────────────────────────────────────────── */

test("SYSTEM_PROMPT is still verbatim from SAFETY_SPEC section 7", () => {
  const spec = readFileSync(
    path.join(process.cwd(), "docs", "SAFETY_SPEC.md"),
    "utf8",
  );

  const section = spec.split(/^## 7\./m)[1]?.split(/^## 8\./m)[0] ?? "";
  const fenced = section.match(/```\n([\s\S]*?)\n```/);

  assert.ok(fenced, "SAFETY_SPEC section 7 no longer has a fenced prompt block");
  assert.equal(
    SYSTEM_PROMPT,
    fenced[1],
    "lib/llm/prompt.ts has drifted from SAFETY_SPEC section 7 — copy it again and bump PROMPT_VERSION",
  );
});
