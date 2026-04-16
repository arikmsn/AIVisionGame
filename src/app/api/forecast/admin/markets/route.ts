/**
 * GET /api/forecast/admin/markets
 * Paginated markets list with filters.
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
    const status = searchParams.get('status');
    const limit  = Math.min(Number(searchParams.get('limit')) || 50, 200);
    const offset = Number(searchParams.get('offset')) || 0;
    const search = searchParams.get('q');

    let query = `select=*&order=volume_usd.desc.nullslast&limit=${limit}&offset=${offset}`;
    if (status) query += `&status=eq.${status}`;
    if (search) query += `&title=ilike.*${encodeURIComponent(search)}*`;

    const markets = await faSelect<any>('fa_markets', query);

    return NextResponse.json({ markets, count: markets.length });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
