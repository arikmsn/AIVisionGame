/**
 * GET /api/forecast/v2/live-book
 *
 * Returns the complete Live Book state:
 *   - pilot summary (bankroll, cash, P&L, status)
 *   - all open positions with signal data
 *   - recent adjustments (last 20)
 *   - hot/tradable signals not yet positioned
 */

import { NextRequest, NextResponse } from 'next/server';
import { faSelect }                  from '@/lib/forecast/db';
import type { V2Pilot, V2Position, V2Signal, V2Adjustment } from '@/lib/forecast/v2/types';

function authorizeAdmin(req: NextRequest): boolean {
  return !!process.env.ADMIN_PASSWORD &&
    req.headers.get('x-admin-password') === process.env.ADMIN_PASSWORD;
}

export async function GET(req: NextRequest) {
  if (!authorizeAdmin(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 1. Pilot
    const pilots = await faSelect<V2Pilot>(
      'fa_v2_pilots',
      "status=in.(active,paused,manual_only)&order=created_at.asc&limit=1&select=*",
    );
    const pilot = pilots[0] ?? null;

    // 2. Open positions with market title joined
    const positions = pilot
      ? await faSelect<V2Position & { market_title?: string; market_price_live?: number }>(
          'fa_v2_positions',
          `pilot_id=eq.${pilot.id}&status=in.(open,paused)&order=opened_at.desc&select=*`,
        )
      : [];

    // 3. Market titles for positions
    const marketIds = [...new Set(positions.map(p => p.market_id))];
    let marketTitles: Record<string, { title: string; current_yes_price: number | null }> = {};
    if (marketIds.length > 0) {
      const mkts = await faSelect<{ id: string; title: string; current_yes_price: number | null }>(
        'fa_markets',
        `id=in.(${marketIds.join(',')})&select=id,title,current_yes_price`,
      );
      for (const m of mkts) {
        marketTitles[m.id] = { title: m.title, current_yes_price: m.current_yes_price };
      }
    }

    // Enrich positions
    const enrichedPositions = positions.map(p => ({
      ...p,
      market_title:      marketTitles[p.market_id]?.title ?? null,
      market_price_live: marketTitles[p.market_id]?.current_yes_price ?? null,
    }));

    // 4. Signals for open positions
    const signals = marketIds.length > 0
      ? await faSelect<V2Signal>(
          'fa_v2_signals',
          `market_id=in.(${marketIds.join(',')})&select=*`,
        )
      : [];

    // 5. Hot/tradable signals without positions
    const allHotSignals = await faSelect<V2Signal & { market_title?: string }>(
      'fa_v2_signals',
      `tier=in.(hot,tradable)&is_stale=eq.false&order=conviction.desc&limit=20&select=*`,
    );
    const openMarketSet = new Set(marketIds);
    const unpositionedSignals = allHotSignals.filter(s => !openMarketSet.has(s.market_id));

    // Enrich unpositioned signals with titles
    const upMktIds = [...new Set(unpositionedSignals.map(s => s.market_id))];
    let upTitles: Record<string, string> = {};
    if (upMktIds.length > 0) {
      const upMkts = await faSelect<{ id: string; title: string }>(
        'fa_markets',
        `id=in.(${upMktIds.join(',')})&select=id,title`,
      );
      for (const m of upMkts) upTitles[m.id] = m.title;
    }

    // 6. Recent adjustments (last 20)
    const recentAdj = pilot
      ? await faSelect<V2Adjustment>(
          'fa_v2_adjustments',
          `pilot_id=eq.${pilot.id}&order=created_at.desc&limit=20&select=*`,
        )
      : [];

    return NextResponse.json({
      pilot,
      positions:            enrichedPositions,
      signals:              signals.reduce<Record<string, V2Signal>>((acc, s) => { acc[s.market_id] = s; return acc; }, {}),
      unpositioned_signals: unpositionedSignals.map(s => ({ ...s, market_title: upTitles[s.market_id] ?? null })),
      recent_adjustments:   recentAdj,
      generated_at:         new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[V2/LIVE-BOOK] GET error:', err?.message);
    return NextResponse.json({ error: err?.message ?? 'internal error' }, { status: 500 });
  }
}
