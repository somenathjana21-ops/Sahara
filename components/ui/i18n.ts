// components/ui/i18n.ts — TM2 owner, simple Hindi/English strings
// Stays in components/ui/ (TM2 territory), not lib/ (TM1 territory).

import type { Language } from "@/types/contract";

const translations = {
  en: {
    // Landing page
    landing_headline: "You don't have to carry this alone.",
    landing_subhead: "A simple, private way to share how you're doing — in your own words, in your own time.",
    landing_voluntary: "This is voluntary. It does not affect your case, your relief, or your compensation.",
    landing_start: "Start a check-in",
    landing_talk: "Talk to a person now",
    landing_what_does: "What this does",
    landing_what_does_body: "Gives you a quiet, private space to check in on how you're feeling, whenever you need it.",
    landing_what_doesnt: "What this doesn't do",
    landing_what_doesnt_body: "It doesn't replace a counsellor, doesn't make legal decisions, and never shares anything with police.",
    landing_voluntary_title: "It's voluntary",
    landing_voluntary_body: "You can stop anytime. Taking part — or not — never affects your case or any compensation.",

    // Header
    header_title: "Saathi Check-in",
    header_talk_to_person: "Talk to a person",

    // Consent
    consent_heading: "Before we begin",
    consent_check1: "I understand what will be recorded",
    consent_check2: "I understand a counsellor may contact me",
    consent_check3: "I understand this is voluntary and does not affect my case",
    consent_decline: "No, go back",
    consent_continue: "Continue",

    // Check-in
    checkin_q1: "How safe do you feel right now?",
    checkin_q2: "How well have you been sleeping?",
    checkin_q3: "How much support do you feel you have around you?",
    checkin_continue: "Continue",
    checkin_placeholder: "Share as much or as little as you'd like…",
    checkin_send: "Send",

    // Crisis
    crisis_heading: "If you need to talk to someone right now",
    crisis_subhead: "You don't have to wait. These lines are free and available now.",
    crisis_button: "Talk to a person now",
    crisis_nhaa: "NHAA — National Helpline Against Atrocities",
    crisis_telemanas: "Tele-MANAS — Mental health support",
  },

  hi: {
    // Landing page
    landing_headline: "आपको यह अकेले नहीं सहना है।",
    landing_subhead: "अपनी स्थिति साझा करने का एक सरल, निजी तरीका — अपने शब्दों में, अपने समय पर।",
    landing_voluntary: "यह स्वैच्छिक है। इससे आपके मामले, राहत या मुआवजे पर कोई प्रभाव नहीं पड़ता।",
    landing_start: "चेक-इन शुरू करें",
    landing_talk: "अभी किसी से बात करें",
    landing_what_does: "यह क्या करता है",
    landing_what_does_body: "जब भी आपको जरूरत हो, अपनी भावनाओं को साझा करने के लिए एक शांत, निजी स्थान देता है।",
    landing_what_doesnt: "यह क्या नहीं करता",
    landing_what_doesnt_body: "यह परामर्शदाता की जगह नहीं लेता, कानूनी निर्णय नहीं करता, और पुलिस के साथ कुछ भी साझा नहीं करता।",
    landing_voluntary_title: "यह स्वैच्छिक है",
    landing_voluntary_body: "आप कभी भी रुक सकते हैं। भाग लेना — या नहीं — कभी भी आपके मामले या मुआवजे को प्रभावित नहीं करता।",

    // Header
    header_title: "साथी चेक-इन",
    header_talk_to_person: "किसी से बात करें",

    // Consent
    consent_heading: "शुरू करने से पहले",
    consent_check1: "मैं समझता/समझती हूं कि क्या रिकॉर्ड किया जाएगा",
    consent_check2: "मैं समझता/समझती हूं कि एक परामर्शदाता मुझसे संपर्क कर सकता है",
    consent_check3: "मैं समझता/समझती हूं कि यह स्वैच्छिक है और मेरे मामले को प्रभावित नहीं करता",
    consent_decline: "नहीं, वापस जाएं",
    consent_continue: "जारी रखें",

    // Check-in
    checkin_q1: "अभी आप कितना सुरक्षित महसूस करते/करती हैं?",
    checkin_q2: "आप कितनी अच्छी तरह सो पा रहे/रही हैं?",
    checkin_q3: "आपको कितना समर्थन महसूस होता है?",
    checkin_continue: "जारी रखें",
    checkin_placeholder: "जितना चाहें उतना साझा करें…",
    checkin_send: "भेजें",

    // Crisis
    crisis_heading: "अगर आपको अभी किसी से बात करने की जरूरत है",
    crisis_subhead: "आपको इंतजार करने की जरूरत नहीं है। ये लाइनें मुफ्त हैं और अभी उपलब्ध हैं।",
    crisis_button: "अभी किसी से बात करें",
    crisis_nhaa: "NHAA — अत्याचार के खिलाफ राष्ट्रीय हेल्पलाइन",
    crisis_telemanas: "टेली-मानस — मानसिक स्वास्थ्य सहायता",
  },
} as const;

export type TranslationKey = keyof typeof translations.en;

export function t(key: TranslationKey, lang: Language = "en"): string {
  return translations[lang][key] || translations.en[key];
}
