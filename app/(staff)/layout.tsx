// app/(staff)/layout.tsx — Staff-side layout with auth gate
//
// The gate reads `staff_session` — the cookie `lib/staff/auth.ts` issues and
// `authoriseStaff` checks — so the page and the API agree on what "signed in"
// means. They previously did not: the deleted `/api/staff/auth/login` route set
// a `staff_auth` cookie nobody read, so a successful sign-in bounced straight
// back to the form (CHECKS_TM3 T3-E3).
//
// Unauthenticated requests still REDIRECT rather than rendering a form here,
// because CHECKS_TM3 T3-A7 requires /staff to redirect or 401 without a cookie.
// The target is /staff/login, which sits in the (staff-auth) group and so is
// not wrapped by this layout.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';

import { STAFF_ACTOR_COOKIE, STAFF_COOKIE } from '@/lib/staff/auth';

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Check for auth cookie
  const cookieStore = await cookies();
  const authCookie = cookieStore.get(STAFF_COOKIE);

  if (!authCookie) {
    redirect('/staff/login');
  }

  /*
   * Sign-out is a server action rather than a route handler. The session
   * cookie is httpOnly, so the browser cannot clear it on its own, and adding
   * a second auth route is what produced the split-brain this change removes.
   */
  async function signOut() {
    'use server';
    const jar = await cookies();
    jar.delete(STAFF_COOKIE);
    jar.delete(STAFF_ACTOR_COOKIE);
    redirect('/staff/login');
  }

  return (
    <>
      <header className="border-b border-line bg-surface px-6 py-4">
        <div className="flex items-center justify-between">
          <Link href="/staff" className="font-display text-xl">
            Staff Dashboard
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              className="text-sm text-ink-soft hover:text-ink transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="p-6">{children}</main>
    </>
  );
}
