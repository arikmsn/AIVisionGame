/**
 * POST /api/forecast/admin/backfill-domains
 *
 * One-shot admin utility: walks every fa_markets row with NULL domain
 * and sets it via classifyMarketDomain(). Safe to re-run.
 *
 * Body: { batch?: number }   — rows per batch (default 200)
 * Header: x-admin-password
 */

import { NextRequest, NextResponse } from 'next/server';
import { faSelect, faPatch } from '@/lib/forecast/db';
import { classifyMarketDomain } from '@/lib/forecast/domains';

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  if (request.headers.get('x-admin-password') !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body   = await request.json().catch(() => ({}));
    const batch  = Number((body as { batch?: number }).batch ?? 200);

    // Pull rows missing a domain. PostgREST: domain=is.null
    const rows = await faSelect<{ id: string; title: string; category: string | null }>(
      'fa_markets',
      `domain=is.null&select=id,title,category&limit=${batch}`,
    );

    let updated = 0;
    const byDomain: Record<string, number> = {};
    for (const r of rows) {
      const domain = classifyMarketDomain(r.title, r.category);
      const ok = await faPatch('fa_markets', { id: r.id }, { domain });
      if (ok) {
        updated++;
        byDomain[domain] = (byDomain[domain] ?? 0) + 1;
      }
    }

    return NextResponse.json({
      ok: true,
      scanned:   rows.length,
      updated,
      byDomain,
      remaining: rows.length === batch ? 'more — rerun' : 'done',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
