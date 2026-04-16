/**
 * GET /api/forecast/admin/leaderboard
 * Leaderboard data from the fa_v_leaderboard view.
 */

import { NextRequest, NextResponse } from 'next/server';
import { sfetch } from '@/lib/forecast/db';

export async function GET(request: NextRequest) {
  const password = request.headers.get('x-admin-password');
  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await sfetch('fa_v_leaderboard?order=avg_brier.asc.nullslast');
    return NextResponse.json({ leaderboard: Array.isArray(data) ? data : [] });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
