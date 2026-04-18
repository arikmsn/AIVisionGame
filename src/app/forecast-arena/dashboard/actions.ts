'use server';

/**
 * Server actions for the Forecast Arena operator dashboard.
 *
 * These run server-side (have access to env vars and DB) and are called
 * directly from the OperatorActions client component. No password needs
 * to be passed from the browser — auth is implicit (middleware already
 * enforces Basic Auth on all /forecast-arena/* routes).
 */

import { runTickCycle } from '@/lib/forecast/positions';
import { syncMarketsToDb } from '@/lib/forecast/polymarket';
import { faInsert, faSelect, faPatch, faUpsert } from '@/lib/forecast/db';
import { runAllAgentsOnRound } from '@/lib/forecast/runner';
import { openPosition } from '@/lib/forecast/positions';
import { scoreMarket, selectTopMarkets, detectDomain, type MarketForScoring } from '@/lib/forecast/market-scorer';
import { getNewsCountOnly, getOrRefreshContext } from '@/lib/forecast/news-context';

// ── Result type ───────────────────────────────────────────────────────────────

export interface ActionResult {
  ok:      boolean;
  message: string;
  detail?: Record<string, unknown>;
}

// ── Tick ──────────────────────────────────────────────────────────────────────

export async function runTickAction(): Promise<ActionResult> {
  try {
    const result = await runTickCycle();
    const summary = result.results.reduce((acc: Record<string, number>, r) => {
      acc[r.action] = (acc[r.action] ?? 0) + 1;
      return acc;
    }, {});
    return {
      ok:      true,
      message: `Tick complete: ${result.processed} positions processed`,
      detail:  { ...summary, errors: result.errors.length },
    };
  } catch (err: any) {
    return { ok: false, message: err?.message ?? 'Tick failed' };
  }
}

// ── Market sync ───────────────────────────────────────────────────────────────

export async function syncMarketsAction(limit = 50): Promise<ActionResult> {
  try {
    const result = await syncMarketsToDb(limit);
    return {
      ok:      true,
      message: `Sync complete: ${result.inserted} inserted, ${result.updated} updated`,
      detail:  { inserted: result.inserted, updated: result.updated, errors: result.errors.length },
    };
  } catch (err: any) {
    return { ok: false, message: err?.message ?? 'Sync failed' };
  }
}

// ── Create round ──────────────────────────────────────────────────────────────

export async function createRoundAction(count = 1): Promise<ActionResult> {
  try {
    // Auto-select top active markets by volume
    const markets = await faSelect<{ id: string; current_yes_price: number; title: string }>(
      'fa_markets',
      `status=eq.active&order=volume_usd.desc.nullslast&limit=${count}&select=id,current_yes_price,title`,
    );

    if (markets.length === 0) {
      return { ok: false, message: 'No active markets. Run sync-markets first.' };
    }

    // Get or create season
    let seasons = await faSelect<{ id: string }>('fa_seasons', 'status=eq.active&select=id&limit=1');
    let seasonId = seasons[0]?.id;
    if (!seasonId) {
      const inserted = await faInsert('fa_seasons', [{
        name: 'Season 1', status: 'active', starts_at: new Date().toISOString(),
      }], { returning: true });
      seasonId = Array.isArray(inserted) && inserted[0] ? (inserted[0] as any).id : null;
    }

    const created: string[] = [];
    for (const market of markets) {
      const rows = await faInsert('fa_rounds', [{
        season_id:                seasonId ?? null,
        market_id:                market.id,
        round_number:             1,
        status:                   'open',
        opened_at:                new Date().toISOString(),
        market_yes_price_at_open: market.current_yes_price,
      }], { returning: true });

      if (Array.isArray(rows) && rows[0]) {
        created.push((rows[0] as any).id as string);
      }
    }

    return {
      ok:      true,
      message: `Created ${created.length} round(s)`,
      detail:  { roundIds: created, markets: markets.map(m => m.title.slice(0, 60)) },
    };
  } catch (err: any) {
    return { ok: false, message: err?.message ?? 'Create round failed' };
  }
}

// ── Score Markets ─────────────────────────────────────────────────────────────

export async function scoreMarketsAction(domain = 'sports', topN = 5): Promise<ActionResult> {
  try {
    const markets = await faSelect<MarketForScoring>(
      'fa_markets',
      'status=eq.active&select=id,title,category,current_yes_price,volume_usd,close_time&limit=200',
    );

    const scored = await Promise.all(
      markets.map(async (m) => {
        const mDomain = detectDomain(m.title, m.category);
        const newsCount = mDomain === domain ? await getNewsCountOnly(m.title, domain).catch(() => 0) : 0;
        return { scored: scoreMarket(m, newsCount), market: m, domain: mDomain };
      })
    );

    const selected = selectTopMarkets(scored.map(s => s.scored), topN);
    const selectedIds = new Set(selected.map(s => s.marketId));

    const rows = scored.map(({ scored: s, market: m, domain: d }) => ({
      market_id:         m.id,
      domain:            d,
      score:             s.score,
      tags:              s.tags,
      volume_score:      s.breakdown.volumeScore,
      timing_score:      s.breakdown.timingScore,
      price_score:       s.breakdown.priceScore,
      news_score:        s.breakdown.newsScore,
      news_count:        0,
      is_selected:       selectedIds.has(m.id),
      selection_rank:    selectedIds.has(m.id) ? selected.findIndex(sel => sel.marketId === m.id) + 1 : null,
      eligible:          s.eligible,
      ineligible_reason: s.reason ?? null,
      scored_at:         new Date().toISOString(),
    }));

    await faUpsert('fa_market_scores', rows, 'market_id');

    return {
      ok:      true,
      message: `Scored ${markets.length} markets; ${selected.length} selected`,
      detail:  {
        total:    markets.length,
        eligible: scored.filter(s => s.scored.eligible).length,
        selected: selected.length,
        top:      selected.slice(0, 3).map(s => {
          const m = markets.find(mk => mk.id === s.marketId);
          return { score: s.score, title: m?.title?.slice(0, 50) };
        }),
      },
    };
  } catch (err: any) {
    return { ok: false, message: err?.message ?? 'Score markets failed' };
  }
}

// ── Refresh Context ───────────────────────────────────────────────────────────

export async function refreshContextAction(): Promise<ActionResult> {
  try {
    const scores = await faSelect<{ market_id: string }>('fa_market_scores', 'is_selected=eq.true&select=market_id');
    let markets: Array<{ id: string; title: string; category: string | null }> = [];

    if (scores.length === 0) {
      markets = await faSelect('fa_markets', 'status=eq.active&select=id,title,category&order=volume_usd.desc&limit=5');
    } else {
      const ids = scores.map(s => s.market_id).join(',');
      markets = await faSelect('fa_markets', `id=in.(${ids})&select=id,title,category`);
    }

    let refreshed = 0;
    for (const m of markets) {
      const domain = detectDomain(m.title, m.category);
      await getOrRefreshContext(m.id, m.title, domain, true).catch(() => null);
      refreshed++;
    }

    return {
      ok:      true,
      message: `Refreshed context for ${refreshed} markets`,
      detail:  { markets: markets.map(m => m.title.slice(0, 50)) },
    };
  } catch (err: any) {
    return { ok: false, message: err?.message ?? 'Refresh context failed' };
  }
}

// ── Run round ─────────────────────────────────────────────────────────────────

export async function runLatestRoundAction(): Promise<ActionResult> {
  try {
    // Find oldest open round
    const rounds = await faSelect<{ id: string; market_id: string; market_yes_price_at_open: number }>(
      'fa_rounds',
      'status=eq.open&order=opened_at.asc&limit=1&select=id,market_id,market_yes_price_at_open',
    );

    if (rounds.length === 0) {
      return { ok: false, message: 'No open rounds. Create a round first.' };
    }

    const round       = rounds[0];
    const roundId     = round.id;
    const marketPrice = Number(round.market_yes_price_at_open ?? 0);

    await faPatch('fa_rounds', { id: roundId }, { status: 'running' });
    const results = await runAllAgentsOnRound(roundId);
    await faPatch('fa_rounds', { id: roundId }, { status: 'completed' });

    // Open positions for successful submissions
    const succeeded = results.filter(r => r.success);
    let positionsOpened = 0;

    if (marketPrice > 0) {
      for (const sub of succeeded) {
        if (!sub.submissionId || sub.probabilityYes == null) continue;
        const agents = await faSelect<{ id: string }>(
          'fa_agents', `slug=eq.${sub.agentSlug}&select=id`,
        );
        if (!agents[0]) continue;
        const agentId = agents[0].id;
        const wallets = await faSelect<{ paper_balance_usd: number }>(
          'fa_agent_wallets', `agent_id=eq.${agentId}&select=paper_balance_usd`,
        );
        const balance = wallets[0] ? Number(wallets[0].paper_balance_usd) : 10000;
        const posId = await openPosition({
          agentId, agentSlug: sub.agentSlug, marketId: round.market_id,
          roundId, submissionId: sub.submissionId,
          agentProbYes: sub.probabilityYes, marketPrice, walletBalance: balance,
        }).catch(() => null);
        if (posId) positionsOpened++;
      }
    }

    return {
      ok:      true,
      message: `Round ran: ${succeeded.length}/${results.length} agents succeeded, ${positionsOpened} positions opened`,
      detail:  {
        roundId,
        succeeded:       succeeded.length,
        failed:          results.length - succeeded.length,
        positionsOpened,
      },
    };
  } catch (err: any) {
    return { ok: false, message: err?.message ?? 'Run round failed' };
  }
}
