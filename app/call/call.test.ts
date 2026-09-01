// app/call/call.test.ts — CHECKS_TM3 T3-D1 / T3-D2 / T3-D8
//
// The simulated-IVRS flow, tested without a microphone, without a DOM and
// without a network. `scripts/run-tests.mjs` globs `**/*.test.ts`, so this file
// is what `npm run test -- call` discovers.
//
// What each check wants, and where it is below:
//
//   T3-D1  panic key works offline        -> "offline" describe block. fetch is
//                                            replaced with a stub that rejects
//                                            AND counts calls; the assertion is
//                                            that the count stays zero.
//   T3-D2  panic key works at every state -> "every state" block, driven off
//                                            ALL_CALL_STATES rather than a
//                                            hand-listed five.
//   T3-D8  flow testable without speech   -> the whole file. Nothing here
//                                            imports React or touches
//                                            SpeechRecognition.
//
// Note on state names: CHECKS_TM3 T3-D2 lists `consent_notice`; the state in
// the code is `consent`. Same state, and the test asserts against the code's
// name.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ALL_CALL_STATES,
  ANSWER_STATES,
  PANIC_KEY,
  recordAnswer,
  reduceKeyPress,
  type CallState,
} from "./state";

/** The five states CHECKS_TM3 T3-D2 names, in the code's vocabulary. */
const T3_D2_STATES: readonly CallState[] = [
  "consent", // the doc calls this consent_notice
  "q1",
  "q2",
  "q3",
  "open_question",
];

describe("panic key — every state (T3-D2)", () => {
  it("covers all five states the check names, and they all exist", () => {
    for (const state of T3_D2_STATES) {
      assert.ok(
        ALL_CALL_STATES.includes(state),
        `${state} must be a real CallState, or this test is asserting nothing`,
      );
    }
    assert.equal(T3_D2_STATES.length, 5, "T3-D2 requires all five states");
  });

  for (const state of ALL_CALL_STATES) {
    it(`pressing 0 in "${state}" goes straight to crisis`, () => {
      const action = reduceKeyPress(state, PANIC_KEY);
      assert.equal(action.kind, "panic");
      assert.equal(
        action.kind === "panic" ? action.next : null,
        "crisis",
        "the panic key must reach the crisis panel from every state",
      );
    });
  }

  it("is never swallowed by a question — 0 in q1/q2/q3 is panic, not an answer of 0", () => {
    for (const state of ANSWER_STATES) {
      const action = reduceKeyPress(state, "0");
      assert.equal(
        action.kind,
        "panic",
        `"${state}" must treat 0 as the panic key, never as a score of zero`,
      );
    }
  });
});

describe("panic key — offline (T3-D1)", () => {
  const realFetch = globalThis.fetch;
  let fetchCalls = 0;

  beforeEach(() => {
    fetchCalls = 0;
    // Any network use at all fails the test twice over: the counter records it
    // and the rejection propagates.
    globalThis.fetch = (async (...args: unknown[]) => {
      fetchCalls += 1;
      throw new Error(`offline: fetch(${String(args[0])}) must not be called`);
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("reaches crisis from every state with fetch mocked to reject", () => {
    for (const state of ALL_CALL_STATES) {
      const action = reduceKeyPress(state, PANIC_KEY);
      assert.equal(action.kind, "panic", `${state} must still panic offline`);
    }
    assert.equal(fetchCalls, 0, "the panic path must not touch the network");
  });

  it("is synchronous — it returns an action, not a promise", () => {
    const action = reduceKeyPress("open_question", PANIC_KEY);
    assert.notEqual(
      reduceKeyPress.constructor.name,
      "AsyncFunction",
      "reduceKeyPress must not be async: a person in crisis cannot await anything",
    );
    assert.ok(
      !(action instanceof Promise),
      "the panic decision must be available in the same tick as the key press",
    );
  });

  it("handlePanicKey in page.tsx neither fetches nor awaits", () => {
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
    const start = source.indexOf("function handlePanicKey");
    assert.ok(start !== -1, "handlePanicKey must exist in app/call/page.tsx");

    // The function body: from its opening brace to the first line that closes
    // it at the same indentation.
    const body = source.slice(start, source.indexOf("\n  }", start));

    assert.ok(!/\bfetch\s*\(/.test(body), "handlePanicKey must not call fetch");
    assert.ok(!/\bawait\b/.test(body), "handlePanicKey must not await anything");
    assert.ok(
      /setCallState\(\s*['"]crisis['"]\s*\)/.test(body),
      "handlePanicKey must set the crisis state directly",
    );
  });

  it("the crisis panel on /call renders from a local constant, not a response", () => {
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
    assert.ok(
      /const CRISIS_RESOURCES\s*=/.test(source),
      "resources must be a module constant so they survive an offline panic press",
    );
    assert.ok(
      /resources=\{CRISIS_RESOURCES\}/.test(source),
      "CrisisPanel on /call must be fed the local constant",
    );
  });
});

describe("keypad flow — no microphone required (T3-D8)", () => {
  it("walks consent -> q1 -> q2 -> q3 -> open_question and collects three answers", () => {
    let state: CallState = "consent";
    let answers: number[] = [];

    for (const key of ["1", "3", "2", "4"]) {
      const action = reduceKeyPress(state, key);
      assert.equal(action.kind, "advance", `"${key}" should advance from ${state}`);
      if (action.kind !== "advance") return;
      if (action.answer !== null) {
        answers = recordAnswer(answers, action.answerIndex, action.answer);
      }
      state = action.next;
    }

    assert.equal(state, "open_question");
    assert.deepEqual(answers, [3, 2, 4], "q1, q2 and q3 land in order");
  });

  it("ignores keys that mean nothing in the current state", () => {
    assert.equal(reduceKeyPress("consent", "7").kind, "ignore");
    assert.equal(reduceKeyPress("idle", "5").kind, "ignore");
    assert.equal(reduceKeyPress("completed", "1").kind, "ignore");
    for (const key of ["*", "#"]) {
      assert.equal(
        reduceKeyPress("q1", key).kind,
        "ignore",
        `"${key}" is not an answer`,
      );
    }
  });

  it("rejects out-of-range answers", () => {
    assert.equal(reduceKeyPress("q1", "5").kind, "ignore");
    assert.equal(reduceKeyPress("q2", "9").kind, "ignore");
  });

  it("is pure — the same press decides the same thing every time", () => {
    const a = reduceKeyPress("q2", "3");
    const b = reduceKeyPress("q2", "3");
    assert.deepEqual(a, b);
  });

  it("re-answering a question drops the answers that followed it", () => {
    const answers = recordAnswer(recordAnswer(recordAnswer([], 0, 1), 1, 2), 2, 3);
    assert.deepEqual(answers, [1, 2, 3]);
    assert.deepEqual(recordAnswer(answers, 0, 4), [4], "q2 and q3 are now stale");
  });
});
