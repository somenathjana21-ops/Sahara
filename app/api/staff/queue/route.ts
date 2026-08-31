/**
 * GET /api/staff/queue — the counsellor queue.
 *
 * Owner: TM1. Implements docs/TM1_GUIDE.md section 7 (Prompt 9): risk-sorted,
 * unacked first, and it writes an `audit_events` row for every read.
 *
 * ## What a row is
 *
 * One row per person, carrying that person's MOST RECENT assessment. This is a
 * triage queue, not an event log: a person whose composite moved three times
 * today appears once, at their current tier. The alert attached to that
 * assessment supplies the SLA and the ack state; a tier that raises no alert
 * (GREEN, AMBER) has nothing outstanding, so it reads as acked and takes its
 * SLA from `escalation` in policy/v1.yaml.
 *
 * ## Gated, and audited
 *
 * The passcode check is the first thing in the handler. Gating the page and
 * leaving the API open is the standard mistake, and hiding UI is not access
 * control (CHECKS_TM3.md T3-A7).
 *
 * The audit row is written AFTER the data is read and BEFORE it is returned.
 * That order is deliberate: an audit failure must take the response down with
 * it, because person-level data leaving the building unrecorded is the thing
 * the row exists to prevent (CLAUDE.md, "Every read of person-level data on the
 * staff side writes an audit_events row").
 */

import { getDb } from "@/lib/db";
import { escalationFor, loadPolicy, type Policy } from "@/lib/policy/engine";
import { authoriseStaff } from "@/lib/staff/auth";
import { QueueItemSchema, TierSchema, type QueueItem, type Tier } from "@/types/contract";

/** loadPolicy reads policy/v1.yaml from disk. */
export const runtime = "nodejs";
/** A triage queue that Next cached would be a triage queue that lies. */
export const dynamic = "force-dynamic";

/** Severity, for ordering only. Never for computing a tier. */
const TIER_ORDER: Record<Tier, number> = { GREEN: 0, AMBER: 1, RED: 2, CRITICAL: 3 };

export async function GET(request: Request): Promise<Response> {
  const session = authoriseStaff(request);
  if (session instanceof Response) return session;

  /* Optional ?tier= filter, validated against the contract enum so no parallel
     tier list exists anywhere in the codebase. */
  const rawTier = new URL(request.url).searchParams.get("tier");
  let tierFilter: Tier | undefined;
  if (rawTier !== null) {
    const parsedTier = TierSchema.safeParse(rawTier);
    if (!parsedTier.success) {
      return Response.json(
        { error: "invalid_query", issues: parsedTier.error.issues },
        { status: 400 },
      );
    }
    tierFilter = parsedTier.data;
  }

  let policy: Policy;
  try {
    policy = loadPolicy();
  } catch (error) {
    console.error(
      JSON.stringify({ event: "policy_unavailable", message: (error as Error).message }),
    );
    return Response.json(
      { error: "policy_unavailable", message: "The queue is not available on this deployment." },
      { status: 503 },
    );
  }

  const db = getDb();
  const rows = await db.loadQueueRows();

  const items: QueueItem[] = rows.map(({ person, assessment, alert }) =>
    QueueItemSchema.parse({
      personId: person.id,
      pseudonym: person.pseudonym,
      tier: assessment.tier,
      composite: assessment.composite,
      changePoint: assessment.change_point,
      createdAt: assessment.created_at,
      // No alert means nothing was raised for this tier, so there is nothing
      // outstanding to acknowledge. It is not "someone already handled it".
      acked: alert === null ? true : alert.acked_at !== null,
      // The alert's SLA is the one that was in force when it was raised; the
      // policy's is only a fallback for tiers that raise none.
      slaMinutes: alert?.sla_minutes ?? escalationFor(policy, assessment.tier).sla_minutes,
    } satisfies QueueItem),
  );

  /*
   * Unacked first, then most severe, then longest-waiting.
   *
   * The last key is ascending on purpose: within a tier, the row closest to
   * breaching its SLA belongs at the top. Newest-first would push a RED that
   * has been sitting for 25 minutes below one that arrived a moment ago.
   */
  items.sort(
    (a, b) =>
      Number(a.acked) - Number(b.acked) ||
      TIER_ORDER[b.tier] - TIER_ORDER[a.tier] ||
      Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );

  const filtered = tierFilter ? items.filter((item) => item.tier === tierFilter) : items;

  await db.writeAudit({
    actor: session.actor,
    role: session.role,
    action: "view_queue",
    // The queue is not about one person, so there is no subject. The rows it
    // returned are reconstructible from the timestamp.
    subject_id: null,
  });

  return Response.json(filtered, { status: 200 });
}
