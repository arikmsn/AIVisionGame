/**
 * Next.js Middleware — Phase 3
 *
 * Protects /admin/* routes with HTTP Basic Auth using ADMIN_PASSWORD env var.
 * Username is ignored — any user with the correct password is admitted.
 *
 * In local dev without ADMIN_PASSWORD set, the route is open (no auth required).
 */

import { NextRequest, NextResponse } from 'next/server';

export const config = {
  matcher: ['/admin/:path*'],
};

export function middleware(req: NextRequest): NextResponse {
  const password = process.env.ADMIN_PASSWORD;

  // No password configured → open access (local dev)
  if (!password) return NextResponse.next();

  const authHeader = req.headers.get('authorization');

  if (authHeader?.startsWith('Basic ')) {
    const encoded = authHeader.slice('Basic '.length);
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    // decoded = "username:password" — we only check the password part
    const colonIdx = decoded.indexOf(':');
    const provided = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : decoded;
    if (provided === password) return NextResponse.next();
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Arena Admin"',
      'Content-Type':     'text/plain',
    },
  });
}
