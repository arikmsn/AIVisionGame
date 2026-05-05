/**
 * POST /api/forecast/daily-cycle
 * GET  /api/forecast/daily-cycle  ← Vercel Cron (Authorization: Bearer $CRON_SECRET)
 *
 * Full autonomous daily cycle — no manual intervention required:
 *   Step 1  Sync markets       — fetch active markets from Polymarket
 *   Step 2  Score markets      — 4-dimension scorer, select top-N
 *   Step 3  Refresh context    — news context for selected markets
 *   Step 4  Create + run rounds — forecast each selected market with all agents
 *   Step 5  Tick               — manage all open positions (stop-loss/expiry/target)
 *
 * Each step is run sequentially. A step failure is logged but does NOT abort
 * subsequent steps — the system is designed to be resilient.
 */

import { NextRequest, NextResponse } from 'next/server';
import { syncMarketsToDb, fetchTargetedMarkets, syncMarketsFromList } from '@/lib/forecast/polymarket';
import { faInsert, faSelect, faUpsert }   from '@/lib/forecast/db';
import {
  scoreMarket, selectMarketsWithDomainBalance, detectDomain,
  type MarketForScoring, type ScoredMarketWithDomain,
} from '@/lib/forecast/market-scorer';
import { getNewsCountOnly, getOrRefreshContext, getActiveProvider } from '@/lib/forecast/news-context';
import { runAllAgentsOnRound }            from '@/lib/forecast/runner';
import { openSystemPosition, runTickCycle } from '@/lib/forecast/positions';
import { aggregateVotes, decisionSnapshot, type ModelVote } from '@/lib/forecast/aggregator';
import { rolloverWindows }                 from '@/lib/forecast/calibration';
import { computeBenchmarks }                from '@/lib/forecast/benchmarks';
import { upsertSignalFromRound, markStaleSignals } from '@/lib/forecast/v2/signals';
import { processRoundSignal, markToMarketAll } from '@/lib/forecast/v2/positions';
import { getActivePilot }                   from '@/lib/forecast/v2/pilot';

export const maxDuration = 300; // 5 min — full cycle can be slow

// ── Auth ──────────────────────────────────────────────────────────────────────

function authorizeCron(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return req.headers.get('authorization') === `Bearer ${cronSecret}`;
}
function authorizeAdmin(req: NextRequest): boolean {
  return !!process.env.ADMIN_PASSWORD &&
    req.headers.get('x-admin-password') === process.env.ADMIN_PASSWORD;
}

// ── Step helpers ──────────────────────────────────────────────────────────────

async function stepSyncMarkets(): Promise<{ ok: boolean; inserted: number; updated: number; error?: string }> {
  try {
    // 1a. Standard volume-sorted sync (catches high-liquidity markets).
    //     Targeted sync (6 Polymarket tag calls × 25 markets) is intentionally
    //     skipped in the cron path to stay within the function timeout budget.
    //     Trigger it manually from the Admin panel when you want to pull in
    //     politics/geopolitics/tech/crypto markets.
    const r1 = await syncMarketsToDb(50);
    console.log(`[DAILY] Step 1 sync: inserted=${r1.inserted} updated=${r1.updated} (targeted sync skipped in cron)`);
    return { ok: true, inserted: r1.inserted, updated: r1.updated };
  } catch (err: any) {
    console.error('[DAILY] Step 1 sync error:', err?.message);
    return { ok: false, inserted: 0, updated: 0, error: err?.message };
  }
}

async function stepScoreMarkets(domain = 'sports', topN = 5): Promise<{ ok: boolean; total: number; selected: number; error?: string }> {
  try {
    const markets = await faSelect<MarketForScoring>(
      'fa_markets',
      'status=eq.active&select=id,title,category,current_yes_price,volume_usd,close_time&limit=200',
    );

    const scored = await Promise.all(
      markets.map(async (m) => {
        const mDomain    = detectDomain(m.title, m.category);
        const newsCount  = mDomain === domain
          ? await getNewsCountOnly(m.title, domain).catch(() => 0) : 0;
        return { scored: scoreMarket(m, newsCount), market: m, domain: mDomain };
      })
    );

    const itemsWithDomain: ScoredMarketWithDomain[] = scored.map(s => ({
      scored:   s.scored,
      domain:   s.domain,
      marketId: s.market.id,
    }));

    // Diagnostic: log eligible items by domain before selection
    const eligibleItems = itemsWithDomain.filter(i => i.scored.eligible);
    const domainCounts: Record<string, number> = {};
    for (const i of eligibleItems) {
      domainCounts[i.domain] = (domainCounts[i.domain] ?? 0) + 1;
    }
    console.log(`[DAILY] Step 2 eligible by domain: ${JSON.stringify(domainCounts)} (total=${eligibleItems.length})`);
    const topEligible = eligibleItems
      .sort((a, b) => b.scored.score - a.scored.score)
      .slice(0, 10)
      .map(i => `${i.domain}:${i.scored.score}`);
    console.log(`[DAILY] Step 2 top-10 eligible (score-sorted): ${topEligible.join(', ')}`);

    const selected    = selectMarketsWithDomainBalance(itemsWithDomain, topN);
    console.log(`[DAILY] Step 2 selected (${selected.length}): ${selected.map(s => `${s.marketId}:${s.score}`).join(', ')}`);
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
      selection_rank:    selectedIds.has(m.id)
        ? selected.findIndex(sel => sel.marketId === m.id) + 1 : null,
      eligible:          s.eligible,
      ineligible_reason: s.reason ?? null,
      scored_at:         new Date().toISOString(),
    }));
    await faUpsert('fa_market_scores', rows, 'market_id');

    console.log(`[DAILY] Step 2 score: total=${markets.length} selected=${selected.length}`);
    return { ok: true, total: markets.length, selected: selected.length };
  } catch (err: any) {
    console.error('[DAILY] Step 2 score error:', err?.message);
    return { ok: false, total: 0, selected: 0, error: err?.message };
  }
}

async function stepRefreshContext(domain = 'sports'): Promise<{ ok: boolean; refreshed: number; error?: string }> {
  // LLM gate: news context is only useful as input to LLM agents. When disabled,
  // skip the Anthropic summarisation entirely — saves tokens and ~10–20s of latency.
  if (process.env.USE_LLM_AGENTS !== 'true') {
    console.log('[DAILY] LLM disabled (USE_LLM_AGENTS!=true); skipping news context refresh');
    return { ok: true, refreshed: 0 };
  }

  try {
    const selected = await faSelect<{ market_id: string }>(
      'fa_market_scores',
      'is_selected=eq.true&eligible=eq.true&select=market_id&limit=10',
    ).catch(() => []);

    let targetIds: string[] = selected.map(r => r.market_id);
    if (targetIds.length === 0) {
      const fallback = await faSelect<{ id: string }>(
        'fa_markets',
        'status=eq.active&order=volume_usd.desc&limit=5&select=id',
      ).catch(() => []);
      targetIds = fallback.map(m => m.id);
    }
    if (targetIds.length === 0) return { ok: true, refreshed: 0 };

    const markets = await faSelect<{ id: string; title: string; category: string | null }>(
      'fa_markets',
      `id=in.(${targetIds.join(',')})&select=id,title,category`,
    ).catch(() => []);

    let refreshed = 0;
    for (const m of markets) {
      const mDomain = detectDomain(m.title, m.category);
      await getOrRefreshContext(m.id, m.title, (mDomain === 'general' || mDomain === 'other') ? domain : mDomain).catch(() => null);
      refreshed++;
    }

    console.log(`[DAILY] Step 3 context: refreshed=${refreshed}`);
    return { ok: true, refreshed };
  } catch (err: any) {
    console.error('[DAILY] Step 3 context error:', err?.message);
    return { ok: false, refreshed: 0, error: err?.message };
  }
}

async function stepRunRounds(): Promise<{ ok: boolean; rounds: number; positions: number; error?: string }> {
  // LLM gate: rounds exist solely to call LLM agents and aggregate their votes.
  // When disabled, skip entirely — no rounds created, no agents called, no
  // signals upserted from rounds. MTM and tick run separately and are unaffected.
  if (process.env.USE_LLM_AGENTS !== 'true') {
    console.log('[DAILY] LLM disabled (USE_LLM_AGENTS!=true); skipping rounds + agent calls');
    return { ok: true, rounds: 0, positions: 0 };
  }

  try {
    // Get selected markets
    const selected = await faSelect<{ market_id: string }>(
      'fa_market_scores',
      'is_selected=eq.true&eligible=eq.true&order=score.desc&limit=5&select=market_id',
    ).catch(() => []);

    let marketIds: string[] = selected.map(r => r.market_id);
    if (marketIds.length === 0) {
      const fallback = await faSelect<{ id: string }>(
        'fa_markets',
        'status=eq.active&current_yes_price=gte.0.05&current_yes_price=lte.0.95&order=volume_usd.desc&limit=3&select=id',
      ).catch(() => []);
      marketIds = fallback.map(m => m.id);
    }
    if (marketIds.length === 0) return { ok: true, rounds: 0, positions: 0 };

    // Get active season
    const seasons = await faSelect<{ id: string }>('fa_seasons', 'status=eq.active&order=created_at.desc&limit=1&select=id');
    const seasonId = seasons[0]?.id ?? null;

    // Central bankroll (legacy positions)
    const bankrollRows = await faSelect<{ id: string; available_usd: number; allocated_usd: number }>(
      'fa_central_bankroll', 'select=id,available_usd,allocated_usd&limit=1',
    ).catch(() => []);
    const bankrollBalance = bankrollRows[0] ? Number(bankrollRows[0].available_usd) : 60000;

    // v2 pilot
    const v2Pilot = await getActivePilot().catch(() => null);

    // Mark stale signals before this cycle
    await markStaleSignals(26).catch(() => {});

    let totalRounds    = 0;
    let totalPositions = 0;

    // Run all markets in PARALLEL — agents within each round are also parallel.
    // Promise.allSettled so a single slow/failing market doesn't block the others.
    const { faPatch } = await import('@/lib/forecast/db');

    const marketResults = await Promise.allSettled(
      marketIds.map(async (mId) => {
        // Create round
        const existingRounds = await faSelect<{ round_number: number }>(
          'fa_rounds', `market_id=eq.${mId}&order=round_number.desc&limit=1&select=round_number`,
        );
        const nextRound = (existingRounds[0]?.round_number ?? 0) + 1;
        const mkt = await faSelect<{ current_yes_price: number; domain: string | null; close_time: string | null }>(
          'fa_markets', `id=eq.${mId}&select=current_yes_price,domain,close_time`,
        );
        const yesPrice     = mkt[0]?.current_yes_price ?? null;
        const mktDomain    = mkt[0]?.domain ?? null;
        const mktCloseTime = mkt[0]?.close_time ?? null;

        const inserted = await faInsert('fa_rounds', [{
          season_id:                seasonId,
          market_id:                mId,
          round_number:             nextRound,
          status:                   'open',
          market_yes_price_at_open: yesPrice,
          context_json:             { created_by: 'daily-cycle', timestamp: new Date().toISOString() },
        }], { returning: true });

        const roundRow = Array.isArray(inserted) ? inserted[0] : null;
        if (!roundRow) return { rounds: 0, positions: 0 };
        const roundId = (roundRow as any).id as string;

        // Run agents on this round (already parallelised inside runAllAgentsOnRound)
        await faPatch('fa_rounds', { id: roundId }, { status: 'running' });
        const results = await runAllAgentsOnRound(roundId, v2Pilot?.id, mId, mktDomain ?? undefined);
        await faPatch('fa_rounds', { id: roundId }, { status: 'completed' });

        // ── Aggregate model votes → ONE system decision ──────────────────────
        const marketPrice = yesPrice != null ? Number(yesPrice) : 0;

        const votes: ModelVote[] = results
          .filter(r => r.success && r.submissionId && r.probabilityYes != null)
          .map(r => ({
            agentSlug:      r.agentSlug,
            submissionId:   r.submissionId!,
            probabilityYes: r.probabilityYes!,
            weight:         1.0,
          }));

        const decision = aggregateVotes(votes, marketPrice, bankrollBalance);

        await faPatch('fa_rounds', { id: roundId }, {
          context_json: { created_by: 'daily-cycle', system_decision: decisionSnapshot(decision) },
        }).catch(() => {});

        let positionCount = 0;
        if (decision.action !== 'no_trade' && decision.nomineeSlug) {
          const agentRow = await faSelect<{ id: string }>(
            'fa_agents', `slug=eq.${decision.nomineeSlug}&select=id`,
          );
          if (agentRow[0]) {
            const positionId = await openSystemPosition({
              nomineeAgentId:   agentRow[0].id,
              nomineeAgentSlug: decision.nomineeSlug,
              marketId:         mId,
              roundId,
              decision,
            }).catch(() => null);
            if (positionId) positionCount++;
          }
        }

        // ── v2: upsert signal + process desired exposure ─────────────────────
        try {
          await upsertSignalFromRound(
            mId,
            v2Pilot?.id ?? null,
            mktDomain,
            decision,
            roundId,
            null,   // freshnessHours
            false,  // hasCooldown — risk engine checks this
          );

          if (v2Pilot) {
            await processRoundSignal({
              pilotId:        v2Pilot.id,
              marketId:       mId,
              domain:         mktDomain,
              decision,
              roundId,
              freshnessHours: null,
              resolvesAt:     mktCloseTime,
            });
          }
        } catch (v2Err: any) {
          console.warn(`[DAILY] v2 signal/position error for ${mId}: ${v2Err?.message}`);
        }

        console.log(`[DAILY] Round ${mId}: ${results.filter(r => r.success).length} subs, decision=${decision.action}, edge=${decision.aggregatedEdge.toFixed(3)}`);
        return { rounds: 1, positions: positionCount };
      })
    );

    for (const res of marketResults) {
      if (res.status === 'fulfilled') {
        totalRounds    += res.value.rounds;
        totalPositions += res.value.positions;
      } else {
        console.error('[DAILY] Market round failed:', res.reason?.message ?? res.reason);
      }
    }

    await faInsert('fa_audit_events', [{
      event_type:   'round_created',
      entity_type:  'system',
      actor:        'daily-cycle',
      payload_json: { markets: marketIds.length, rounds: totalRounds, positions: totalPositions },
    }]).catch(() => {});

    console.log(`[DAILY] Step 4 rounds: ${totalRounds} rounds, ${totalPositions} positions`);
    return { ok: true, rounds: totalRounds, positions: totalPositions };
  } catch (err: any) {
    console.error('[DAILY] Step 4 rounds error:', err?.message);
    return { ok: false, rounds: 0, positions: 0, error: err?.message };
  }
}

async function stepTick(): Promise<{ ok: boolean; processed: number; error?: string }> {
  try {
    const result = await runTickCycle();
    console.log(`[DAILY] Step 5 tick: processed=${result.processed}`);
    return { ok: true, processed: result.processed };
  } catch (err: any) {
    console.error('[DAILY] Step 5 tick error:', err?.message);
    return { ok: false, processed: 0, error: err?.message };
  }
}

async function stepMarkToMarket(): Promise<{ ok: boolean; updated: number; error?: string }> {
  try {
    const pilot = await getActivePilot();
    if (!pilot) return { ok: true, updated: 0 };
    const result = await markToMarketAll(pilot.id);
    console.log(`[DAILY] Step 5b MTM: updated=${result.updated} positions`);
    return { ok: true, updated: result.updated };
  } catch (err: any) {
    console.error('[DAILY] Step 5b MTM error:', err?.message);
    return { ok: false, updated: 0, error: err?.message };
  }
}

// ── Calibration rollover + benchmarks (diagnostic only, never blocks) ─────────

async function stepCalibrationRollover(): Promise<{ ok: boolean; upserted: number; error?: string }> {
  try {
    const r = await rolloverWindows();
    console.log(`[DAILY] Step 6 calibration: upserted=${r.upserted} windows=${r.windows.join(',')}`);
    return { ok: !r.error, upserted: r.upserted, error: r.error };
  } catch (err: any) {
    console.error('[DAILY] Step 6 calibration error:', err?.message);
    return { ok: false, upserted: 0, error: err?.message };
  }
}

async function stepBenchmarks(): Promise<{ ok: boolean; rows: number; error?: string }> {
  try {
    const r = await computeBenchmarks('90d');
    console.log(`[DAILY] Step 7 benchmarks: rows=${r.rows}`);
    return { ok: !r.error, rows: r.rows, error: r.error };
  } catch (err: any) {
    console.error('[DAILY] Step 7 benchmarks error:', err?.message);
    return { ok: false, rows: 0, error: err?.message };
  }
}

/**
 * Pattern C — calendar monotonicity dry-run.
 *
 * Runs the scanner and writes the candidate list to fa_audit_events for
 * 7-day analysis. RESEARCH MODE — does NOT persist to fa_arb_signals or
 * open positions.
 */
async function stepArbDryRun(): Promise<{
  ok: boolean;
  candidates: number;
  markets_considered: number;
  error?: string;
}> {
  try {
    const { scanCalendarMonotonicity } = await import('@/lib/forecast/arb/scanner');
    const { candidates, stats } = await scanCalendarMonotonicity();

    // Truncate candidates to keep the audit row small (jsonb has practical limits;
    // 50 strongest signals is plenty for retrospective analysis).
    const top = candidates.slice(0, 50);

    await faInsert('fa_audit_events', [{
      event_type:   'arb_scanner_dryrun',
      entity_type:  'system',
      entity_id:    null,
      actor:        'daily-cycle',
      payload_json: {
        pattern:    'calendar_monotonic',
        stats,
        candidates: top,
      },
    }]).catch(() => {});

    console.log(
      `[DAILY] Step 8 arb dry-run: candidates=${stats.candidates_emitted} ` +
      `markets=${stats.markets_considered} pairs=${stats.pairs_examined}`,
    );
    return {
      ok:                 true,
      candidates:         stats.candidates_emitted,
      markets_considered: stats.markets_considered,
    };
  } catch (err: any) {
    console.error('[DAILY] Step 8 arb dry-run error:', err?.message);
    return { ok: false, candidates: 0, markets_considered: 0, error: err?.message };
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

async function runDailyCycle(trigger: string) {
  const t0 = Date.now();
  console.log(`[DAILY] Cycle started (trigger=${trigger})`);

  const sync        = await stepSyncMarkets();
  const score       = await stepScoreMarkets();
  const context     = await stepRefreshContext();
  const rounds      = await stepRunRounds();
  const tick        = await stepTick();
  const mtm         = await stepMarkToMarket();
  const calibration = await stepCalibrationRollover();
  const benchmarks  = await stepBenchmarks();
  const arb         = await stepArbDryRun();

  const elapsedMs = Date.now() - t0;
  const steps     = { sync, score, context, rounds, tick, mtm, calibration, benchmarks, arb };
  const allOk     = Object.values(steps).every(s => s.ok);

  // Record in audit log
  await faInsert('fa_audit_events', [{
    event_type:   'daily_cycle',
    entity_type:  'system',
    entity_id:    null,
    actor:        trigger,
    payload_json: { ...steps, elapsed_ms: elapsedMs },
  }]).catch(() => {});

  console.log(`[DAILY] Cycle complete in ${elapsedMs}ms — ok=${allOk}`);
  return { ok: allOk, trigger, elapsed_ms: elapsedMs, steps };
}

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const result = await runDailyCycle('cron');
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  if (!authorizeAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const result = await runDailyCycle('manual');
  return NextResponse.json(result);
}
