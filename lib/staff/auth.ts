/**
 * lib/staff/auth.ts — the staff gate, and who the audit row says did it.
 *
 * Owner: TM1. Implements docs/TM3_GUIDE.md section 3 ("Access") for the API
 * side: one passcode from `STAFF_PASSCODE`, compared server-side, carried in
 * an httpOnly cookie. No accounts, no email, no Supabase Auth — five days
 * (CLAUDE.md, scope discipline).
 *
 * CHECKS_TM3.md T3-A7 is explicit that gating the PAGE is not enough and that
 * leaving the API open while hiding the UI is the standard mistake. So every
 * handler under app/api/staff/ starts with `authoriseStaff` and returns its
 * refusal unchanged.
 *
 * ## Fail closed
 *
 * An unset `STAFF_PASSCODE` is a 503, never an open door. The whole staff API
 * reads person-level triage data, and a deployment that forgot the variable
 * must not become a deployment that serves it to anyone who finds the URL.
 *
 * ## Handles, not names
 *
 * `audit_events.actor` and `alerts.acked_by` are staff HANDLES (types/contract.ts:
 * "staff handle, not a real name"). The pattern below refuses anything with a
 * space in it, which is the cheapest available barrier to someone typing a
 * real name into a column that must not hold one (CLAUDE.md rule 6). It cannot
 * stop a determined caller typing a one-word name, and it is not pretending
 * to — it stops the accident.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import { StaffRoleSchema, type StaffRole } from "@/types/contract";

/**
 * The session cookie. Set by the sign-in route with `httpOnly: true` and
 * `sameSite: 'lax'` (CHECKS_TM3.md T3-A6); its value is the passcode itself,
 * which is the boring option when the passcode IS the only credential and
 * there are no accounts to key a session table by.
 */
export const STAFF_COOKIE = "staff_session";

/** Optional. Lets a counsellor's own handle reach the audit trail. */
export const STAFF_ACTOR_COOKIE = "staff_actor";
export const STAFF_ROLE_COOKIE = "staff_role";

/** Used when nobody supplied a handle. A real value beats an empty audit row. */
export const DEFAULT_ACTOR = "staff";
export const DEFAULT_ROLE: StaffRole = "counsellor";

/** Handles only: letters, digits, dot, dash, underscore. No spaces, so no names. */
const HANDLE = /^[A-Za-z0-9._-]{1,32}$/;

export interface StaffSession {
  actor: string;
  role: StaffRole;
}

/** Parse a Cookie header. Returns an empty map when there is none. */
function cookies(request: Request): Map<string, string> {
  const out = new Map<string, string>();
  const header = request.headers.get("cookie");
  if (header === null) return out;

  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key !== "") out.set(key, decodeURIComponent(value));
  }
  return out;
}

/**
 * Constant-time comparison over SHA-256 digests.
 *
 * Hashing first is not about storage — it is so both buffers are 32 bytes and
 * `timingSafeEqual` can run at all, since it throws on a length mismatch and a
 * length check on its own leaks the passcode's length.
 */
function sameSecret(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(a, "utf8").digest(),
    createHash("sha256").update(b, "utf8").digest(),
  );
}

function refuse(status: number, error: string, message: string): Response {
  return Response.json({ error, message }, { status });
}

/**
 * The one comparison against STAFF_PASSCODE in the codebase.
 *
 * Both the gate below and the sign-in route at app/api/staff/auth/route.ts go
 * through here, so there is a single place where the passcode is read and a
 * single place where it is compared. Two implementations of "is this the
 * passcode" is how one of them ends up using `===` (CHECKS_TM3.md T3-A5).
 *
 * `unconfigured` is a distinct result rather than a bare false: the caller has
 * to decide between 401 and 503, and collapsing them would answer "wrong
 * passcode" to a deployment that has no passcode at all.
 */
export type PasscodeResult = "ok" | "mismatch" | "unconfigured";

export function verifyPasscode(presented: string): PasscodeResult {
  const passcode = process.env.STAFF_PASSCODE;
  if (!passcode) return "unconfigured";
  return sameSecret(presented, passcode) ? "ok" : "mismatch";
}

/** One line, so an unconfigured deployment says so in the log every time. */
export function logPasscodeUnset(): void {
  console.error(
    JSON.stringify({
      event: "staff_passcode_unset",
      message: "STAFF_PASSCODE is not set; refusing every staff request.",
    }),
  );
}

/**
 * Authorise a staff request.
 *
 * Returns the session on success, or the Response to return unchanged. The
 * body never says whether the passcode was absent or wrong, and never echoes
 * any part of it back.
 */
export function authoriseStaff(request: Request): StaffSession | Response {
  const jar = cookies(request);
  const presented = jar.get(STAFF_COOKIE);
  const result = verifyPasscode(presented ?? "");

  if (result === "unconfigured") {
    logPasscodeUnset();
    return refuse(
      503,
      "staff_auth_unavailable",
      "Staff access is not configured on this deployment.",
    );
  }

  if (presented === undefined || result !== "ok") {
    return refuse(401, "unauthorised", "A valid staff session is required.");
  }

  return { actor: readHandle(request, jar), role: readRole(request, jar) };
}

function readHandle(request: Request, jar: Map<string, string>): string {
  const raw = request.headers.get("x-staff-actor") ?? jar.get(STAFF_ACTOR_COOKIE) ?? "";
  return HANDLE.test(raw) ? raw : DEFAULT_ACTOR;
}

function readRole(request: Request, jar: Map<string, string>): StaffRole {
  const raw = request.headers.get("x-staff-role") ?? jar.get(STAFF_ROLE_COOKIE) ?? "";
  const parsed = StaffRoleSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_ROLE;
}

/** True when `value` is usable as `acked_by`. Exported for the ack route's validation. */
export function isStaffHandle(value: string): boolean {
  return HANDLE.test(value);
}
