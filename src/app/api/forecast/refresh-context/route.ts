/**
 * POST /api/forecast/refresh-context
 * Refreshes news context for selected (or all) markets.
 * Body: { marketId?: string } — if omitted, refreshes all is_selected markets.
 */
import { NextRequest, NextResponse } from 'next/server';
import { faSelect } from '@/lib/forecast/db';
import { getOrRefreshContext } from '@/lib/forecast/news-context';
import { detectDomain } from '@/lib/forecast/market-scorer';

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const password = request.headers.get('x-admin-password');
  if (password !== process.env.ADMIN_PASSWORD) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));
    const { marketId, force = false } = body as { marketId?: string; force?: boolean };

    let markets: Array<{ id: string; title: string; category: string | null }> = [];

    if (marketId) {
      markets = await faSelect('fa_markets', `id=eq.${marketId}&select=id,title,category&limit=1`);
    } else {
      // Refresh all selected markets
      const scores = await faSelect<{ market_id: string }>('fa_market_scores', 'is_selected=eq.true&select=market_id');
      if (scores.length === 0) {
        markets = await faSelect('fa_markets', 'status=eq.active&select=id,title,category&order=volume_usd.desc&limit=10');
      } else {
        const ids = scores.map(s => s.market_id).join(',');
        markets = await faSelect('fa_markets', `id=in.(${ids})&select=id,title,category`);
      }
    }

    const results = [];
    for (const m of markets) {
      const domain = detectDomain(m.title, m.category);
      const ctx = await getOrRefreshContext(m.id, m.title, domain, force).catch((e: Error) => ({ error: e.message }));
      results.push({ marketId: m.id, title: m.title.slice(0, 60), ...ctx });
    }

    return NextResponse.json({ ok: true, refreshed: results.length, results });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
