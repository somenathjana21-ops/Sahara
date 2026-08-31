// app/api/staff/auth/login/route.ts — Simple passcode auth

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET() {
  // Show simple login page
  return new NextResponse(
    `<!DOCTYPE html>
<html>
<head>
  <title>Staff Login</title>
  <style>
    body { font-family: system-ui; max-width: 400px; margin: 100px auto; padding: 20px; }
    input { width: 100%; padding: 12px; margin: 10px 0; font-size: 16px; border: 1px solid #ddd; border-radius: 8px; }
    button { width: 100%; padding: 12px; background: #141414; color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; }
    button:hover { background: #333; }
  </style>
</head>
<body>
  <h1>Staff Login</h1>
  <form method="POST">
    <input type="password" name="passcode" placeholder="Enter passcode" required />
    <button type="submit">Sign In</button>
  </form>
</body>
</html>`,
    {
      headers: { 'Content-Type': 'text/html' },
    }
  );
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const passcode = formData.get('passcode');

  // Check against STAFF_PASSCODE from env
  if (passcode === process.env.STAFF_PASSCODE) {
    const cookieStore = await cookies();
    cookieStore.set('staff_auth', 'authenticated', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 8, // 8 hours
    });

    return NextResponse.redirect(new URL('/staff', request.url));
  }

  return new NextResponse('Invalid passcode', { status: 401 });
}
