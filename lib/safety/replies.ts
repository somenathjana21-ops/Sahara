/**
 * lib/safety/replies.ts — the fixed reply bank.
 *
 * Owner: TM1. Implements docs/SAFETY_SPEC.md section 5.
 *
 * Every string in this file is human-written and fixed. The LLM never
 * generates, rewrites, paraphrases, translates or "improves" any of them
 * (CLAUDE.md rule 3). If a caller finds itself interpolating model output into
 * one of these, that is the bug.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 
 *
 * VERIFIED_BY:Somenath Jana
 * VERIFIED_ON:31-08-2026
 *
 * SAFETY_SPEC.md section 5: "Verify both are current before the demo; a wrong
 * helpline number on stage is the worst possible detail to get wrong."
 *
 * The values below are the ones the spec names (NHAA 14566, Tele-MANAS 14416)
 * and match lib/safety/stub-guard.ts. They are NOT left blank on purpose: an
 * empty constant here renders a crisis card with no number on it, which is a
 * worse failure than an unverified one. A human still has to dial both and
 * sign the two lines above before Day 5.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Person-facing language. Matches `Language` in types/contract.ts. */
export type ReplyLang = "en" | "hi";

export interface Helpline {
  phone: string;
  label: Record<ReplyLang, string>;
}

/**
 * One place, so the numbers are correct everywhere (SAFETY_SPEC.md section 5).
 * lib/safety/stub-guard.ts duplicates these deliberately and must not import
 * them — see the comment in that file.
 */
export const HELPLINES: Helpline[] = [
  {
    phone: "14566", //   
    label: {
      en: "National Helpline Against Atrocities",
      hi: "अत्याचार निवारण राष्ट्रीय हेल्पलाइन",
    },
  },
  {
    phone: "14416", // 
    label: {
      en: "Tele-MANAS mental health helpline",
      hi: "टेली-मानस मानसिक स्वास्थ्य हेल्पलाइन",
    },
  },
  {
    phone: "1800-89-14416", // 
    label: {
      en: "Tele-MANAS mental health helpline",
      hi: "टेली-मानस मानसिक स्वास्थ्य हेल्पलाइन",
    },
  },
];

/** The section 5 key table, exactly. */
export type ReplyKey =
  | "consent_notice"
  | "crisis_immediate"
  | "crisis_resources"
  | "fallback_reply"
  | "llm_unavailable"
  | "closing_low"
  | "closing_med"
  | "minor_detected"
  | "wrong_person";

function resourceLines(lang: ReplyLang): string {
  return HELPLINES.map((h) => `${h.label[lang]}: ${h.phone}`).join("\n");
}

export const REPLIES: Record<ReplyKey, Record<ReplyLang, string>> = {
  /**
   * Start of every session. Must state that it is voluntary and that it does
   * not affect any claim, relief, or compensation (SAFETY_SPEC.md section 5).
   */
  consent_notice: {
    en:
      "This check-in is voluntary. You can stop at any time, and you do not have to answer anything.\n" +
      "Taking part, or not taking part, does not affect your case, your claim, or any relief or compensation you are entitled to.\n" +
      "What you say is recorded so that a support worker can follow up. Do you agree to continue?",
    hi:
      "यह बातचीत स्वैच्छिक है। आप कभी भी रोक सकते हैं, और किसी भी सवाल का जवाब देना ज़रूरी नहीं है।\n" +
      "इसमें भाग लेने या न लेने से आपके मामले, आपके दावे, या आपको मिलने वाली किसी भी राहत या मुआवज़े पर कोई असर नहीं पड़ेगा।\n" +
      "आपकी बात दर्ज की जाती है ताकि एक सहायता कर्मी आगे संपर्क कर सके। क्या आप जारी रखने के लिए सहमत हैं?",
  },

  /**
   * Critical fired. Acknowledges, names that a person is being contacted,
   * lists resources. It does not counsel, advise, or ask a question.
   */
  crisis_immediate: {
    en:
      "Thank you for telling us. We have passed this to a support worker now, and a person will contact you.\n\n" +
      "If you need to speak to someone straight away, these lines are open:\n" +
      `${resourceLines("en")}\n\n` +
      "If you are in immediate danger, call 112.",
    hi:
      "हमें बताने के लिए धन्यवाद। हमने यह अभी एक सहायता कर्मी को भेज दिया है, और एक व्यक्ति आपसे संपर्क करेगा।\n\n" +
      "अगर आप अभी किसी से बात करना चाहते हैं, तो ये नंबर उपलब्ध हैं:\n" +
      `${resourceLines("hi")}\n\n` +
      "अगर आप तत्काल ख़तरे में हैं, तो 112 पर कॉल करें।",
  },

  /** The numbers on their own, for the crisis card and the call screen. */
  crisis_resources: {
    en: resourceLines("en"),
    hi: resourceLines("hi"),
  },

  /** Pass 2 rejected the LLM output. Says nothing the model was going to say. */
  fallback_reply: {
    en: "Thank you for sharing that. A support worker will read this and follow up with you.",
    hi: "यह बताने के लिए धन्यवाद। एक सहायता कर्मी इसे पढ़ेगा और आपसे संपर्क करेगा।",
  },

  /**
   * Provider down or rate-limited. The check-in still logs and still scores on
   * S1/S3/S4, so this says "recorded", not "failed" (SAFETY_SPEC.md section 5,
   * acceptance test S5).
   */
  llm_unavailable: {
    en: "Your check-in has been recorded. A support worker will see it.",
    hi: "आपकी बात दर्ज कर ली गई है। एक सहायता कर्मी इसे देखेगा।",
  },

  /** End of a Green session. */
  closing_low: {
    en: "Thank you for your time. This check-in is complete, and it has been recorded.",
    hi: "आपके समय के लिए धन्यवाद। यह बातचीत पूरी हो गई है और दर्ज कर ली गई है।",
  },

  /** End of an Amber session. States the follow-up; promises no outcome. */
  closing_med: {
    en:
      "Thank you for your time. This check-in has been recorded and passed to a support worker, who will be in touch.\n\n" +
      "These lines are open if you want to speak to someone before then:\n" +
      `${resourceLines("en")}`,
    hi:
      "आपके समय के लिए धन्यवाद। यह बातचीत दर्ज कर ली गई है और एक सहायता कर्मी को भेज दी गई है, जो आपसे संपर्क करेंगे।\n\n" +
      "तब तक अगर आप किसी से बात करना चाहें, तो ये नंबर उपलब्ध हैं:\n" +
      `${resourceLines("hi")}`,
  },

  /** Any minor indicator. Routes to a human, no scoring (CLAUDE.md rule 10). */
  minor_detected: {
    en: "Thank you. We will stop here, and a support worker will take this forward with you directly.",
    hi: "धन्यवाद। हम यहीं रोक रहे हैं, और एक सहायता कर्मी इसे सीधे आपके साथ आगे बढ़ाएंगे।",
  },

  /** Someone other than the persona is on the line. Reveals nothing. */
  wrong_person: {
    en: "Sorry, we cannot continue this call. Thank you for your time.",
    hi: "क्षमा करें, हम यह बातचीत जारी नहीं रख सकते। आपके समय के लिए धन्यवाद।",
  },
};

/**
 * The only way callers should read this file. Keeping it a function rather
 * than letting routes index REPLIES directly means the fallback language is
 * decided in one place if a caller ever passes something unexpected.
 */
export function reply(key: ReplyKey, lang: ReplyLang): string {
  return REPLIES[key][lang] ?? REPLIES[key].en;
}
