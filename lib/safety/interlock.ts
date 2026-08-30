/**
 * lib/safety/interlock.ts — the two-pass safety interlock.
 *
 * Owner: TM1. Implements docs/SAFETY_SPEC.md section 2 (the two-pass rule),
 * section 4 (normalisation + no negation handling) and section 6 (the Pass-2
 * banned-pattern table).
 *
 *   user input ──► checkInput()  ──► hit: CRITICAL, LLM is never called
 *                        │ no hit
 *                        ▼
 *                     [ LLM ]
 *                        ▼
 *                  checkOutput() ──► rejected: discard reply, use
 *                        │           fallback_reply from replies.ts
 *                        ▼
 *                    user sees text
 *
 * ## Hard constraints on this file
 *
 * No LLM call. No network call. No `async`, no Promise, no I/O of any kind.
 * Both exports are pure synchronous functions of their argument. That is what
 * makes SAFETY_SPEC.md section 8 test S5 pass: the provider can be unreachable
 * and a person in crisis still gets resources. It is also how the 50 ms budget
 * in section 1 is met — the work here is a few dozen regex tests.
 *
 * Pass 2 is the one people forget (SAFETY_SPEC.md section 2). Do not remove it
 * (CLAUDE.md rule 2).
 *
 * ## Why there is no negation handling
 *
 * SAFETY_SPEC.md section 4, "Negation guard": "I don't want to kill myself"
 * and "my brother said he'd kill me" MUST still fire. Both are, in a real
 * intake, reasons to put a human on the line — the first because people say it
 * while meaning the opposite and the second because it is a threat report.
 *
 * A negation parser would suppress both. In a crisis system over-firing is the
 * correct failure direction: the cost of a false positive is a counsellor
 * reading one extra transcript, and the cost of a false negative is a person
 * in danger being asked about their sleep. So this file deliberately does NOT
 * look at "not", "don't", "never", quotation, reported speech, or who the
 * subject of the sentence is. It asks one question: does any lexicon pattern
 * appear in the text. Do not "fix" this. SAFETY_SPEC.md section 8 test S2
 * exists to measure the resulting over-fire rate, not to drive it to zero.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * REVIEWED_BY: Somenath Jana
 * REVIEWED_ON: 2026-08-30
 *
 * Scope of this signature: the BANNED_PATTERNS table below, which is Pass 2.
 * Checked by docs/CHECKS_TM1.md T1-B9, alongside the separate signature on
 * lib/safety/lexicon.ts.
 *
 * These patterns decide whether a model's reply reaches a person in distress,
 * and the Hindi and romanised-Hindi entries were drafted by an agent. Signing
 * here asserts that a human who reads Hindi has read every one of them — not
 * that the tests pass. If that is not true yet, blank these two lines; a
 * failing T1-B9 is recoverable, a signature that was never earned is not.
 * ─────────────────────────────────────────────────────────────────────────
 */
export const LEXICON_VERSION = "lexicon-v1.0.0"
import { LEXICON } from "@/lib/safety/lexicon";

/* ── normalisation ───────────────────────────────────────────────────────── */

/**
 * Apostrophes are DELETED rather than replaced by a space, so "don't" becomes
 * "dont" and stays one token. Every other separator becomes a space.
 */
const APOSTROPHES = /['‘’ʼ`´]/g;

/** Zero-width joiners would otherwise split Devanagari clusters into "words". */
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;

/**
 * Everything that is not an ASCII letter/digit or a Devanagari codepoint
 * becomes a single space.
 *
 * The range is split around U+0964/U+0965 on purpose: those are the danda and
 * double danda, which sit inside the Devanagari block but are punctuation, and
 * section 4 says punctuation is stripped. Keeping them would leave "चाहता।"
 * unable to match a pattern ending in "चाहता".
 */
const NON_TOKEN = /[^a-z0-9\u0900-\u0963\u0966-\u097F]+/g;

/**
 * Lowercase, strip punctuation, collapse whitespace — SAFETY_SPEC.md section 4.
 *
 * Exported so the lexicon's authors can check what their patterns will
 * actually be tested against, and so the tests can assert the contract
 * directly instead of inferring it from match results.
 */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(ZERO_WIDTH, "")
    .replace(APOSTROPHES, "")
    .replace(NON_TOKEN, " ")
    .trim();
}

/* ── Pass 1: user input ──────────────────────────────────────────────────── */

export interface InputCheck {
  hit: boolean;
  /** The LexiconCategory of the first matching entry, for the alert row. */
  category?: string;
  /** The substring that matched, for the counsellor-facing explanation. */
  matched?: string;
}

/**
 * Pass 1. Runs on user input BEFORE any model call.
 *
 * A hit means CRITICAL (SAFETY_SPEC.md section 3): resources render in the
 * same response, an alerts row is written, and the LLM is not consulted. The
 * model cannot override this and cannot lower it (CLAUDE.md rule 4).
 *
 * Returns the FIRST match in lexicon array order, so the result is stable for
 * a given input and reviewable against the file.
 */
export function checkInput(text: string): InputCheck {
  const normalised = normalise(text);
  if (normalised.length === 0) return { hit: false };

  for (const entry of LEXICON) {
    const match = entry.pattern.exec(normalised);
    if (match) {
      return { hit: true, category: entry.category, matched: match[0] };
    }
  }

  return { hit: false };
}

/* ── Pass 2: model output ────────────────────────────────────────────────── */

/**
 * The pattern classes in the SAFETY_SPEC.md section 6 table, in table order.
 * `reason` is the class slug and nothing else: it is a metric dimension (the
 * spec asks for the rejection count) and needs to stay stable and low
 * cardinality across builds.
 */
type BannedClass =
  | "advice"
  | "diagnosis"
  | "false_reassurance"
  | "outcome_promise"
  | "crisis_terms"
  | "too_long"
  | "multiple_questions";

interface BannedPattern {
  reason: BannedClass;
  pattern: RegExp;
}

/**
 * Hindi and romanised-Hindi variants are included alongside the English
 * examples from the section 6 table. The system prompt in section 7 tells the
 * model to mirror the user's language, so an English-only Pass 2 would leave
 * every Hindi reply unguarded — which is the half of the userbase this project
 * exists for. Same normalisation rules as the lexicon apply: lowercase, no
 * punctuation, no apostrophes ("dont", never "don't").
 */
const BANNED_PATTERNS: BannedPattern[] = [
  /* Advice */
  { reason: "advice", pattern: /\byou\s*(should|could|might\s*want|need\s*to|can\s*try)\b/i },
  { reason: "advice", pattern: /\btry\s*(to|and|doing|taking)\b/i },
  { reason: "advice", pattern: /\bi\s*(recommend|suggest|would\s*advise|advise)\b/i },
  { reason: "advice", pattern: /\bwhat\s*(helps|works)\s*is\b/i },
  { reason: "advice", pattern: /\bhave\s*you\s*(considered|thought\s*about|tried)\b/i },
  { reason: "advice", pattern: /\b(it\s*helps\s*to|make\s*sure\s*(you|to)|be\s*sure\s*to)\b/i },
  { reason: "advice", pattern: /आपको\s*चाहिए|कोशिश\s*कर|सलाह\s*(दूंगा|देता|देती)/i },
  /* No trailing \b: Hindi verbs inflect ("koshish karni chahiye"), and a
     closing boundary would let every inflected form through. */
  { reason: "advice", pattern: /\b(aapko\s*chahiye|koshish\s*kar|kar(ni|na)\s*chahiye|salah\s*(dunga|deta|deti))/i },

  /* Diagnosis */
  { reason: "diagnosis", pattern: /\bdepress(ion|ed|ive)\b/i },
  { reason: "diagnosis", pattern: /\banxiety\b|\banxious\b/i },
  { reason: "diagnosis", pattern: /\b(ptsd|post\s*traumatic)\b/i },
  { reason: "diagnosis", pattern: /\btrauma\s*(response|reaction)\b/i },
  { reason: "diagnosis", pattern: /\bsymptoms?\s*of\b/i },
  { reason: "diagnosis", pattern: /\b(mental\s*(illness|health\s*condition)|disorder|diagnos(is|ed|e))\b/i },
  { reason: "diagnosis", pattern: /अवसाद|डिप्रेशन|मानसिक\s*बीमारी/i },
  { reason: "diagnosis", pattern: /\b(avsaad|depression|maansik\s*bimari)\b/i },

  /* False reassurance */
  { reason: "false_reassurance", pattern: /\beverything\s*(will|is\s*going\s*to)\s*be\s*(fine|ok|okay|alright|all\s*right)\b/i },
  { reason: "false_reassurance", pattern: /\bdont\s*worry\b|\bno\s*need\s*to\s*worry\b/i },
  { reason: "false_reassurance", pattern: /\b(it|things)\s*(will|is\s*going\s*to)\s*get\s*better\b/i },
  { reason: "false_reassurance", pattern: /\bthis\s*(too\s*)?(will|shall)\s*pass\b/i },
  { reason: "false_reassurance", pattern: /\byou\s*(will|re\s*going\s*to)\s*be\s*(fine|ok|okay|alright|safe)\b/i },
  { reason: "false_reassurance", pattern: /\bi\s*understand\s*how\s*you\s*(feel|are\s*feeling)\b/i },
  { reason: "false_reassurance", pattern: /सब\s*ठीक\s*हो\s*जाएगा|चिंता\s*(मत|ना)\s*कर/i },
  { reason: "false_reassurance", pattern: /\b(sab\s*theek\s*ho\s*jayega|chinta\s*(mat|na)\s*kar)\b/i },

  /* Outcome promises */
  { reason: "outcome_promise", pattern: /\b(the\s*)?police\s*will\b/i },
  { reason: "outcome_promise", pattern: /\byour\s*case\s*will\b/i },
  { reason: "outcome_promise", pattern: /\byou\s*will\s*(receive|get|be\s*(compensated|paid|protected))\b/i },
  { reason: "outcome_promise", pattern: /\b(the\s*court|the\s*judge|justice)\s*will\b/i },
  { reason: "outcome_promise", pattern: /\bi\s*(promise|guarantee|assure\s*you)\b/i },
  { reason: "outcome_promise", pattern: /पुलिस\s*(कार्रवाई\s*)?करेगी|आपको\s*(न्याय|मुआवजा)\s*मिलेगा/i },
  { reason: "outcome_promise", pattern: /\b(police\s*karyavahi\s*karegi|aapko\s*(nyay|muavza)\s*milega)\b/i },
];

export interface OutputCheck {
  rejected: boolean;
  reason?: string;
}

/** SAFETY_SPEC.md section 6, length rule. */
export const MAX_REPLY_CHARS = 320;
export const MAX_QUESTION_MARKS = 1;

/**
 * Pass 2. Runs on the model's reply BEFORE it reaches a person.
 *
 * Rejected means: discard the reply entirely and send `fallback_reply` from
 * lib/safety/replies.ts. Log the rejection — SAFETY_SPEC.md section 6 says the
 * rejection count is a metric worth showing.
 *
 * Checks run in section 6 table order, so `reason` is the first class the
 * reply violated and is reproducible from the spec.
 */
export function checkOutput(text: string): OutputCheck {
  const normalised = normalise(text);

  for (const banned of BANNED_PATTERNS) {
    if (banned.pattern.test(normalised)) {
      return { rejected: true, reason: banned.reason };
    }
  }

  /*
   * "Crisis handling: any lexicon term appearing in the model's own output."
   * The same Pass-1 lexicon, reused rather than duplicated — a term added to
   * lexicon.ts must start guarding the output in the same commit.
   */
  const crisis = checkInput(text);
  if (crisis.hit) {
    return { rejected: true, reason: "crisis_terms" };
  }

  /*
   * Length rules run against the RAW text, not the normalised text.
   * Normalisation deletes the question marks we need to count and changes the
   * character count, so measuring the normalised form would measure the wrong
   * string. A model that writes four sentences is a model that has started
   * counselling (SAFETY_SPEC.md section 6).
   */
  if (text.length > MAX_REPLY_CHARS) {
    return { rejected: true, reason: "too_long" };
  }

  const questionMarks = (text.match(/[?？]/g) ?? []).length;
  if (questionMarks > MAX_QUESTION_MARKS) {
    return { rejected: true, reason: "multiple_questions" };
  }

  return { rejected: false };
}

/** Exported for the tests that assert no entry carries a stateful flag. */
export const BANNED_PATTERN_LIST: readonly BannedPattern[] = BANNED_PATTERNS;
