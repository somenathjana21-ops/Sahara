// app/(staff-auth)/staff/login/LoginForm.tsx — TM3 owner
//
// The staff sign-in form. It posts to `/api/staff/auth` — the ONE auth route
// (TM1 owner) — which is the whole point of this file existing: the previous
// `app/api/staff/auth/login/route.ts` set a `staff_auth` cookie that nothing
// read, while the layout and `authoriseStaff` both require `staff_session`.
// Signing in therefore succeeded and then bounced straight back to the form
// (CHECKS_TM3 T3-E3).
//
// `action` is a real URL and `method` is POST, so this still works with
// JavaScript off: `/api/staff/auth` accepts form encoding as well as JSON, and
// the browser gets its cookie either way. The onSubmit handler is progressive
// enhancement on top — it posts the same body to the same URL and then lands
// the counsellor on /staff instead of on the route's `{"ok":true}` JSON.
//
// Tokens only, no hex (CHECKS_TM2 T2-C2).

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

/** The one auth route. Do not point this anywhere else. */
const AUTH_ROUTE = "/api/staff/auth";

export function LoginForm() {
  const router = useRouter();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const res = await fetch(AUTH_ROUTE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });

      if (res.ok) {
        // The cookie is set by the response; refresh so the server layout
        // re-reads it, then go to the queue.
        router.replace("/staff");
        router.refresh();
        return;
      }

      // The route says nothing about the expected value and neither do we.
      const body = await res.json().catch(() => null);
      setError(body?.message ?? "That passcode is not correct.");
    } catch {
      setError("Could not reach the server. Check the connection and retry.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      action={AUTH_ROUTE}
      method="POST"
      onSubmit={onSubmit}
      className="mx-auto mt-24 max-w-sm space-y-4 px-4"
    >
      <h1 className="font-display text-2xl">Staff sign-in</h1>
      <p className="text-sm text-ink-soft">
        One passcode, shared by the counselling team. Every read you make is
        recorded in the audit log.
      </p>

      <label className="block space-y-1">
        <span className="text-sm font-semibold">Passcode</span>
        <input
          type="password"
          name="passcode"
          required
          autoComplete="current-password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          className="min-h-[48px] w-full rounded-lg border border-line bg-surface px-3 text-sm"
        />
      </label>

      {error !== null && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
