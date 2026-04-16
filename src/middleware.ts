/**
 * Next.js Middleware — Phase 3
 *
 * Protects /admin/* routes with HTTP Basic Auth using ADMIN_PASSWORD env var.
 * Username is ignored — any user with the correct password is admitted.
 *
 * SECURITY: Fails CLOSED. If ADMIN_PASSWORD is not set, all /admin/* requests
 * are blocked with 503. This prevents accidental exposure when env var is missing.
 * Set ADMIN_PASSWORD in Vercel env vars (and locally in .env.local for dev).
 */

import { NextRequest, NextResponse } from 'next/server';

export const config = {
  matcher: ['/admin/:path*', '/forecast-arena/:path*'],
};

const DENY_401 = new NextResponse('Authentication required', {
  status: 401,
  headers: {
    'WWW-Authenticate': 'Basic realm="Arena Admin"',
    'Content-Type':     'text/plain',
  },
});

const DENY_503 = new NextResponse(
  'Admin access unavailable: ADMIN_PASSWORD env var is not configured.',
  { status: 503, headers: { 'Content-Type': 'text/plain' } },
);

export function middleware(req: NextRequest): NextResponse {
  const password = process.env.ADMIN_PASSWORD;

  // Fail CLOSED — if no password is configured, block all access.
  // Set ADMIN_PASSWORD in Vercel environment variables to enable admin access.
  if (!password) return DENY_503;

  const authHeader = req.headers.get('authorization');

  if (authHeader?.startsWith('Basic ')) {
    const encoded  = authHeader.slice('Basic '.length);
    const decoded  = Buffer.from(encoded, 'base64').toString('utf-8');
    // decoded = "username:password" — we only check the password part
    const colonIdx = decoded.indexOf(':');
    const provided = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : decoded;
    if (provided === password) return NextResponse.next();
  }

  return DENY_401;
}
