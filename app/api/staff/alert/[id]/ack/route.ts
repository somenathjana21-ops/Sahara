/**
 * POST /api/staff/alert/[id]/ack — a human closes the loop.
 *
 * Owner: TM1. Implements docs/TM1_GUIDE.md section 7 (Prompt 9): sets
 * `acked_at`, `acked_by` and `disposition`, writes audit, and enforces the one
 * rule this endpoint exists for —
 *
 *   **A CRITICAL alert can only be closed by an explicit human disposition.**
 *
 * Not by a timeout, not by a default, not by a client that posted an empty
 * body. `contacted`, `no_action_needed` or `escalated` — someone has to say
 * which, and their handle goes in `acked_by`. `pending` is explicitly refused
 * on a CRITICAL: it is the state an alert is already in, so accepting it would
 * be a way of closing one without saying anything, which is exactly what
 * CLAUDE.md rule 4 means by "only a human closes a Critical".
 *
 * Lower tiers may be acknowledged without a disposition and default to
 * `pending` — a counsellor sweeping an AMBER off the queue has seen it, and
 * making that a two-step interaction is how a 30-second triage path becomes a
 * three-minute one (TM3_GUIDE.md section 3).
 *
 * Double-ack loses safely. The update is conditional on `acked_at` still being
 * null (lib/db/supabase.ts), so a second counsellor gets a 409 naming who got
 * there first rather than silently overwriting their disposition.
 */

import { z } from "zod";

import { getDb } from "@/lib/db";
import { AlertAlreadyAckedError } from "@/lib/db/supabase";
import { authoriseStaff, isStaffHandle } from "@/lib/staff/auth";
import { DispositionSchema, UuidSchema, type Disposition } from "@/types/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The request body. camelCase, like every other API payload
 * (types/contract.ts). Both fields are optional: `ackedBy` falls back to the
 * handle on the staff session, and `disposition` is required only on a
 * CRITICAL — which is checked below, against the alert, not against the body.
 */
const AckRequestSchema = z
  .object({
    disposition: DispositionSchema.optional(),
    /** A staff handle, never a real name (CLAUDE.md rule 6). */
    ackedBy: z.string().optional(),
  })
  .strict();

/** The dispositions that actually close something. `pending` is not one. */
function closesTheAlert(disposition: Disposition | undefined): boolean {
  return disposition !== undefined && disposition !== "pending";
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = authoriseStaff(request);
  if (session instanceof Response) return session;

  const { id } = await context.params;
  const parsedId = UuidSchema.safeParse(id);
  if (!parsedId.success) {
    return Response.json(
      { error: "invalid_alert_id", message: "The alert id is not a UUID." },
      { status: 400 },
    );
  }

  // An empty body is legal on a lower-tier ack, so a missing or unparseable
  // body becomes {} and falls through to the same validation as any other.
  let raw: unknown = {};
  try {
    raw = await request.json();
  } catch {
    raw = {};
  }

  const parsedBody = AckRequestSchema.safeParse(raw);
  if (!parsedBody.success) {
    return Response.json(
      { error: "invalid_request", issues: parsedBody.error.issues },
      { status: 400 },
    );
  }

  const ackedBy = parsedBody.data.ackedBy ?? session.actor;
  if (!isStaffHandle(ackedBy)) {
    return Response.json(
      {
        error: "invalid_acked_by",
        message:
          "acked_by is a staff handle: letters, digits, dot, dash or underscore, up to 32 characters. It must not be a person's name.",
      },
      { status: 400 },
    );
  }

  const db = getDb();
  const alert = await db.loadAlert(parsedId.data);
  if (alert === null) {
    return Response.json({ error: "alert_not_found" }, { status: 404 });
  }

  if (alert.acked_at !== null) {
    return Response.json(
      {
        error: "already_acknowledged",
        message: `This alert was acknowledged by ${alert.acked_by ?? "another counsellor"}.`,
        alert,
      },
      { status: 409 },
    );
  }

  /* The rule this endpoint exists for. */
  if (alert.tier === "CRITICAL" && !closesTheAlert(parsedBody.data.disposition)) {
    return Response.json(
      {
        error: "disposition_required",
        message:
          "A CRITICAL alert can only be closed by an explicit human disposition: contacted, no_action_needed, or escalated.",
      },
      { status: 400 },
    );
  }

  const disposition: Disposition = parsedBody.data.disposition ?? "pending";

  let acked;
  try {
    acked = await db.ackAlert(parsedId.data, { acked_by: ackedBy, disposition });
  } catch (error) {
    if (error instanceof AlertAlreadyAckedError) {
      // Lost the race between the read above and the update. Same answer.
      return Response.json(
        { error: "already_acknowledged", message: "This alert was acknowledged concurrently." },
        { status: 409 },
      );
    }
    throw error;
  }

  /*
   * Two rows when a disposition closed the alert, because acknowledging and
   * dispositioning are two different claims about what a human did, and
   * `audit_events.action` has a value for each. `subject_id` is the PERSON on
   * both, so every audit row answers the same question — whose data was
   * touched — regardless of action.
   */
  await db.writeAudit({
    actor: ackedBy,
    role: session.role,
    action: "ack_alert",
    subject_id: acked.person_id,
  });
  if (closesTheAlert(parsedBody.data.disposition)) {
    await db.writeAudit({
      actor: ackedBy,
      role: session.role,
      action: "dispose",
      subject_id: acked.person_id,
    });
  }

  return Response.json(acked, { status: 200 });
}
