/**
 * POST /api/staff/auth — the staff sign-in.
 *
 * Owner: TM1. Implements docs/TM3_GUIDE.md section 3 ("Access") and section 4
 * Prompt 2, which builds the form that posts here: one passcode from
 * `STAFF_PASSCODE`, compared server-side, set as an httpOnly cookie. No
 * accounts, no email, no Supabase Auth (CLAUDE.md, scope discipline).
 *
 * ## What this endpoint is, and is not
 *
 * It is the only place that turns a submitted passcode into a session. It is
 * NOT the gate: every other handler under app/api/staff/ calls
 * `authoriseStaff` on its own and refuses independently, because gating the
 * sign-in and trusting the page after it is how an API ends up open
 * (CHECKS_TM3.md T3-A7).
 *
 * The comparison is `verifyPasscode` from lib/staff/auth.ts — the same
 * timing-safe SHA-256 comparison the gate uses, not a second copy and never
 * `===` (CHECKS_TM3.md T3-A5). The passcode is read from the environment
 * inside that function and is never sent back to the browser in any form: the
 * failure body says only that the passcode was wrong, and never how wrong.
 *
 * ## The cookie
 *
 * `httpOnly: true` so no script can read it, `sameSite: 'lax'` so it does not
 * ride along on a cross-site POST (CHECKS_TM3.md T3-A6), `secure` outside
 * development so it never travels in clear text on the deployed URL, and
 * `path: /` because both the staff pages and the staff API need it.
 *
 * Its value is the passcode itself. That is the boring option and it is
 * deliberate: the passcode IS the only credential, there are no accounts to
 * key a session table by, and a signed token would need a second secret to
 * verify against with nothing extra to show for it. The cost is that the
 * cookie is as good as the passcode — which is already true of the passcode.
 */

import { z } from "zod";

import {
  STAFF_ACTOR_COOKIE,
  STAFF_COOKIE,
  isStaffHandle,
  logPasscodeUnset,
  verifyPasscode,
} from "@/lib/staff/auth";

export const runtime = "nodejs";
/** A sign-in that Next cached would be a sign-in that leaks. */
export const dynamic = "force-dynamic";

/**
 * One working day. Long enough that a counsellor is not signing in between
 * triage passes, short enough that a shared machine does not stay signed in
 * overnight.
 */
const SESSION_SECONDS = 12 * 60 * 60;

const AuthRequestSchema = z.object({
  passcode: z.string().min(1),
  /**
   * Optional staff handle. It ends up in `audit_events.actor` and
   * `alerts.acked_by`, so it is a HANDLE and never a name (CLAUDE.md rule 6) —
   * anything that is not one is dropped rather than rejected, and the audit
   * trail falls back to the default actor. Signing in is not the moment to
   * argue with someone about their username.
   */
  actor: z.string().optional(),
});

/**
 * Accepts JSON and form encoding.
 *
 * TM3_GUIDE.md section 4 describes "a form posting to /api/staff/auth". A
 * plain HTML form sends `application/x-www-form-urlencoded` and a React client
 * sends JSON, and which one lands here should not be a thing anybody has to
 * debug at 1am on Day 5.
 */
async function readBody(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";

  if (type.includes("application/json")) {
    try {
      return await request.json();
    } catch {
      return null;
    }
  }

  try {
    return Object.fromEntries(await request.formData());
  } catch {
    return null;
  }
}

function cookie(name: string, value: string, secure: boolean): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_SECONDS}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export async function POST(request: Request): Promise<Response> {
  const parsed = AuthRequestSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_request", message: "A passcode is required." },
      { status: 400 },
    );
  }

  const result = verifyPasscode(parsed.data.passcode);

  if (result === "unconfigured") {
    /*
     * Fail closed, exactly as the gate does. A deployment with no passcode set
     * must not be a deployment anyone can sign in to — and 503 rather than 401
     * so whoever is trying knows to go and set the variable instead of hunting
     * for the right passcode.
     */
    logPasscodeUnset();
    return Response.json(
      {
        error: "staff_auth_unavailable",
        message: "Staff access is not configured on this deployment.",
      },
      { status: 503 },
    );
  }

  if (result !== "ok") {
    // Deliberately identical to the gate's refusal, and it says nothing about
    // the expected value, its length, or how close the attempt was.
    return Response.json(
      { error: "unauthorised", message: "That passcode is not correct." },
      { status: 401 },
    );
  }

  // Secure everywhere except local development, where the dev server is http
  // and a Secure cookie would simply never be stored.
  const secure = process.env.NODE_ENV === "production";

  const headers = new Headers({ "content-type": "application/json" });
  headers.append("set-cookie", cookie(STAFF_COOKIE, parsed.data.passcode, secure));

  const actor = parsed.data.actor;
  if (actor !== undefined && isStaffHandle(actor)) {
    // Read back by `authoriseStaff`, so this counsellor's own handle appears
    // on every audit row they generate instead of the shared default.
    headers.append("set-cookie", cookie(STAFF_ACTOR_COOKIE, actor, secure));
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
