/**
 * GET /api/forecast/admin/rounds
 * Rounds list with submission counts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { sfetch } from '@/lib/forecast/db';

export async function GET(request: NextRequest) {
  const password = request.headers.get('x-admin-password');
  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const limit  = Math.min(Number(searchParams.get('limit')) || 50, 200);

    let query = 'select=*&order=opened_at.desc';
    if (status) query += `&round_status=eq.${status}`;
    query += `&limit=${limit}`;

    const rounds = await sfetch(`fa_v_round_summary?${query}`);

    return NextResponse.json({ rounds: Array.isArray(rounds) ? rounds : [] });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
