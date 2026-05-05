/**
 * POST /api/forecast/admin/backfill-events
 *
 * Re-runs targeted Polymarket sync via the /events endpoint to populate the
 * new event_id / event_slug / event_title columns on existing fa_markets
 * rows. Idempotent — repeated calls just refresh prices + event linkage.
 *
 * Required after migration that adds event columns. The volume-sorted
 * /markets sync path doesn't return parent events, so existing markets
 * synced through that path don't have event_id; this admin call closes
 * the gap.
 *
 * Auth: x-admin-password header.
 * Body: { limitPerCategory?: number }  default 50
 */

import { NextRequest, NextResponse }                  from 'next/server';
import { fetchTargetedMarkets, syncMarketsFromList }  from '@/lib/forecast/polymarket';

export const maxDuration = 120;
export const dynamic    = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (request.headers.get('x-admin-password') !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body             = await request.json().catch(() => ({}));
    const limitPerCategory = Number((body as any).limitPerCategory ?? 50);

    const markets = await fetchTargetedMarkets(limitPerCategory);
    if (markets.length === 0) {
      return NextResponse.json({
        ok: true, fetched: 0, inserted: 0, updated: 0, with_event_id: 0,
        note: 'No markets returned from Polymarket /events endpoint',
      });
    }

    const withEventId = markets.filter(m => (m as any).eventId).length;
    const result      = await syncMarketsFromList(markets);

    return NextResponse.json({
      ok:            !result.errors.length,
      fetched:       markets.length,
      with_event_id: withEventId,
      inserted:      result.inserted,
      updated:       result.updated,
      errors:        result.errors.slice(0, 10),
    });
  } catch (err: any) {
    return NextResponse.json({
      error: err?.message ?? String(err),
    }, { status: 500 });
  }
}
