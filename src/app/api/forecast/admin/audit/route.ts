/**
 * GET /api/forecast/admin/audit
 * Audit events for the Forecast Arena.
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
    const eventType = searchParams.get('eventType');
    const limit     = Math.min(Number(searchParams.get('limit')) || 100, 500);

    let query = `select=*&order=created_at.desc&limit=${limit}`;
    if (eventType) query += `&event_type=eq.${eventType}`;

    const events = await faSelect<any>('fa_audit_events', query);

    return NextResponse.json({ events });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
