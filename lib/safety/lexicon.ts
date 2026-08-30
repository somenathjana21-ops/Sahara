/**
 * lib/safety/lexicon.ts — the deterministic crisis lexicon.
 *
 * Owner: TM1. Implements docs/SAFETY_SPEC.md section 4 (starter table),
 * consumed by section 3 (Critical triggers) and section 2 (both interlock
 * passes).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * REVIEWED_BY:Somenath Jana 
 * REVIEWED_ON:31-08-2026
 *
 * SAFETY_SPEC.md section 4: "a human reads every line and signs off. Record
 * who signed and when at the top of the file. An unreviewed lexicon is not a
 * safety layer." Until the two lines above are filled in, this file is a
 * draft. Do not present recall numbers from an unreviewed lexicon as a result.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * This is the ONLY place crisis detection lives (CLAUDE.md rule 1). It is data
 * — regular expressions — and never a prompt, a model call, or a model output.
 *
 * ## Patterns are written against NORMALISED text
 *
 * normalise() in lib/safety/interlock.ts runs before any pattern is tested. It
 * lowercases, deletes apostrophes, replaces every other non-letter with a
 * single space, and trims. So:
 *
 *   "I don't want to live!"   ->  "i dont want to live"
 *   "जीना नहीं चाहता।"          ->  "जीना नहीं चाहता"
 *
 * Consequences for anyone adding an entry here:
 *   - write patterns lowercase, with no punctuation and no apostrophes
 *     ("dont", never "don't");
 *   - use \s* between words rather than a literal space, so a separator that
 *     normalised to a space cannot break a match;
 *   - \b works for ASCII (English, romanised Hindi) but NOT for Devanagari,
 *     because Devanagari codepoints are non-word characters to JavaScript's
 *     \b. The Devanagari entries are unanchored substrings on purpose.
 *
 * ## No g flag, ever
 *
 * These RegExp objects are module-level and shared across every request. A g
 * flag makes .test() stateful through lastIndex, so the second call on the
 * same object silently returns false. That failure mode is invisible in
 * development and catastrophic in production. There is a test asserting that
 * no entry carries g or y.
 *
 * ## Over-firing is the intended failure direction
 *
 * "help me" is in here knowing it will fire on "can you help me with the
 * form". See SAFETY_SPEC.md section 4 and the note in lib/safety/interlock.ts.
 */

/**
 * The three written forms the MVP covers.
 *
 * This is NOT `Language` from types/contract.ts and must not be replaced by
 * it: `Language` is the person's language ('en' | 'hi'), a persona attribute,
 * while this is the script a phrase is written in. Romanised Hindi is Hindi to
 * a person and a separate matching problem to a regex — SAFETY_SPEC.md
 * section 4 calls it "the form teams forget".
 */
export const LEXICON_VERSION = "lexicon-v1.0.0"
export type LexiconLang = "en" | "hi" | "hi-rom";

/** The four categories in the SAFETY_SPEC.md section 4 table, in table order. */
export type LexiconCategory =
  | "self_harm_intent"
  | "hopelessness_finality"
  | "immediate_danger"
  | "direct_request";

export interface LexiconEntry {
  pattern: RegExp;
  lang: LexiconLang;
  category: LexiconCategory;
}

/**
 * Goes into `policy_version` on every assessment row this lexicon decided.
 * The word "unreviewed" stays in the string until REVIEWED_BY above is signed.
 */
export const LEXICON_VERSION = "lexicon-v0-unreviewed";

export const LEXICON: LexiconEntry[] = [
  /* ── English ─────────────────────────────────────────────────────────── */

  /* self-harm intent */
  { pattern: /\bend(ing)?\s*(my|his|her|their)\s*(life|lives)\b/i, lang: "en", category: "self_harm_intent" },
  { pattern: /\btak(e|ing)\s*(my|his|her|their)\s*own\s*life\b/i, lang: "en", category: "self_harm_intent" },
  { pattern: /\bkill(ing)?\s*(myself|himself|herself|themselves)\b/i, lang: "en", category: "self_harm_intent" },
  { pattern: /\b(dont|do\s*not|cant|cannot|no\s*longer)\s*want\s*to\s*(live|be\s*here|go\s*on|exist)\b/i, lang: "en", category: "self_harm_intent" },
  { pattern: /\b(better\s*off|be\s*better)\s*dead\b/i, lang: "en", category: "self_harm_intent" },
  { pattern: /\bsuicid(e|al)\b/i, lang: "en", category: "self_harm_intent" },
  { pattern: /\b(hang|cut|harm|hurt)\s*(myself|himself|herself|themselves)\b/i, lang: "en", category: "self_harm_intent" },

  /* hopelessness + finality */
  { pattern: /\bno\s*way\s*out\b/i, lang: "en", category: "hopelessness_finality" },
  { pattern: /\bnothing\s*(is\s*)?left\b/i, lang: "en", category: "hopelessness_finality" },
  { pattern: /\bgiv(e|ing)\s*up\s*(completely|entirely|on\s*everything)\b/i, lang: "en", category: "hopelessness_finality" },
  { pattern: /\bno\s*(point|hope|reason)\s*(in|to|left)?\s*(liv(e|ing)|go(ing)?\s*on|carry(ing)?\s*on|any\s*more)\b/i, lang: "en", category: "hopelessness_finality" },
  { pattern: /\bcant\s*(take|do|bear)\s*(it|this)\s*(any\s*more|any\s*longer)\b/i, lang: "en", category: "hopelessness_finality" },

  /* immediate danger */
  { pattern: /\bthey\s*(are|re)\s*(here|outside|at\s*(the|my)\s*(door|house|gate))\b/i, lang: "en", category: "immediate_danger" },
  { pattern: /\bcoming\s*(for|to\s*(get|kill|hurt))\s*me\b/i, lang: "en", category: "immediate_danger" },
  /* Unqualified "kill me", not "will kill me": SAFETY_SPEC.md section 4 names
     "my brother said he'd kill me" as a sentence that MUST fire, and a modal
     list will never cover every way a threat gets reported. Over-fires on
     "this paperwork is killing me" — intended. */
  { pattern: /\b(kill|killing|murder)\s*(me|us)\b/i, lang: "en", category: "immediate_danger" },
  { pattern: /\bthreaten(ed|ing)?\s*to\s*(kill|burn|attack)\b/i, lang: "en", category: "immediate_danger" },

  /* direct request */
  { pattern: /\bhelp\s*me\b/i, lang: "en", category: "direct_request" },
  { pattern: /\bneed\s*help\b/i, lang: "en", category: "direct_request" },
  { pattern: /\bsave\s*me\b/i, lang: "en", category: "direct_request" },
  { pattern: /\b(please|someone|somebody)\s*help\b/i, lang: "en", category: "direct_request" },

  /* ── Hindi, Devanagari ───────────────────────────────────────────────── */
  /* Unanchored on purpose: \b does not work against Devanagari codepoints.  */
  /* नहीं is written नहीं / नही / नहिं in the wild, hence नह[ीि]ं? throughout.   */

  /* self-harm intent */
  { pattern: /जीना\s*नह[ीि]ं?\s*चाहत[ाीे]/i, lang: "hi", category: "self_harm_intent" },
  { pattern: /मर\s*जा(ऊं|ऊँ|उं|उँ)/i, lang: "hi", category: "self_harm_intent" },
  /* The optional नहीं is negation TOLERANCE, not negation handling: an inserted
     negation token must not break the adjacency of a pattern that would
     otherwise match. "मरना नहीं चाहता" still fires (SAFETY_SPEC.md section 4). */
  { pattern: /मरना\s*(नह[ीि]ं?\s*)?चाहत/i, lang: "hi", category: "self_harm_intent" },
  /* Unqualified on purpose: SAFETY_SPEC.md section 4 lists the bare phrase
     "अपनी जान" as the trigger, so requiring a following verb would miss the
     spec's own term. It over-fires on "अपनी जान बचाओ" — intended. */
  { pattern: /अपनी\s*जान/i, lang: "hi", category: "self_harm_intent" },
  { pattern: /आत्महत्या/i, lang: "hi", category: "self_harm_intent" },
  { pattern: /ख़?ुदकुशी/i, lang: "hi", category: "self_harm_intent" },
  { pattern: /ख़?ुद\s*को\s*(मार|ख़?त्म|नुकसान)/i, lang: "hi", category: "self_harm_intent" },
  { pattern: /ज़?िंदा\s*नह[ीि]ं?\s*रह/i, lang: "hi", category: "self_harm_intent" },

  /* hopelessness + finality */
  { pattern: /कोई\s*रास्ता\s*नह[ीि]ं?/i, lang: "hi", category: "hopelessness_finality" },
  { pattern: /कुछ\s*नह[ीि]ं?\s*बचा/i, lang: "hi", category: "hopelessness_finality" },
  { pattern: /हार\s*मान\s*ल[ीि]/i, lang: "hi", category: "hopelessness_finality" },
  { pattern: /कोई\s*उम्मीद\s*नह[ीि]ं?/i, lang: "hi", category: "hopelessness_finality" },
  { pattern: /सब\s*ख़?त्म\s*हो\s*गया/i, lang: "hi", category: "hopelessness_finality" },

  /* immediate danger */
  { pattern: /(वो|वे|वोह)\s*आ\s*ग(ए|ये)/i, lang: "hi", category: "immediate_danger" },
  { pattern: /मार\s*डाल(ेंगे|ेगा|ेंगी|ूंगा)/i, lang: "hi", category: "immediate_danger" },
  { pattern: /जान\s*से\s*मार/i, lang: "hi", category: "immediate_danger" },
  { pattern: /धमक[ीि]\s*द[ीेि]/i, lang: "hi", category: "immediate_danger" },

  /* direct request */
  { pattern: /मदद\s*कर[ोेैं]/i, lang: "hi", category: "direct_request" },
  { pattern: /बचाओ|बचा\s*लो/i, lang: "hi", category: "direct_request" },
  { pattern: /मुझे\s*मदद\s*चाहिए/i, lang: "hi", category: "direct_request" },

  /* ── Hindi, romanised ────────────────────────────────────────────────── */
  /* Spelling is unstable here (nahi/nahin/nhi, maar/mar), so every entry     */
  /* alternates the common forms rather than betting on one transliteration.  */

  /* self-harm intent */
  { pattern: /\bjee?na\s*(nahi+n?|nhi|nai)\s*chah/i, lang: "hi-rom", category: "self_harm_intent" },
  /* See the Devanagari note above: the optional negation token is there so
     "marna nahi chahta" cannot slip through on word order alone. */
  { pattern: /\bmarna\s*((nahi+n?|nhi|na)\s*)?chah/i, lang: "hi-rom", category: "self_harm_intent" },
  { pattern: /\bmar\s*ja(u|oo)/i, lang: "hi-rom", category: "self_harm_intent" },
  { pattern: /\bjaan\s*(de|deni|dene|dedu|le\s*lu)\b/i, lang: "hi-rom", category: "self_harm_intent" },
  { pattern: /\b(khud\s*kushi|khudkushi|a+tma?hatya)\b/i, lang: "hi-rom", category: "self_harm_intent" },
  { pattern: /\bkhud\s*ko\s*(maar|mar|khatam|khtm)/i, lang: "hi-rom", category: "self_harm_intent" },
  { pattern: /\bzinda\s*(nahi+n?|nhi)\s*reh/i, lang: "hi-rom", category: "self_harm_intent" },

  /* hopelessness + finality */
  { pattern: /\bkoi\s*raa?sta\s*(nahi+n?|nhi)\b/i, lang: "hi-rom", category: "hopelessness_finality" },
  { pattern: /\bkuch\s*(nahi+n?|nhi)\s*bach[aie]/i, lang: "hi-rom", category: "hopelessness_finality" },
  { pattern: /\bhaa?r\s*maa?n\s*li\b/i, lang: "hi-rom", category: "hopelessness_finality" },
  { pattern: /\bkoi\s*umm?ee?d\s*(nahi+n?|nhi)\b/i, lang: "hi-rom", category: "hopelessness_finality" },
  { pattern: /\bsab\s*(khatam|khtm|khatm)\s*ho\s*gaya\b/i, lang: "hi-rom", category: "hopelessness_finality" },

  /* immediate danger */
  { pattern: /\b(wo|woh|ve|vo)\s*aa\s*ga(ye|e)\b/i, lang: "hi-rom", category: "immediate_danger" },
  { pattern: /\bmaa?r\s*daa?l(enge|ega|engi|unga|dunga)\b/i, lang: "hi-rom", category: "immediate_danger" },
  { pattern: /\bjaan\s*se\s*maa?r/i, lang: "hi-rom", category: "immediate_danger" },
  { pattern: /\bdhamk[iy]\s*d[ie]\b/i, lang: "hi-rom", category: "immediate_danger" },

  /* direct request */
  { pattern: /\bmadad\s*kar[oe]?\b/i, lang: "hi-rom", category: "direct_request" },
  { pattern: /\b(bachao|bacha\s*lo)\b/i, lang: "hi-rom", category: "direct_request" },
  { pattern: /\bmujhe\s*madad\s*chahiye\b/i, lang: "hi-rom", category: "direct_request" },
  { pattern: /\bhelp\s*kar[oe]?\b/i, lang: "hi-rom", category: "direct_request" },
];
