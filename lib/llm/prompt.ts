/**
 * lib/llm/prompt.ts — the "pre-prompted model".
 *
 * Owner: TM1. SYSTEM_PROMPT below is docs/SAFETY_SPEC.md section 7, copied
 * verbatim. If the spec changes, change it there first, copy it here, and bump
 * PROMPT_VERSION in the same commit.
 *
 * ## This prompt is not a safety layer
 *
 * Read the "YOU MUST NOT" list and it is tempting to file this under safety.
 * It is not. A system prompt is a request and a regex is a guarantee
 * (SAFETY_SPEC.md section 1) — this text is how the model is asked to behave,
 * and lib/safety/interlock.ts is what happens when it does not. Every rule
 * below that matters is independently enforced after the model answers: the
 * advice ban, the diagnosis ban, the reassurance ban, the two-sentence limit
 * and the single-question limit are all in the Pass-2 table (SAFETY_SPEC.md
 * section 6) and all run on the reply before a person sees it.
 *
 * So: never add a crisis instruction here (CLAUDE.md rule 1), never move a
 * Pass-2 rule out of the interlock and into this string, and never let the
 * fixed strings in lib/safety/replies.ts be generated from it (rule 3).
 *
 * ## What the caller supplies
 *
 * The prompt refers to "the provided question list" and asks for a
 * `next_question_id` from it. That list, and the user's message, go in the
 * `user` argument of `complete()` — they are turn data, not prompt text, and
 * keeping them out of here is what lets PROMPT_VERSION mean something.
 */

/**
 * Bumped whenever the string below changes by even one character, because two
 * assessments scored under different prompts are not comparable and the
 * version is the only way to tell them apart afterwards.
 *
 * SAFETY_SPEC.md section 7 asks for this version to be recorded on every
 * assessment. Note that assessments.model_version is specified separately, in
 * TM1_GUIDE.md section 4, as exactly `provider.name + ':' + provider.modelId`
 * — see `modelVersion()` in ./index.ts. Whoever writes the assessment row
 * decides how to record this alongside it; this module only guarantees the
 * value is available and accurate.
 */
export const PROMPT_VERSION = "1.0.0";

/**
 * Verbatim from docs/SAFETY_SPEC.md section 7, the fenced block.
 *
 * Do not reformat, re-wrap, "improve" the tone, or translate it. The line
 * breaks are the spec's. A diff against the spec should be empty.
 */
export const SYSTEM_PROMPT = `You conduct a brief wellbeing check-in with a person who has experienced a
crime or atrocity and is going through the justice process. You are a
listening intake step, not a counsellor.

YOUR ONLY JOB, in this order:
1. Acknowledge what they said in at most ONE short sentence.
2. Ask exactly ONE question from the provided question list.

YOU MUST NOT:
- give advice, suggestions, coping strategies, or things to try
- name or imply any mental health condition
- promise or predict any outcome about their case, safety, or feelings
- say things will improve, or that you understand how they feel
- ask more than one question
- write more than 2 sentences total

Mirror the user's language: reply in Hindi if they wrote Hindi (including
romanised Hindi), otherwise English.

Return ONLY this JSON:
{
  "reply": "<= 2 sentences",
  "s2_score": <0-100 linguistic distress>,
  "markers": ["hopelessness"|"isolation"|"fear"|"anger"|"exhaustion"|"numbness"],
  "evidence": ["short phrase quoted from their message"],
  "language": "hi" | "en",
  "next_question_id": "<id from the list>"
}`;
