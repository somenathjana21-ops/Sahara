/**
 * scripts/smoke-llm.ts — one real call to whichever provider is configured.
 *
 * Owner: TM1. Not a test: it needs a key and a network, so it is not in
 * `npm run test`. It answers the question the unit tests cannot — does the
 * live model, today, on the current free tier, actually return the JSON that
 * docs/SAFETY_SPEC.md section 7 asks for, and does the reply survive Pass 2.
 *
 *   npx tsx --env-file=.env.local scripts/smoke-llm.ts
 *   npx tsx --env-file=.env.local scripts/smoke-llm.ts "kaam par wapas gaya"
 *
 * `--env-file` is Node's own flag, which is why there is no dotenv import
 * here: dotenv is not on the CHECKS_TM1.md T1-A7 dependency list, and a
 * dependency that exists to do what the runtime already does is exactly the
 * kind CLAUDE.md tells us not to add.
 *
 * ## What it prints, and why Pass 2 is the interesting line
 *
 * The model's reply goes through checkOutput() before the verdict is printed.
 * A real reply that Pass 2 rejects is not a bug in either layer — it is the
 * interlock doing its job — but it is something to see now rather than on
 * Day 4, because a high rejection rate means the prompt and the banned-pattern
 * table are fighting, and the person on the other end gets a fixed fallback
 * string instead of an acknowledgement every time it happens.
 */

import {
  LLMUnavailableError,
  SYSTEM_PROMPT,
  complete,
  getProvider,
  modelVersion,
} from "@/lib/llm";
import { checkInput, checkOutput } from "@/lib/safety/interlock";

/**
 * A non-crisis check-in message. Deliberately mild: this script is for
 * exercising the model path, and Pass 1 stops a crisis utterance before the
 * model is ever called, which is the whole design (SAFETY_SPEC.md section 2).
 * No PII (CLAUDE.md rule 6).
 */
const DEFAULT_MESSAGE =
  "I have been feeling stressed and having trouble sleeping lately.";

/**
 * The "provided question list" the system prompt refers to. Supplied as turn
 * data, not prompt text — see the note in lib/llm/prompt.ts. Ids and wording
 * from SCORING_AND_POLICY.md section 3.
 */
const QUESTION_LIST = [
  "q1: How have you been feeling since we last spoke?",
  "q2: How much has this been affecting your sleep and eating?",
  "q3: Do you feel safe right now?",
].join("\n");

function buildUserMessage(message: string): string {
  return [
    "Question list:",
    QUESTION_LIST,
    "",
    "Person said:",
    message,
  ].join("\n");
}

async function main(): Promise<void> {
  const message = process.argv[2] ?? DEFAULT_MESSAGE;
  const provider = getProvider();

  console.log("provider      :", provider.name);
  console.log("model         :", provider.modelId);
  console.log("model_version :", modelVersion(provider));
  console.log("message       :", message);

  /*
   * Pass 1, exactly where the route runs it. If this fires the model is not
   * called at all, so a smoke test that skipped it would be testing a path the
   * real pipeline does not have.
   */
  const pass1 = checkInput(message);
  if (pass1.hit) {
    console.log(
      `\nPASS 1: CRITICAL (${pass1.category}, matched "${pass1.matched}")`,
    );
    console.log(
      "The model is not called on this input. Crisis resources render from",
      "lib/safety/replies.ts. Pass a non-crisis message to exercise the model.",
    );
    return;
  }
  console.log("\nPASS 1: no lexicon hit — calling the model");

  const call = await complete(SYSTEM_PROMPT, buildUserMessage(message));

  console.log(`\n--- model output (${call.ms} ms) ---`);
  console.log(JSON.stringify(call.output, null, 2));

  /*
   * Pass 2. In the route, `rejected` means the reply is discarded and
   * replies.fallback_reply is sent instead (SAFETY_SPEC.md section 6).
   */
  const pass2 = checkOutput(call.output.reply);

  console.log("\n--- PASS 2 ---");
  if (pass2.rejected) {
    console.log(`REJECTED (${pass2.reason})`);
    console.log(`reply was: ${JSON.stringify(call.output.reply)}`);
    console.log(
      "A person would see replies.fallback_reply, not this text. That is the",
      "interlock working. If it happens often, the prompt and the section 6",
      "table are fighting — fix the prompt, never the table.",
    );
  } else {
    console.log("accepted — this reply would reach the person as written");
  }

  console.log(
    `\nreply length: ${call.output.reply.length}/320 chars,`,
    `question marks: ${(call.output.reply.match(/[?？]/g) ?? []).length}/1`,
  );
}

main().catch((error: unknown) => {
  if (error instanceof LLMUnavailableError) {
    /*
     * The same condition the route degrades through: it would still log the
     * check-in, still score S1/S3/S4, and still run both interlock passes
     * (SAFETY_SPEC.md section 8 test S5). Here it is just a failed smoke test.
     */
    console.error(`\nLLM unavailable (${error.name}): ${error.message}`);
    console.error(
      "In the pipeline this degrades to S2 = null, not an error page.",
    );
    process.exit(1);
  }

  console.error("\nSmoke test failed:");
  console.error(error);
  process.exit(1);
});
