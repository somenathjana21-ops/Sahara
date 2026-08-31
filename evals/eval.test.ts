/**
 * evals/eval.test.ts — the eval sets are data, and data needs a test too.
 *
 * Owner: TM1. Runs under `npm run test`.
 *
 * Everything here is a check that docs/CHECKS_TM1.md gate E performs by hand
 * with grep and wc. Doing it in-process instead means a bad line fails on the
 * developer's laptop in two seconds rather than on the CI runner, and that the
 * PII scan understands what a persona id is instead of matching a substring.
 *
 * The important one is `every critical item is actually detected`: that is
 * SAFETY_SPEC.md section 8 test S1, asserted without the CLI, without a
 * network call and without a provider key. A lexicon regression fails
 * `npm run test` before anyone gets as far as `npm run eval`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { checkInput } from "@/lib/safety/interlock";
import { q3IsCriticalTrigger } from "@/lib/scoring/components";
import { updateEWMA } from "@/lib/scoring/baseline";
import {
  MIN_SET_SIZE,
  SET_NAMES,
  type EvalItem,
  type SetName,
  foldBaseline,
  materialise,
  parseJsonl,
} from "./item";

function load(name: SetName): EvalItem[] {
  return parseJsonl(readFileSync(`evals/${name}.jsonl`, "utf8"), `evals/${name}.jsonl`);
}

const SETS = Object.fromEntries(SET_NAMES.map((n) => [n, load(n)])) as Record<
  SetName,
  EvalItem[]
>;
const ALL = SET_NAMES.flatMap((n) => SETS[n]);

/* ── shape and size ──────────────────────────────────────────────────────── */

test("every line parses against the item schema", () => {
  // parseJsonl throws on a bad line, so reaching here is the assertion. The
  // counts guard against a file that silently truncated.
  for (const name of SET_NAMES) assert.ok(SETS[name].length > 0, `${name} is empty`);
});

test("set sizes meet CHECKS_TM1.md T1-E5", () => {
  for (const name of SET_NAMES) {
    assert.ok(
      SETS[name].length >= MIN_SET_SIZE[name],
      `${name} has ${SETS[name].length} items, needs at least ${MIN_SET_SIZE[name]}`,
    );
  }
});

/* ── CLAUDE.md rule 6: no PII ────────────────────────────────────────────── */

test("persona ids are pseudonyms and are unique across all three sets", () => {
  const seen = new Map<string, string>();

  for (const name of SET_NAMES) {
    for (const item of SETS[name]) {
      assert.match(item.id, /^[A-Z]-[0-9]{4}$/, `${item.id} is not a pseudonym`);
      const previous = seen.get(item.id);
      assert.equal(previous, undefined, `${item.id} appears in both ${previous} and ${name}`);
      seen.set(item.id, name);
    }
  }
});

/**
 * The PII pattern is READ FROM THE CI WORKFLOW rather than copied here, for
 * two reasons.
 *
 * The first is drift: CHECKS_TM1.md T1-E4 and the workflow's own scan step are
 * the gate that actually blocks a merge, and a second copy in a test file is a
 * second thing to forget when a token is added to the list.
 *
 * The second is that the copy would fail the gate. The workflow greps all of
 * `evals/` case-insensitively, so a file in this directory that spells the
 * name tokens out is itself a hit — the scan cannot tell a test fixture from a
 * leak, and it should not try. Reading the pattern keeps the literals out of
 * the scanned tree entirely.
 */
function ciPiiPattern(): RegExp {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const match = /^\s*PATTERN='([^']+)'/m.exec(workflow);
  assert.ok(match, "could not find the PII PATTERN in .github/workflows/ci.yml");
  return new RegExp(match[1], "i");
}

test("no PII-shaped strings anywhere in the sets", () => {
  const pii = ciPiiPattern();

  for (const name of SET_NAMES) {
    const source = readFileSync(`evals/${name}.jsonl`, "utf8");
    const match = pii.exec(source);
    assert.equal(
      match,
      null,
      `evals/${name}.jsonl matches the CI PII scan: ${match?.[0]}. Personas are pseudonyms like A-4471 (CLAUDE.md rule 6).`,
    );
  }
});

/* ── SAFETY_SPEC.md section 8, tests S1 and S2 ───────────────────────────── */

test("the safety set holds 40 critical items across all three written forms", () => {
  const criticals = SETS.safety.filter((i) => i.expectedTier === "CRITICAL");
  assert.equal(criticals.length, 40);

  const byLang = (lang: string) => criticals.filter((i) => i.lang === lang).length;
  // TM1_GUIDE.md section 6, Prompt 7: "about 13 English, 13 Devanagari, 14
  // romanised Hindi". Romanised is not folded into Devanagari — it is its own
  // matching problem to a regular expression and its own recall row.
  assert.equal(byLang("en"), 13);
  assert.equal(byLang("hi"), 13);
  assert.equal(byLang("hi-rom"), 14);

  assert.equal(SETS.safety.length - criticals.length, 20, "20 near-misses");
});

test("S1: every critical item in every set is detected deterministically", () => {
  /*
   * The acceptance test, without the CLI. A critical item must be caught by
   * the lexicon or by q3 = 4 — never by the composite, and never by a model
   * (CLAUDE.md rules 1 and 4).
   */
  const missed: string[] = [];

  for (const item of ALL) {
    if (item.expectedTier !== "CRITICAL") continue;

    const lexicon = item.transcript !== null && checkInput(item.transcript).hit;
    const q3 = q3IsCriticalTrigger(item.structured);
    if (!lexicon && !q3) missed.push(`${item.id} [${item.lang}]: ${item.transcript ?? "(no transcript)"}`);
  }

  assert.deepEqual(
    missed,
    [],
    `not detected by lib/safety/lexicon.ts or q3 — fix the lexicon, never the set:\n${missed.join("\n")}`,
  );
});

test("no critical item relies on a model being reachable", () => {
  // A lexicon hit skips the model entirely, and q3 is read from the keypad.
  // Either way a critical item must survive the provider being down
  // (SAFETY_SPEC.md section 8, test S5).
  for (const item of ALL) {
    if (item.expectedTier !== "CRITICAL") continue;
    const deterministic =
      (item.transcript !== null && checkInput(item.transcript).hit) ||
      q3IsCriticalTrigger(item.structured);
    assert.ok(deterministic, `${item.id} would need a model to reach CRITICAL`);
  }
});

/* ── CHECKS_TM1.md T1-E6 ─────────────────────────────────────────────────── */

/**
 * Lowercase, drop everything that is not a letter or digit, collapse runs.
 * `\p{L}\p{N}` rather than an explicit Devanagari range, so the same function
 * tokenises all three written forms without a per-script branch.
 */
function normaliseTranscript(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Levenshtein distance. Two rows, not a full matrix — the strings are sentences. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }

  return prev[b.length];
}

/** 1 − (edit distance / longer length). Catches one-word swaps in a shared frame. */
function levenshteinRatio(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - levenshtein(a, b) / longest;
}

/** Dice coefficient over word sets. Catches the same words in a different order. */
function wordOverlap(a: string, b: string): number {
  const setA = new Set(a.split(" ").filter(Boolean));
  const setB = new Set(b.split(" ").filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 1;

  let shared = 0;
  for (const w of setA) if (setB.has(w)) shared++;
  return (2 * shared) / (setA.size + setB.size);
}

/**
 * BOTH metrics are computed and the HIGHER is taken, because they fail on
 * opposite inputs and a near-duplicate only has to beat one of them.
 *
 * The pair that made this concrete: "ab kaam regular mil raha hai" against
 * "kaam mil raha hai ab thoda thoda" — the same sentence with the words
 * rearranged. Character-sequence similarity scores it 0.28 and waves it
 * through; word overlap scores it 0.83. Reverse the failure and a long shared
 * frame with one word swapped scores high on characters and lower on words.
 * Taking the maximum means neither blind spot is load-bearing.
 */
function similarity(a: string, b: string): number {
  const x = normaliseTranscript(a);
  const y = normaliseTranscript(b);
  return Math.max(levenshteinRatio(x, y), wordOverlap(x, y));
}

/**
 * Calibrated, not guessed. Measured against the four pairs that were actually
 * removed from this repository and against every surviving pair:
 *
 *   removed   H-3025/D-2050  0.875     surviving worst  0.636
 *   removed   H-3039/D-2072  0.833
 *   removed   H-3013/D-2051  0.800
 *
 * 0.75 sits in the gap with room on both sides. Raising it past 0.80 lets the
 * real duplicates back in; dropping it near 0.64 starts flagging short
 * romanised-Hindi sentences that share nothing but function words
 * ("koi", "nahi", "hai"), which is the floor for that script and not overlap.
 */
export const MAX_CROSS_SET_SIMILARITY = 0.75;

test("dev and holdout share no transcript, exactly or nearly", () => {
  const dev = SETS.dev.filter((i) => i.transcript !== null);
  const holdout = SETS.holdout.filter((i) => i.transcript !== null);

  const offenders: string[] = [];

  for (const h of holdout) {
    for (const d of dev) {
      const score = similarity(h.transcript as string, d.transcript as string);
      if (score < MAX_CROSS_SET_SIMILARITY) continue;
      offenders.push(
        `  ${score.toFixed(3)}  ${h.id} vs ${d.id}\n` +
          `    holdout: ${h.transcript}\n` +
          `    dev    : ${d.transcript}`,
      );
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "the holdout must be scenarios the policy was never tuned on. Rewrite the " +
      `holdout side with a different atrocity category and different wording:\n${offenders.join("\n")}`,
  );
});

test("the similarity metric actually catches a known near-duplicate", () => {
  /*
   * A threshold nobody has tested against a true positive is a threshold that
   * silently drifts to "always passes". These two sentences were really in
   * dev.jsonl and holdout.jsonl together, and the exact-equality test this
   * replaced reported them as clean.
   */
  const wasMissed = similarity(
    "ab kaam regular mil raha hai.",
    "kaam mil raha hai ab thoda thoda.",
  );
  assert.ok(
    wasMissed >= MAX_CROSS_SET_SIMILARITY,
    `word-reordered duplicate scored ${wasMissed.toFixed(3)}, under the ${MAX_CROSS_SET_SIMILARITY} threshold`,
  );

  const frameSwap = similarity(
    "gaon me ab bhi koi baat nahi karta.",
    "office me ab koi baat nahi karta.",
  );
  assert.ok(
    frameSwap >= MAX_CROSS_SET_SIMILARITY,
    `one-word frame swap scored ${frameSwap.toFixed(3)}, under the threshold`,
  );

  /*
   * And it must NOT fire on two unrelated sentences that merely share the
   * function words every short romanised-Hindi sentence contains. If this
   * assertion ever fails the threshold has been dropped too far and the test
   * has started rejecting legitimate items.
   */
  const functionWordsOnly = similarity(
    "koi humse baat nahi karta, sab khatam ho gaya hai.",
    "koi badlav nahi hai, wahi sab chal raha hai.",
  );
  assert.ok(
    functionWordsOnly < MAX_CROSS_SET_SIMILARITY,
    `unrelated sentences scored ${functionWordsOnly.toFixed(3)}, at or over the threshold`,
  );
});

/* ── coverage the sets are supposed to provide ───────────────────────────── */

test("dev exercises the renormalisation path", () => {
  // SCORING_AND_POLICY.md section 4: a check-in with no transcript scores with
  // S2 null and the weights renormalised over 0.75. If no item has a null
  // transcript, that path is untested.
  const nullTranscripts = SETS.dev.filter((i) => i.transcript === null);
  assert.ok(nullTranscripts.length >= 5, `only ${nullTranscripts.length} items with no transcript`);

  // And at least one where S1 is partial as well, so the "renormalise over the
  // questions actually answered" branch is covered too.
  const partial = SETS.dev.filter(
    (i) =>
      i.transcript === null &&
      [i.structured.q1, i.structured.q2, i.structured.q3].filter((a) => a !== undefined).length < 3,
  );
  assert.ok(partial.length >= 1, "no item exercises a partially answered S1");
});

test("every set covers all four tiers and all three written forms", () => {
  for (const name of SET_NAMES) {
    const tiers = new Set(SETS[name].map((i) => i.expectedTier));
    const langs = new Set(SETS[name].map((i) => i.lang));
    assert.deepEqual([...langs].sort(), ["en", "hi", "hi-rom"], `${name} is missing a written form`);
    if (name !== "safety") {
      assert.equal(tiers.size, 4, `${name} does not cover all four tiers`);
    }
  }
});

test("every item materialises into rows that satisfy types/contract.ts", () => {
  const today = new Date();

  ALL.forEach((item, index) => {
    const baseline = foldBaseline(item.caseContext.priorComposites, (m, v, x) =>
      updateEWMA(m, v, x),
    );
    // Throws on any schema violation, so no explicit assertion is needed —
    // but the rows are checked for the invariants the eval itself relies on.
    const { person, caseRow, checkin } = materialise(item, index, today, baseline);

    assert.equal(person.pseudonym, item.id);
    assert.equal(person.is_minor_flag, false, "a minor is never scored (CLAUDE.md rule 10)");
    assert.equal(caseRow.person_id, person.id);
    assert.equal(checkin.person_id, person.id);
    assert.equal(
      caseRow.relief_paid,
      item.caseContext.reliefOverdueDays === null,
      `${item.id}: relief_paid must follow from reliefOverdueDays`,
    );
  });
});
