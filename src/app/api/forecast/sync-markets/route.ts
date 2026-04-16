/**
 * POST /api/forecast/sync-markets
 *
 * Triggers Polymarket market sync. Protected by ADMIN_PASSWORD header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { syncMarketsToDb } from '@/lib/forecast/polymarket';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const password = request.headers.get('x-admin-password');
  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const limit = (body as any).limit ?? 50;

    const result = await syncMarketsToDb(limit);

    return NextResponse.json({
      ok: true,
      inserted: result.inserted,
      updated:  result.updated,
      errors:   result.errors.length,
      errorMessages: result.errors.slice(0, 10),
    });
  } catch (err: any) {
    console.error('[API/FORECAST/SYNC] Error:', err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
