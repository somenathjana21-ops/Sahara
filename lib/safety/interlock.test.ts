/**
 * lib/safety/interlock.test.ts — acceptance tests for the two interlock passes.
 *
 * Owner: TM1. Implements the subset of docs/SAFETY_SPEC.md section 8 that
 * lands inside checkInput() and checkOutput(), plus the section 4 lexicon
 * table and the section 6 banned-pattern table.
 *
 * Section 8 coverage, stated explicitly so a reader can see what is NOT here:
 *
 *   S1  40 seeded critical utterances, 100% detected   ── covered below
 *   S2  20 near-miss utterances, rate recorded         ── covered below
 *   S3  keypad 0 mid-call                              ── UI event, not this file
 *   S4  LLM output "you should try" rejected           ── covered below
 *   S5  provider unreachable                           ── partly: asserts these
 *                                                         functions are pure and
 *                                                         synchronous, so nothing
 *                                                         here can be affected by
 *                                                         a provider at all
 *   S6  check-in with no consent row -> 403            ── route handler
 *   S7  model returns Green on a Critical input        ── partly: asserts the
 *                                                         Pass-1 verdict cannot be
 *                                                         influenced by model output
 *   S8  two check-ins, one trend                       ── persistence
 *   S9  three missed check-ins                         ── scoring
 *   S10 minor indicator                                ── routing
 *
 * S3, S6, S8, S9 and S10 belong to the route/scoring/UI layers and are covered
 * by their own suites. They are listed here so nobody concludes the section 8
 * table is fully satisfied by this file.
 */

import { strict as assert } from "node:assert";
import test from "node:test";

import {
  BANNED_PATTERN_LIST,
  MAX_QUESTION_MARKS,
  MAX_REPLY_CHARS,
  checkInput,
  checkOutput,
  normalise,
} from "@/lib/safety/interlock";
import { LEXICON, type LexiconLang } from "@/lib/safety/lexicon";

/* ── S1 corpus ───────────────────────────────────────────────────────────── */

/**
 * 46 seeded critical utterances. No PII: no names, no numbers, no locations
 * (CLAUDE.md rule 6). Written as whole sentences rather than bare phrases,
 * because a bare-phrase corpus tests the lexicon against itself.
 */
const CRITICAL_UTTERANCES: { text: string; lang: LexiconLang }[] = [
  /* English */
  { text: "I want to end my life.", lang: "en" },
  { text: "Some days I think about killing myself.", lang: "en" },
  { text: "I don't want to live any more.", lang: "en" },
  { text: "Everyone would be better off dead without me around.", lang: "en" },
  { text: "I have been thinking about suicide.", lang: "en" },
  { text: "I might hurt myself tonight.", lang: "en" },
  { text: "There is no way out of this.", lang: "en" },
  { text: "Nothing is left for me now.", lang: "en" },
  { text: "I am giving up completely.", lang: "en" },
  { text: "There is no point in living.", lang: "en" },
  { text: "They are here, outside my house.", lang: "en" },
  { text: "He is coming for me now.", lang: "en" },
  { text: "They said they will kill me if I go to the police.", lang: "en" },
  { text: "Please help me, save me.", lang: "en" },
  { text: "I need help now.", lang: "en" },

  /* Hindi, Devanagari */
  { text: "मैं अब जीना नहीं चाहता।", lang: "hi" },
  { text: "मन करता है कि मर जाऊं।", lang: "hi" },
  { text: "मैं अपनी जान दे दूंगा।", lang: "hi" },
  { text: "आत्महत्या के बारे में सोचता रहता हूं।", lang: "hi" },
  { text: "खुदकुशी करने का मन करता है।", lang: "hi" },
  { text: "खुद को मार डालने का मन है।", lang: "hi" },
  { text: "मैं अब ज़िंदा नहीं रहना चाहता।", lang: "hi" },
  { text: "कोई रास्ता नहीं बचा है।", lang: "hi" },
  { text: "अब कुछ नहीं बचा।", lang: "hi" },
  { text: "मैंने हार मान ली है।", lang: "hi" },
  { text: "कोई उम्मीद नहीं है।", lang: "hi" },
  { text: "अब सब खत्म हो गया।", lang: "hi" },
  { text: "वो आ गए हैं, दरवाज़े पर खड़े हैं।", lang: "hi" },
  { text: "वो मुझे मार डालेंगे।", lang: "hi" },
  { text: "वो मुझे जान से मार देंगे।", lang: "hi" },
  { text: "मदद करो, बचाओ।", lang: "hi" },

  /* Hindi, romanised */
  { text: "ab main jeena nahi chahta", lang: "hi-rom" },
  { text: "marna chahta hoon bas", lang: "hi-rom" },
  { text: "mann karta hai mar jaun", lang: "hi-rom" },
  { text: "main apni jaan de dunga", lang: "hi-rom" },
  { text: "khudkushi ka khayal aata hai", lang: "hi-rom" },
  { text: "khud ko khatam kar lunga", lang: "hi-rom" },
  { text: "zinda nahi rehna chahta ab", lang: "hi-rom" },
  { text: "koi rasta nahi bacha", lang: "hi-rom" },
  { text: "kuch nahi bacha hai ab", lang: "hi-rom" },
  { text: "maine haar maan li", lang: "hi-rom" },
  { text: "koi ummeed nahi hai", lang: "hi-rom" },
  { text: "sab khatam ho gaya", lang: "hi-rom" },
  { text: "wo aa gaye hain bahar", lang: "hi-rom" },
  { text: "wo mujhe maar dalenge", lang: "hi-rom" },
  { text: "jaan se maar denge mujhe", lang: "hi-rom" },
  { text: "madad karo koi bachao", lang: "hi-rom" },
];

/**
 * 20 near-misses: real things a person in this system says that are NOT a
 * crisis. Section 8 test S2 says the over-fire rate is recorded, not required
 * to be zero, so this suite prints the rate and never fails on it.
 */
const NEAR_MISS_UTTERANCES: string[] = [
  "I have been sleeping badly this week.",
  "The hearing was postponed again.",
  "I feel tired most days.",
  "My neighbour has stopped talking to me.",
  "I went back to work on Monday.",
  "The compensation form is confusing.",
  "I am angry about the delay.",
  "I do not want to talk about the case today.",
  "It has been hard but I am managing.",
  "I am fine, nothing new to report.",
  "आज तबीयत ठीक नहीं है।",
  "सुनवाई की तारीख आगे बढ़ गई।",
  "मुझे रात को नींद नहीं आती।",
  "मैं काम पर वापस जाने लगा हूं।",
  "फॉर्म भरने में दिक्कत हो रही है।",
  "tabiyat theek nahi hai aaj",
  "neend nahi aati raat ko",
  "sunwai ki tareekh aage badh gayi",
  "kaam par wapas jane laga hoon",
  "form bharne me dikkat ho rahi hai",
];

/* ── S1: 100% recall on seeded critical utterances ───────────────────────── */

test("S1: at least 40 seeded critical utterances, across all three forms", () => {
  assert.ok(
    CRITICAL_UTTERANCES.length >= 40,
    `section 8 S1 asks for 40 seeded utterances, corpus has ${CRITICAL_UTTERANCES.length}`,
  );
  for (const lang of ["en", "hi", "hi-rom"] as const) {
    const n = CRITICAL_UTTERANCES.filter((u) => u.lang === lang).length;
    assert.ok(n >= 12, `${lang} slice has only ${n} utterances`);
  }
});

test("S1: every seeded critical utterance is detected — 100%, any miss blocks the build", () => {
  const misses = CRITICAL_UTTERANCES.filter((u) => !checkInput(u.text).hit);

  assert.deepEqual(
    misses.map((m) => `${m.lang}: ${m.text}`),
    [],
    "SAFETY_SPEC.md section 8 S1: a miss here is a person in crisis being asked about their sleep",
  );
});

test("S1: recall is 100% in EVERY language slice, reported separately", () => {
  /*
   * SAFETY_SPEC.md section 8: "A per-language number hidden inside an average
   * is exactly the failure this project is supposed to avoid." So this asserts
   * per slice and prints per slice, rather than asserting on the total.
   */
  for (const lang of ["en", "hi", "hi-rom"] as const) {
    const slice = CRITICAL_UTTERANCES.filter((u) => u.lang === lang);
    const detected = slice.filter((u) => checkInput(u.text).hit).length;
    console.log(
      `  recall[${lang}] = ${detected}/${slice.length} (${((detected / slice.length) * 100).toFixed(1)}%)`,
    );
    assert.equal(detected, slice.length, `${lang} recall is below 100%`);
  }
});

test("S1: a detection carries the category and the matched text for the counsellor", () => {
  const result = checkInput("I want to end my life.");
  assert.equal(result.hit, true);
  assert.equal(result.category, "self_harm_intent");
  assert.equal(result.matched, "end my life");
});

/* ── section 4: every phrase in the spec's own table fires ───────────────── */

const SPEC_TABLE_TERMS: string[] = [
  /* self-harm intent */
  "end my life", "kill myself", "don't want to live", "better off dead",
  "जीना नहीं चाहता", "अपनी जान", "मर जाऊं",
  "jeena nahi chahta", "marna chahta hoon", "jaan de dunga",
  /* hopelessness + finality */
  "no way out", "nothing left", "give up completely",
  "कोई रास्ता नहीं", "कुछ नहीं बचा",
  "koi rasta nahi", "kuch nahi bacha",
  /* immediate danger */
  "they are here", "coming for me now", "going to kill me",
  "वो आ गए", "मार डालेंगे",
  "wo aa gaye", "maar dalenge",
  /* direct request */
  "help me", "need help now", "save me",
  "मदद करो", "बचाओ",
  "madad karo", "bachao",
];

test("section 4: every term printed in the SAFETY_SPEC table fires", () => {
  const missing = SPEC_TABLE_TERMS.filter((t) => !checkInput(t).hit);
  assert.deepEqual(missing, [], "these terms are in the spec table but not detected");
});

/* ── section 4: negation must NOT suppress ───────────────────────────────── */

test("section 4: negated and reported-speech crisis phrases still fire", () => {
  /*
   * The two cases named in the spec's "Negation guard" note, plus the variants
   * a well-meaning refactor would break first. Over-firing is the correct
   * failure direction — if any of these ever stops firing, the interlock has
   * grown negation handling and must be reverted.
   */
  const mustStillFire = [
    "I don't want to kill myself.",
    "my brother said he'd kill me",
    "I would never end my life.",
    "I am not going to hurt myself.",
    "She asked me if I was thinking about suicide.",
    "मैं आत्महत्या नहीं करूंगा।",
    "main marna nahi chahta",
  ];

  for (const text of mustStillFire) {
    assert.equal(
      checkInput(text).hit,
      true,
      `"${text}" stopped firing — negation handling has crept in (SAFETY_SPEC.md section 4)`,
    );
  }
});

/* ── S2: near-misses are recorded, not required to be zero ───────────────── */

test("S2: near-miss over-fire rate is measured and reported", () => {
  const overFired = NEAR_MISS_UTTERANCES.filter((t) => checkInput(t).hit);
  const rate = (overFired.length / NEAR_MISS_UTTERANCES.length) * 100;

  console.log(
    `  over-fire rate = ${overFired.length}/${NEAR_MISS_UTTERANCES.length} (${rate.toFixed(1)}%)`,
  );
  for (const t of overFired) {
    console.log(`    over-fired: ${JSON.stringify(t)} -> ${checkInput(t).category}`);
  }

  /*
   * Deliberately not asserted at zero. SAFETY_SPEC.md section 8 S2: "Recorded,
   * not required to be zero — over-firing is acceptable, state the rate."
   * The only thing asserted is that the corpus is the size the spec asks for.
   */
  assert.equal(NEAR_MISS_UTTERANCES.length, 20);
});

/* ── normalisation contract ──────────────────────────────────────────────── */

test("normalise: lowercases, strips punctuation, collapses whitespace", () => {
  assert.equal(normalise("I don't want to live!"), "i dont want to live");
  assert.equal(normalise("  HELP,   ME!!  "), "help me");
  assert.equal(normalise("End -- My -- Life"), "end my life");
});

test("normalise: strips the danda but keeps Devanagari letters and matras", () => {
  assert.equal(normalise("जीना   नहीं\tचाहता।"), "जीना नहीं चाहता");
  assert.equal(normalise("कुछ नहीं बचा॥"), "कुछ नहीं बचा");
});

test("checkInput: punctuation and casing cannot evade a match", () => {
  for (const variant of ["KILL MYSELF", "kill, myself", "k i l l".replace(/ /g, "") + " myself!!!"]) {
    assert.equal(checkInput(variant).hit, true, `evaded by: ${variant}`);
  }
});

test("checkInput: empty and whitespace-only input does not fire", () => {
  assert.equal(checkInput("").hit, false);
  assert.equal(checkInput("   \n\t  ").hit, false);
  assert.equal(checkInput("!!! ... ???").hit, false);
});

/* ── S4: Pass 2 rejects the spec's example ───────────────────────────────── */

test("S4: LLM output containing 'you should try' is rejected", () => {
  const result = checkOutput("You should try to focus on the good things.");
  assert.equal(result.rejected, true, "section 8 S4: this must not reach a person");
  assert.equal(result.reason, "advice");
});

test("section 6: every banned pattern class rejects", () => {
  const cases: { text: string; reason: string }[] = [
    { text: "Have you considered speaking to your family?", reason: "advice" },
    { text: "I recommend keeping a routine.", reason: "advice" },
    { text: "That sounds like a trauma response.", reason: "diagnosis" },
    { text: "These are symptoms of depression.", reason: "diagnosis" },
    { text: "Everything will be fine.", reason: "false_reassurance" },
    { text: "Don't worry, this will pass.", reason: "false_reassurance" },
    { text: "The police will act on your complaint.", reason: "outcome_promise" },
    { text: "You will receive the compensation soon.", reason: "outcome_promise" },
    { text: "It sounds like there is no way out.", reason: "crisis_terms" },
  ];

  for (const c of cases) {
    const result = checkOutput(c.text);
    assert.equal(result.rejected, true, `not rejected: ${c.text}`);
    assert.equal(result.reason, c.reason, `wrong reason for: ${c.text}`);
  }
});

test("section 6: banned patterns are caught in Hindi and romanised Hindi too", () => {
  /*
   * The section 7 system prompt tells the model to mirror the user's language.
   * An English-only Pass 2 would leave every Hindi reply unguarded.
   */
  assert.equal(checkOutput("सब ठीक हो जाएगा।").rejected, true);
  assert.equal(checkOutput("चिंता मत करो।").rejected, true);
  assert.equal(checkOutput("sab theek ho jayega").rejected, true);
  assert.equal(checkOutput("aapko koshish karni chahiye").rejected, true);
});

/* ── section 6: the length rule ──────────────────────────────────────────── */

test("section 6: a reply of exactly 320 characters is allowed", () => {
  const text = "a".repeat(MAX_REPLY_CHARS);
  assert.equal(text.length, 320);
  assert.equal(checkOutput(text).rejected, false);
});

test("section 6: a reply of 321 characters is rejected as too long", () => {
  const result = checkOutput("a".repeat(MAX_REPLY_CHARS + 1));
  assert.equal(result.rejected, true);
  assert.equal(result.reason, "too_long");
});

test("section 6: one question mark is allowed, two are not", () => {
  assert.equal(MAX_QUESTION_MARKS, 1);

  const one = checkOutput("Thank you for telling me. How have you been sleeping?");
  assert.equal(one.rejected, false);

  const two = checkOutput("How have you been sleeping? And eating?");
  assert.equal(two.rejected, true);
  assert.equal(two.reason, "multiple_questions");
});

test("section 6: the length rule reads the raw reply, not the normalised one", () => {
  /*
   * Normalisation deletes question marks and changes the character count, so a
   * length check on the normalised string would measure the wrong string. A
   * reply padded to over 320 characters with punctuation is still too long.
   */
  const padded = "ok. ".repeat(90);
  assert.ok(padded.length > MAX_REPLY_CHARS);
  assert.equal(checkOutput(padded).reason, "too_long");
});

test("checkOutput: a compliant two-sentence reply passes", () => {
  const good = "Thank you for telling me that. How has your sleep been this week?";
  assert.equal(checkOutput(good).rejected, false);
  assert.equal(checkOutput(good).reason, undefined);
});

/* ── S5: nothing here can depend on a provider ───────────────────────────── */

test("S5: both passes are synchronous and return no Promise", () => {
  /*
   * The provider being unreachable cannot affect these functions, because they
   * cannot reach anything. Asserting on the constructor name catches an
   * `async` keyword being added, which is how a network call would arrive.
   */
  assert.equal(checkInput.constructor.name, "Function", "checkInput became async");
  assert.equal(checkOutput.constructor.name, "Function", "checkOutput became async");

  const inputResult = checkInput("I want to end my life.");
  const outputResult = checkOutput("You should try that.");
  assert.ok(!(inputResult instanceof Promise));
  assert.ok(!(outputResult instanceof Promise));
  assert.equal(inputResult.hit, true);
  assert.equal(outputResult.rejected, true);
});

/* ── S7: the model cannot influence or lower the Pass-1 verdict ──────────── */

test("S7: the Pass-1 verdict is a pure function of the user's text alone", () => {
  /*
   * A model returning tier "Green" on a Critical input is ignored because
   * there is nowhere for it to be heard: checkInput takes one argument, the
   * user's text, and consults nothing else. This is the file-level half of
   * section 8 S7; the tier arithmetic that refuses to lower a tier lives in
   * lib/policy and is tested there.
   */
  assert.equal(checkInput.length, 1, "checkInput grew a second argument");

  const text = "There is no way out and I want to end my life.";
  const before = checkInput(text);

  /* Whatever the model said, in either direction, changes nothing. */
  checkOutput("The person seems fine and is not at risk.");
  checkOutput("green");

  assert.deepEqual(checkInput(text), before);
  assert.equal(before.hit, true);
});

test("repeated calls return identical results — no stateful regex", () => {
  /*
   * A `g` or `y` flag on a shared RegExp makes .test()/.exec() advance
   * lastIndex, so the second call silently returns false. This is the single
   * most likely way for the interlock to break without any test noticing.
   */
  const text = "I want to kill myself.";
  const first = checkInput(text);
  assert.deepEqual(checkInput(text), first);
  assert.deepEqual(checkInput(text), first);
  assert.equal(first.hit, true);

  const reply = "You should try to rest.";
  const firstOut = checkOutput(reply);
  assert.deepEqual(checkOutput(reply), firstOut);
  assert.deepEqual(checkOutput(reply), firstOut);
});

test("no lexicon or banned pattern carries a stateful flag", () => {
  for (const entry of LEXICON) {
    assert.ok(
      !entry.pattern.global && !entry.pattern.sticky,
      `${entry.pattern} carries g or y — .test() would become stateful`,
    );
  }
  for (const banned of BANNED_PATTERN_LIST) {
    assert.ok(
      !banned.pattern.global && !banned.pattern.sticky,
      `${banned.pattern} carries g or y`,
    );
  }
});

/* ── lexicon shape ───────────────────────────────────────────────────────── */

test("lexicon: at least 12 entries per written form", () => {
  for (const lang of ["en", "hi", "hi-rom"] as const) {
    const n = LEXICON.filter((e) => e.lang === lang).length;
    assert.ok(n >= 12, `${lang} has ${n} entries, needs at least 12`);
  }
});

test("lexicon: all four SAFETY_SPEC categories are covered in all three forms", () => {
  const categories = [
    "self_harm_intent",
    "hopelessness_finality",
    "immediate_danger",
    "direct_request",
  ] as const;

  for (const lang of ["en", "hi", "hi-rom"] as const) {
    for (const category of categories) {
      const n = LEXICON.filter((e) => e.lang === lang && e.category === category).length;
      assert.ok(n >= 1, `${lang} has no entry for ${category}`);
    }
  }
});
