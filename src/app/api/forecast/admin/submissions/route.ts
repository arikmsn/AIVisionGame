/**
 * GET /api/forecast/admin/submissions
 * Submissions with full detail.
 */

import { NextRequest, NextResponse } from 'next/server';
import { faSelect } from '@/lib/forecast/db';

export async function GET(request: NextRequest) {
  const password = request.headers.get('x-admin-password');
  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const roundId = searchParams.get('roundId');
    const agentId = searchParams.get('agentId');
    const limit   = Math.min(Number(searchParams.get('limit')) || 50, 200);

    let query = `select=*&order=submitted_at.desc&limit=${limit}`;
    if (roundId) query += `&round_id=eq.${roundId}`;
    if (agentId) query += `&agent_id=eq.${agentId}`;

    const submissions = await faSelect<any>('fa_submissions', query);

    return NextResponse.json({ submissions });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
