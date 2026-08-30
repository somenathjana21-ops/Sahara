/**
 * POST /api/checkin — STUB, GUARDED, FAILS CLOSED.
 *
 * Owner: TM1 (TM1_GUIDE.md section 3, Prompt 3).
 * Validates the request against types/contract.ts and returns fixed data.
 * There is no database and no LLM in this file, by design.
 *
 * THE GUARD: the first statement in the handler is
 *   `if (!STUB_MODE) return stubUnavailable()`
 * and nothing may be added above it. This stub always returns GREEN and does no
 * crisis detection whatsoever, so on a public URL it would answer "I want to
 * kill myself" with a question about sleep. STUB_MODE=1 is set in local dev and
 * Vercel Preview only; Production leaves it unset and therefore gets a 503
 * carrying real helpline numbers. Fixtures are for building the UI against, and
 * that is the only place they are reachable.
 *
 * The guard is NOT crisis detection and must not grow into it. It refuses every
 * request identically without reading the body — putting a crisis path in a
 * route handler instead of lib/safety/lexicon.ts is the exact failure mode
 * CLAUDE.md rule 1 exists to prevent. TM2: mock a CRITICAL response in your own
 * test rather than asking this route to fake one.
 *
 * WHAT IS DELIBERATELY MISSING, AND MUST LAND BEFORE THIS SHIPS:
 *   - the consent gate (acceptance test S6: no live consent row => 403)
 *   - the pass-1 safety interlock, before any model call (SAFETY_SPEC.md 2)
 *   - the LLM call (lib/llm)
 *   - the pass-2 interlock on the model's reply (SAFETY_SPEC.md 2)
 *   - scoring, the policy engine, and the checkin/assessment/alert writes
 *
 * The guard, the STUB_MODE variable in .env.example, and lib/safety/stub-guard.ts
 * are all deleted in the same PR that lands the interlock above. Check T1-B0 in
 * docs/CHECKS_TM1.md flips at that moment: until then a 200 from Production is a
 * blocker, after it a 503 is.
 */

import { NextResponse } from "next/server";

import { STUB_MODE, stubUnavailable } from "@/lib/safety/stub-guard";
import {
  type CheckInResponse,
  CheckInRequestSchema,
  CheckInResponseSchema,
} from "@/types/contract";

/**
 * Placeholder text only. Once lib/ exists, every reply is either the model's
 * (after pass 2) or a fixed string from lib/safety/replies.ts. The LLM never
 * writes safety-critical text (CLAUDE.md rule 3).
 */
const STUB_RESPONSE: CheckInResponse = CheckInResponseSchema.parse({
  reply: "Thank you for checking in. How much has this been affecting your sleep and eating?",
  tier: "GREEN",
  assessmentId: "55555555-5555-5555-5555-000000000003",
  nextQuestionId: "q2",
});

export async function POST(request: Request) {
  // Fails closed before anything else, including body parsing. Nothing goes
  // above this line.
  if (!STUB_MODE) return stubUnavailable();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const parsed = CheckInRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // parsed.data is a valid CheckInRequest and is intentionally ignored here.
  return NextResponse.json(STUB_RESPONSE, { status: 200 });
}
