// app/(staff-auth)/staff/login/page.tsx — TM3 owner
//
// /staff/login lives in its own route group so it is NOT wrapped by
// app/(staff)/layout.tsx. That layout redirects anyone without a
// `staff_session` cookie here; if this page sat inside it, the redirect would
// land on a page that redirects, which is the loop CHECKS_TM3 T3-E3 caught.
//
// The group name is stripped from the URL, so this is /staff/login and
// app/(staff)/staff/page.tsx is still /staff.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { STAFF_COOKIE } from "@/lib/staff/auth";

import { LoginForm } from "./LoginForm";

/** Reads a cookie, so it must never be prerendered. */
export const dynamic = "force-dynamic";

export default async function StaffLoginPage() {
  const jar = await cookies();

  // Already signed in — nothing to ask for.
  if (jar.get(STAFF_COOKIE)) redirect("/staff");

  return <LoginForm />;
}
