/**
 * lib/safety/latency.test.ts — the interlock's 50 ms budget.
 *
 * Owner: TM1. Guards docs/SAFETY_SPEC.md section 1:
 *
 *   "The interlock has a latency budget of 50 ms. It runs before the LLM is
 *    contacted, so a person in crisis gets resources even if the model is
 *    down, rate-limited, or slow."
 *
 * WHY THIS IS ITS OWN FILE. `scripts/run-tests.mjs` filters by FILE PATH, not
 * by test name — `npm run test -- latency` matches paths containing "latency"
 * and nothing else. CHECKS_TM1.md T1-C11 runs exactly that command, so the
 * assertion has to live on a path that matches it. Adding a test *named*
 * "latency" inside interlock.test.ts would still leave T1-C11 reporting
 * "No test files matched".
 *
 * These assertions are wall-clock and therefore the one place in this suite
 * that can fail for reasons other than a code change — a loaded CI box, a
 * cold JIT. The budget is 50 ms against a measured mean of well under 1 ms, so
 * the margin absorbs that. A failure here means something genuinely changed:
 * a catastrophically backtracking pattern, or a model call that crept into
 * lib/safety/ (which T1-B3 also guards).
 */

import { strict as assert } from "node:assert";
import test from "node:test";

import { checkInput, checkOutput } from "./interlock";
import { LEXICON } from "./lexicon";

/** docs/SAFETY_SPEC.md section 1. */
const BUDGET_MS = 50;
const ITERATIONS = 100;

/**
 * Inputs that force the worst case: every one of them runs the FULL lexicon
 * without matching, because `checkInput` returns on first match. A crisis
 * utterance is the fast path; ordinary text is the slow one.
 */
const NON_MATCHING = [
  "I have been feeling a little tired since the last hearing but I am managing.",
  "मुझे नींद नहीं आ रही है और खाना भी ठीक से नहीं खा पा रही हूँ इन दिनों।",
  "kal court ki tareekh hai, thoda ghabrahat ho rahi hai lekin theek hoon main.",
  "The relief instalment has not come through yet and the landlord keeps asking.",
];

function measureMeanMs(run: () => void): number {
  // One untimed pass so the first iteration's JIT warm-up is not charged to
  // the budget. The budget is about steady-state request latency.
  run();

  const started = performance.now();
  for (let i = 0; i < ITERATIONS; i++) run();
  return (performance.now() - started) / ITERATIONS;
}

test("the lexicon really is the full 60 patterns being walked", () => {
  // If this ever shrinks, the timing below stops proving anything.
  assert.ok(
    LEXICON.length >= 60,
    `expected the full lexicon, got ${LEXICON.length} patterns`,
  );
  for (const text of NON_MATCHING) {
    assert.equal(
      checkInput(text).hit,
      false,
      `"${text}" matched, so it exits early and does not measure the full walk`,
    );
  }
});

test("checkInput over the full lexicon stays inside the 50 ms budget", () => {
  const mean = measureMeanMs(() => {
    for (const text of NON_MATCHING) checkInput(text);
  });

  assert.ok(
    mean < BUDGET_MS,
    `checkInput averaged ${mean.toFixed(3)} ms over ${ITERATIONS} iterations, budget is ${BUDGET_MS} ms (SAFETY_SPEC section 1)`,
  );
});

test("a crisis utterance is detected well inside the budget", () => {
  // The path that actually matters: this is what a person in crisis waits on
  // before resources render, and it must not depend on the model being up.
  const crisis = "I want to kill myself";
  assert.equal(checkInput(crisis).hit, true);

  const mean = measureMeanMs(() => {
    checkInput(crisis);
  });
  assert.ok(
    mean < BUDGET_MS,
    `checkInput averaged ${mean.toFixed(3)} ms on a crisis utterance, budget is ${BUDGET_MS} ms`,
  );
});

test("checkOutput stays inside the same budget", () => {
  // Pass 2 sits between the model's reply and a person in distress, so it is
  // on the critical path too (SAFETY_SPEC section 2).
  const reply =
    "Thank you for telling me that. How much has this been affecting your sleep?";
  const mean = measureMeanMs(() => {
    checkOutput(reply);
  });

  assert.ok(
    mean < BUDGET_MS,
    `checkOutput averaged ${mean.toFixed(3)} ms over ${ITERATIONS} iterations, budget is ${BUDGET_MS} ms`,
  );
});
