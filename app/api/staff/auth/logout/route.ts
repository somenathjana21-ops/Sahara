// app/api/staff/auth/logout/route.ts

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(request: Request) {
  const cookieStore = await cookies();
  cookieStore.delete('staff_auth');

  return NextResponse.redirect(new URL('/api/staff/auth/login', request.url));
}
