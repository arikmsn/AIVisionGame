/**
 * POST /api/forecast/score-markets
 * Scores all active markets and upserts results to fa_market_scores.
 * Also marks top-N as is_selected=true.
 * Protected by x-admin-password.
 */
import { NextRequest, NextResponse } from 'next/server';
import { faSelect, faUpsert } from '@/lib/forecast/db';
import { scoreMarket, selectTopMarkets, detectDomain, type MarketForScoring } from '@/lib/forecast/market-scorer';
import { getNewsCountOnly } from '@/lib/forecast/news-context';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const password = request.headers.get('x-admin-password');
  if (password !== process.env.ADMIN_PASSWORD) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));
    const { domain = 'sports', topN = 5 } = body as { domain?: string; topN?: number };

    const markets = await faSelect<MarketForScoring>(
      'fa_markets',
      'status=eq.active&select=id,title,category,current_yes_price,volume_usd,close_time&limit=200',
    );

    // Score markets in parallel (news count fetched per market)
    const scored = await Promise.all(
      markets.map(async (m) => {
        const mDomain = detectDomain(m.title, m.category);
        const newsCount = mDomain === domain ? await getNewsCountOnly(m.title, domain).catch(() => 0) : 0;
        return { scored: scoreMarket(m, newsCount), market: m, domain: mDomain, newsCount };
      })
    );

    const selected = selectTopMarkets(scored.map(s => s.scored), topN);
    const selectedIds = new Set(selected.map(s => s.marketId));

    // Upsert all scores
    const rows = scored.map(({ scored: s, market: m, domain: d, newsCount: nc }) => ({
      market_id:         m.id,
      domain:            d,
      score:             s.score,
      tags:              s.tags,
      volume_score:      s.breakdown.volumeScore,
      timing_score:      s.breakdown.timingScore,
      price_score:       s.breakdown.priceScore,
      news_score:        s.breakdown.newsScore,
      news_count:        nc,
      is_selected:       selectedIds.has(m.id),
      selection_rank:    selectedIds.has(m.id) ? selected.findIndex(sel => sel.marketId === m.id) + 1 : null,
      eligible:          s.eligible,
      ineligible_reason: s.reason ?? null,
      scored_at:         new Date().toISOString(),
    }));

    await faUpsert('fa_market_scores', rows, 'market_id');

    return NextResponse.json({
      ok: true,
      total: markets.length,
      eligible: scored.filter(s => s.scored.eligible).length,
      selected: selected.length,
      topMarkets: selected.map(s => {
        const m = markets.find(mk => mk.id === s.marketId);
        return { id: s.marketId, title: m?.title?.slice(0, 60), score: s.score, tags: s.tags };
      }),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
