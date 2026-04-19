/**
 * POST /api/forecast/admin/sync-targeted
 *
 * Fetches markets from the thesis-aligned Polymarket categories
 * (Politics, Crypto, Tech & AI, Business & Finance, News, Science) and
 * upserts them into fa_markets — counterbalancing the sports-heavy default
 * feed that comes from fetching by volume rank.
 *
 * Protected by x-admin-password.
 * Body: { limitPerCategory?: number }  (default 30)
 */

import { NextRequest, NextResponse }                  from 'next/server';
import { fetchTargetedMarkets, syncMarketsFromList }  from '@/lib/forecast/polymarket';

export const maxDuration = 60;
export const dynamic    = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (request.headers.get('x-admin-password') !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body              = await request.json().catch(() => ({}));
    const limitPerCategory  = Number((body as any).limitPerCategory ?? 30);

    // Fetch targeted markets from thesis-aligned categories
    const markets = await fetchTargetedMarkets(limitPerCategory);

    if (markets.length === 0) {
      return NextResponse.json({
        ok: true,
        fetched: 0,
        inserted: 0,
        updated: 0,
        note: 'No targeted markets returned from Polymarket — category filter may not be supported',
      });
    }

    // Directly upsert the targeted markets (no second full fetch).
    const syncResult = await syncMarketsFromList(markets);

    return NextResponse.json({
      ok:               !syncResult.errors.length,
      targeted_fetched: markets.length,
      inserted:         syncResult.inserted,
      updated:          syncResult.updated,
      errors:           syncResult.errors.slice(0, 10),
    });
  } catch (err: any) {
    return NextResponse.json({
      error: err?.message ?? String(err),
    }, { status: 500 });
  }
}
