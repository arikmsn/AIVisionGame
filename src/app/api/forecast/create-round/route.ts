/**
 * POST /api/forecast/create-round
 *
 * Creates a new fa_round for a given market (or auto-selects top markets).
 * Protected by ADMIN_PASSWORD header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { faInsert, faSelect } from '@/lib/forecast/db';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const password = request.headers.get('x-admin-password');
  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { marketId, count } = body as { marketId?: string; count?: number };

    let marketIds: string[] = [];

    if (marketId) {
      marketIds = [marketId];
    } else {
      // Auto-select top active markets by volume, filtering out extreme prices
      // (near 0 or near 1) so agents can generate meaningful edge
      const markets = await faSelect<{ id: string; current_yes_price: number }>(
        'fa_markets',
        `status=eq.active&current_yes_price=gte.0.05&current_yes_price=lte.0.95&order=volume_usd.desc&limit=${count ?? 3}&select=id,current_yes_price`,
      );
      marketIds = markets.map(m => m.id);
    }

    if (marketIds.length === 0) {
      return NextResponse.json({ error: 'No markets available. Run sync-markets first.' }, { status: 400 });
    }

    // Get active season
    const seasons = await faSelect<{ id: string }>(
      'fa_seasons',
      'status=eq.active&order=created_at.desc&limit=1&select=id',
    );
    const seasonId = seasons[0]?.id ?? null;

    // Get max round number for each market
    const rounds: any[] = [];
    for (const mId of marketIds) {
      const existingRounds = await faSelect<{ round_number: number }>(
        'fa_rounds',
        `market_id=eq.${mId}&order=round_number.desc&limit=1&select=round_number`,
      );
      const nextRound = (existingRounds[0]?.round_number ?? 0) + 1;

      // Get current market price
      const markets = await faSelect<{ current_yes_price: number }>(
        'fa_markets',
        `id=eq.${mId}&select=current_yes_price`,
      );
      const yesPrice = markets[0]?.current_yes_price ?? null;

      const inserted = await faInsert('fa_rounds', [{
        season_id:                seasonId,
        market_id:                mId,
        round_number:             nextRound,
        status:                   'open',
        market_yes_price_at_open: yesPrice,
        context_json:             { created_by: 'admin', timestamp: new Date().toISOString() },
      }], { returning: true });

      if (Array.isArray(inserted) && inserted[0]) {
        rounds.push(inserted[0]);
      }
    }

    // Audit
    await faInsert('fa_audit_events', [{
      event_type:   'round_created',
      entity_type:  'round',
      actor:        'admin',
      payload_json: { round_ids: rounds.map((r: any) => r.id), market_ids: marketIds },
    }]);

    return NextResponse.json({
      ok: true,
      rounds: rounds.map((r: any) => ({
        id:           r.id,
        market_id:    r.market_id,
        round_number: r.round_number,
        status:       r.status,
      })),
    });
  } catch (err: any) {
    console.error('[API/FORECAST/CREATE-ROUND] Error:', err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
