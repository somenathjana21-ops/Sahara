/**
 * lib/safety/stub-guard.ts — the fail-closed gate on the unimplemented routes.
 *
 * Owner: TM1. Implements docs/SAFETY_SPEC.md section 2 by refusing to serve
 * anything at all until the interlock described there actually exists.
 *
 * The stub routes return a fixed GREEN. That is harmless on localhost and
 * indefensible on a public URL: a real person typing a crisis utterance into a
 * deployed Preview or Production build would be told, in effect, that they are
 * fine. This module makes the absence of the safety layer a 503 instead.
 *
 * This is NOT crisis detection and must never become it. It does not read the
 * request, does not match a lexicon, and does not choose a tier — it refuses
 * every request identically. Crisis detection is deterministic code in
 * lib/safety/lexicon.ts and nowhere else (CLAUDE.md rule 1).
 *
 * Deleted in the same PR that lands the real pipeline.
 */

/**
 * Fixtures are served only when this is explicitly opted into. Unset — which is
 * what Production is — every guarded route fails closed. The default must stay
 * "refuse": a missing or misspelled env var has to land on the safe side.
 */
export const STUB_MODE = process.env.STUB_MODE === "1";

/**
 * Hardcoded here ON PURPOSE and duplicated from lib/safety/replies.ts when that
 * lands. This array must survive the entire safety layer being absent — it is
 * the one thing this file guarantees reaches a person, so it may not import
 * from a module that does not yet exist, and must not be refactored into one
 * "for consistency" later.
 */
export const STATIC_CRISIS_RESOURCES = [
  { label: "National Helpline Against Atrocities", phone: "14566" },
  { label: "Tele-MANAS mental health helpline", phone: "14416" },
];

/**
 * The only response a guarded route may produce with STUB_MODE unset.
 *
 * 503, not 200: an unimplemented pipeline is an unavailable service, and no
 * caller should be able to read a tier out of it. The body carries no tier, no
 * reply, and no assessment — only the helpline numbers.
 */
export function stubUnavailable() {
  return Response.json(
    {
      error: "pipeline_not_implemented",
      message:
        "This service is not yet available. If you need help now, please call one of the numbers below.",
      resources: STATIC_CRISIS_RESOURCES,
    },
    { status: 503 },
  );
}
