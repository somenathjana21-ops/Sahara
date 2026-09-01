// app/call/state.ts — TM3 owner
//
// The simulated-IVRS keypad state machine, as a pure function.
//
// It lives outside page.tsx because CHECKS_TM3 T3-D1/T3-D2/T3-D8 require the
// flow to be testable "without a microphone" — and, before this file, the
// transition logic was a closure inside `CallPageInner`, reachable only by
// rendering React in a DOM. There is no DOM in the test harness and adding one
// would mean a new dependency (CLAUDE.md, scope discipline).
//
// Nothing here touches the network, the DOM, `speechSynthesis` or React. That
// is the property T3-D1 is really asserting: pressing 0 reaches the crisis
// state through code that cannot fail because a request failed. The page keeps
// the side effects (speaking the prompt, setting React state); this decides
// only what should happen.

/** Every state the call screen can be in. */
export type CallState =
  | 'idle'
  | 'connecting'
  | 'consent'
  | 'q1'
  | 'q2'
  | 'q3'
  | 'open_question'
  | 'completed'
  | 'crisis';

/**
 * Enumerated so a test can iterate every state rather than listing the five
 * T3-D2 names and silently missing a sixth added later.
 */
export const ALL_CALL_STATES: readonly CallState[] = [
  'idle',
  'connecting',
  'consent',
  'q1',
  'q2',
  'q3',
  'open_question',
  'completed',
  'crisis',
];

/**
 * The panic key. Checked before anything else in `reduceKeyPress`, so it is
 * never read as an answer to a question and never depends on the current
 * state. SAFETY_SPEC.md section 1: a person in crisis must reach resources
 * even when everything else is down.
 */
export const PANIC_KEY = '0';

/** The states that accept a 0-4 answer, in the order they are asked. */
export const ANSWER_STATES = ['q1', 'q2', 'q3'] as const;

export type KeyAction =
  /** Go to the crisis panel now. Local, synchronous, no network. */
  | { kind: 'panic'; next: 'crisis' }
  /**
   * Advance the flow. `answer` is the 0-4 value to record, or null when the
   * key only moved the flow on (the '1' that accepts the consent notice).
   * `answerIndex` is its slot in the answers array.
   */
  | { kind: 'advance'; next: CallState; answer: number | null; answerIndex: number }
  /** The key means nothing in this state. Do nothing at all. */
  | { kind: 'ignore' };

const IGNORE: KeyAction = { kind: 'ignore' };

/** Which state each answer state hands off to. */
const AFTER: Record<(typeof ANSWER_STATES)[number], CallState> = {
  q1: 'q2',
  q2: 'q3',
  q3: 'open_question',
};

function isAnswerState(state: CallState): state is (typeof ANSWER_STATES)[number] {
  return (ANSWER_STATES as readonly string[]).includes(state);
}

/**
 * Decide what a keypad press means. Pure: same inputs, same output, no I/O.
 *
 * The panic branch is FIRST and unconditional. Because it returns before the
 * answer branches, '0' can never also be recorded as an answer of zero — which
 * is why `q1` in practice accepts 1-4 even though the range reads 0-4.
 */
export function reduceKeyPress(state: CallState, key: string): KeyAction {
  // 0 is ALWAYS the panic key, in every state, before any other rule.
  if (key === PANIC_KEY) return { kind: 'panic', next: 'crisis' };

  if (state === 'consent' && key === '1') {
    return { kind: 'advance', next: 'q1', answer: null, answerIndex: -1 };
  }

  if (isAnswerState(state)) {
    const value = parseInt(key, 10);
    // NaN fails both comparisons, so '*' and '#' fall through to ignore.
    if (value >= 0 && value <= 4) {
      return {
        kind: 'advance',
        next: AFTER[state],
        answer: value,
        answerIndex: ANSWER_STATES.indexOf(state),
      };
    }
  }

  return IGNORE;
}

/**
 * Record an answer at its slot, dropping anything after it.
 *
 * Truncating rather than appending means re-answering q1 cannot leave a stale
 * q2/q3 behind it, which the previous `[...answers, val]` could.
 */
export function recordAnswer(
  answers: readonly number[],
  answerIndex: number,
  answer: number,
): number[] {
  const next = answers.slice(0, answerIndex);
  next[answerIndex] = answer;
  return next;
}
