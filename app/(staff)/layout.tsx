// app/(staff)/layout.tsx — Staff-side layout with auth gate

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Check for auth cookie
  const cookieStore = await cookies();
  const authCookie = cookieStore.get('staff_session');

  if (!authCookie) {
    redirect('/api/staff/auth/login');
  }

  return (
    <>
      <header className="border-b border-line bg-surface px-6 py-4">
        <div className="flex items-center justify-between">
          <Link href="/staff" className="font-display text-xl">
            Staff Dashboard
          </Link>
          <form action="/api/staff/auth/logout" method="POST">
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
