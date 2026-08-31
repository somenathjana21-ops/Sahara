/**
 * GET /api/staff/person/[id] — the detail view behind the trend chart.
 *
 * Owner: TM1. Implements docs/TM1_GUIDE.md section 7 (Prompt 9).
 *
 * Returns `PersonDetail`: the person, their case, every assessment OLDEST
 * FIRST, and their alerts. The assessment list is the trend line TM3 draws.
 *
 * ## It reads history; it never recomputes it
 *
 * Each assessment carries the components that were true when it was written.
 * S3 in particular is a SNAPSHOT: recomputing it from today's `cases` row
 * would redraw the past against a case file that has since moved, and the
 * trend chart would lie about the very thing it exists to show — A-4471's S3
 * reads 50 on the first two points and 90 on the third, and today's row says
 * 90 for all three (SCORING_AND_POLICY.md section 5, CHECKS_TM1.md T1-C12).
 * There is no scoring code in this file, and there must not be.
 *
 * ## Gated, and audited
 *
 * Passcode first (CHECKS_TM3.md T3-A7). One `audit_events` row per read, with
 * the person as the subject, written after the read and before the response —
 * see the note in ../../queue/route.ts.
 */

import { getDb } from "@/lib/db";
import { authoriseStaff } from "@/lib/staff/auth";
import { UuidSchema } from "@/types/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = authoriseStaff(request);
  if (session instanceof Response) return session;

  const { id } = await context.params;
  const parsedId = UuidSchema.safeParse(id);
  if (!parsedId.success) {
    return Response.json(
      { error: "invalid_person_id", message: "The person id is not a UUID." },
      { status: 400 },
    );
  }

  const db = getDb();
  const detail = await db.loadPersonDetail(parsedId.data);
  if (detail === null) {
    return Response.json({ error: "person_not_found" }, { status: 404 });
  }

  await db.writeAudit({
    actor: session.actor,
    role: session.role,
    action: "view_person",
    subject_id: parsedId.data,
  });

  return Response.json(detail, { status: 200 });
}
