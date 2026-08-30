/**
 * GET /api/staff/queue — STUB, GUARDED, FAILS CLOSED.
 *
 * Owner: TM1 (TM1_GUIDE.md section 3, Prompt 3).
 * Returns the two fixture queue items so TM3 can build the dashboard tonight.
 *
 * THE GUARD: the first statement in the handler is
 *   `if (!STUB_MODE) return stubUnavailable()`
 * and nothing may be added above it. There is no passcode gate here yet, so
 * without the guard a deployed build would serve person-level queue rows —
 * pseudonymous, but still a triage queue — to anyone who found the URL, with no
 * audit trail. STUB_MODE=1 is set in local dev and Vercel Preview only;
 * Production leaves it unset and gets a 503.
 *
 * WHAT IS DELIBERATELY MISSING, AND MUST LAND BEFORE THIS SHIPS:
 *   - the STAFF_PASSCODE gate (read server-side only, never NEXT_PUBLIC_)
 *   - an audit_events row per read of person-level data (CLAUDE.md)
 *   - the real query, ordered by tier then age, unacked first
 *
 * The guard, the STUB_MODE variable in .env.example, and lib/safety/stub-guard.ts
 * are all deleted in the same PR that lands the real pipeline and the interlock.
 * See T1-B0 in docs/CHECKS_TM1.md.
 *
 * Optional ?tier= filter, validated with TierSchema from the contract so no
 * parallel tier list exists anywhere in the codebase.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { STUB_MODE, stubUnavailable } from "@/lib/safety/stub-guard";
import { greenQueueItem, redQueueItem } from "@/scripts/fixtures";
import { type QueueItem, QueueItemSchema, TierSchema } from "@/types/contract";

/** Fixtures are static; without this Next would prerender and serve a cached queue. */
export const dynamic = "force-dynamic";

/** RED first — this is a triage queue, not a chronological log. */
const STUB_QUEUE: QueueItem[] = z
  .array(QueueItemSchema)
  .parse([redQueueItem, greenQueueItem]);

export async function GET(request: Request) {
  // Fails closed before anything else, including reading the query string.
  // Nothing goes above this line.
  if (!STUB_MODE) return stubUnavailable();

  const rawTier = new URL(request.url).searchParams.get("tier");

  let tier: QueueItem["tier"] | undefined;
  if (rawTier !== null) {
    const parsed = TierSchema.safeParse(rawTier);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_query", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    tier = parsed.data;
  }

  const items = tier ? STUB_QUEUE.filter((item) => item.tier === tier) : STUB_QUEUE;

  return NextResponse.json(items, { status: 200 });
}
