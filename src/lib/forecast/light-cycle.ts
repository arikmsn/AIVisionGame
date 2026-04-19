/**
 * Light Cycle — runs several times per day, between full daily cycles.
 *
 * Goals:
 *   - Sync latest market prices (no forced news refresh)
 *   - Re-score markets using *cached* news counts (zero extra API calls)
 *   - Open new positions only on markets where the YES price has moved
 *     at least min_price_change_pct since the last round
 *   - Enforce daily cycle budget (max_light_cycles_per_day)
 *   - Enforce capital floor (skip new entries when bankroll is low)
 *
 * Shared by:
 *   /api/forecast/light-cycle  (Vercel Cron + manual POST)
 *   dashboard server action    (runLightCycleAction)
 */

import { syncMarketsToDb }                                     from './polymarket';
import { faInsert, faSelect, faPatch, faUpsert }               from './db';
import { scoreMarket, selectTopMarkets, detectDomain,
         type MarketForScoring }                               from './market-scorer';
import { runAllAgentsOnRound }                                 from './runner';
import { openSystemPosition }                                  from './positions';
import { aggregateVotes, decisionSnapshot, type ModelVote }   from './aggregator';

// ── Config defaults (overridden by fa_experiment_config) ──────────────────────

const DEFAULT_MAX_CYCLES_PER_DAY = 6;
const DEFAULT_MIN_PRICE_CHANGE_PCT = 3.0;   // percent
const DEFAULT_MAX_MARKETS_PER_RUN  = 5;
const MIN_CAPITAL_TO_OPEN_USD      = 500;   // won't open positions below this

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LightCycleConfig {
  max_light_cycles_per_day: number;
  min_price_change_pct:     number;
  max_markets_per_run:      number;
}

export interface LightCycleSyncResult {
  ok:        boolean;
  inserted:  number;
  updated:   number;
  error?:    string;
}

export interface LightCycleScoreResult {
  ok:        boolean;
  total:     number;
  selected:  number;
  error?:    string;
}

export interface LightCycleRoundResult {
  ok:              boolean;
  created:         number;
  positions:       number;
  skipped_price:   number;    // price didn't move enough
  skipped_capital: boolean;   // insufficient bankroll
  error?:          string;
}

export interface LightCycleResult {
  ok:          boolean;
  paused?:     boolean;
  reason?:     string;
  trigger:     string;
  elapsed_ms:  number;
  cycles_today?: number;
  max_cycles?:   number;
  sync?:         LightCycleSyncResult;
  score?:        LightCycleScoreResult;
  rounds?:       LightCycleRoundResult;
}

// ── Step helpers ──────────────────────────────────────────────────────────────

async function readConfig(): Promise<LightCycleConfig> {
  try {
    const rows = await faSelect<{
      max_light_cycles_per_day?: number;
      min_price_change_pct?:     number;
      max_markets_per_run?:      number;
    }>(
      'fa_experiment_config',
      'status=eq.active&select=max_light_cycles_per_day,min_price_change_pct,max_markets_per_run&order=created_at.desc&limit=1',
    );
    const r = rows[0] ?? {};
    return {
      max_light_cycles_per_day: Number(r.max_light_cycles_per_day ?? DEFAULT_MAX_CYCLES_PER_DAY),
      min_price_change_pct:     Number(r.min_price_change_pct     ?? DEFAULT_MIN_PRICE_CHANGE_PCT),
      max_markets_per_run:      Number(r.max_markets_per_run      ?? DEFAULT_MAX_MARKETS_PER_RUN),
    };
  } catch {
    return {
      max_light_cycles_per_day: DEFAULT_MAX_CYCLES_PER_DAY,
      min_price_change_pct:     DEFAULT_MIN_PRICE_CHANGE_PCT,
      max_markets_per_run:      DEFAULT_MAX_MARKETS_PER_RUN,
    };
  }
}

async function countTodayLightCycles(): Promise<number> {
  try {
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    const rows = await faSelect<{ id: string }>(
      'fa_audit_events',
      `event_type=eq.light_cycle&created_at=gte.${todayUtc.toISOString()}&select=id`,
    );
    return rows.length;
  } catch {
    return 0;
  }
}

async function stepSyncMarkets(): Promise<LightCycleSyncResult> {
  try {
    const r = await syncMarketsToDb(50);
    console.log(`[LIGHT] Sync: inserted=${r.inserted} updated=${r.updated}`);
    return { ok: true, inserted: r.inserted, updated: r.updated };
  } catch (err: any) {
    console.error('[LIGHT] Sync error:', err?.message);
    return { ok: false, inserted: 0, updated: 0, error: err?.message };
  }
}

/**
 * Score markets using *cached* news counts stored in fa_market_scores.
 * Does NOT call any external news API — zero extra cost.
 */
async function stepScoreMarketsCached(cfg: LightCycleConfig): Promise<LightCycleScoreResult> {
  try {
    // Read current markets
    const markets = await faSelect<MarketForScoring>(
      'fa_markets',
      'status=eq.active&select=id,title,category,current_yes_price,volume_usd,close_time&limit=200',
    );

    // Read cached news counts from existing score rows (no API call)
    const cachedScores = await faSelect<{ market_id: string; news_count: number }>(
      'fa_market_scores',
      'select=market_id,news_count',
    ).catch(() => [] as { market_id: string; news_count: number }[]);
    const newsCountMap = new Map(cachedScores.map(s => [s.market_id, Number(s.news_count ?? 0)]));

    // Score each market using cached news count
    const scored = markets.map((m) => {
      const mDomain   = detectDomain(m.title, m.category);
      const newsCount = newsCountMap.get(m.id) ?? 0;
      return { scored: scoreMarket(m, newsCount), market: m, domain: mDomain };
    });

    const selected    = selectTopMarkets(scored.map(s => s.scored), cfg.max_markets_per_run);
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
      news_count:        newsCountMap.get(m.id) ?? 0,   // preserve cached count
      is_selected:       selectedIds.has(m.id),
      selection_rank:    selectedIds.has(m.id)
        ? selected.findIndex(sel => sel.marketId === m.id) + 1 : null,
      eligible:          s.eligible,
      ineligible_reason: s.reason ?? null,
      scored_at:         new Date().toISOString(),
    }));

    await faUpsert('fa_market_scores', rows, 'market_id');

    console.log(`[LIGHT] Score: total=${markets.length} selected=${selected.length}`);
    return { ok: true, total: markets.length, selected: selected.length };
  } catch (err: any) {
    console.error('[LIGHT] Score error:', err?.message);
    return { ok: false, total: 0, selected: 0, error: err?.message };
  }
}

/**
 * For each selected market, create and run a round ONLY if the YES price
 * has moved at least min_price_change_pct since the last round was opened.
 */
async function stepRunRoundsIfPriceMoved(cfg: LightCycleConfig): Promise<LightCycleRoundResult> {
  let created     = 0;
  let positions   = 0;
  let skippedPrice = 0;

  try {
    // Selected markets ordered by score
    const selected = await faSelect<{ market_id: string }>(
      'fa_market_scores',
      `is_selected=eq.true&eligible=eq.true&order=score.desc&limit=${cfg.max_markets_per_run}&select=market_id`,
    ).catch(() => []);

    if (selected.length === 0) {
      return { ok: true, created: 0, positions: 0, skipped_price: 0, skipped_capital: false };
    }

    // Active season
    const seasons   = await faSelect<{ id: string }>('fa_seasons', 'status=eq.active&order=created_at.desc&limit=1&select=id');
    const seasonId  = seasons[0]?.id ?? null;

    // Central bankroll
    const bankrollRows = await faSelect<{ id: string; available_usd: number }>(
      'fa_central_bankroll', 'select=id,available_usd&limit=1',
    ).catch(() => []);
    const bankrollBalance = bankrollRows[0] ? Number(bankrollRows[0].available_usd) : 60000;

    for (const sel of selected) {
      const mId = sel.market_id;
      try {
        // Current market state
        const mktRows = await faSelect<{ id: string; title: string; category: string | null; current_yes_price: number; close_time: string | null }>(
          'fa_markets', `id=eq.${mId}&select=id,title,category,current_yes_price,close_time`,
        );
        const mkt = mktRows[0];
        if (!mkt) continue;

        const currentPrice = Number(mkt.current_yes_price ?? 0);

        // Last round price for this market
        const lastRounds = await faSelect<{ market_yes_price_at_open: number; opened_at: string }>(
          'fa_rounds',
          `market_id=eq.${mId}&order=round_number.desc&limit=1&select=market_yes_price_at_open,opened_at`,
        ).catch(() => []);
        const lastPrice = lastRounds[0] ? Number(lastRounds[0].market_yes_price_at_open ?? 0) : null;

        // Price-change gate
        if (lastPrice !== null && lastPrice > 0 && currentPrice > 0) {
          const changePct = Math.abs((currentPrice - lastPrice) / lastPrice) * 100;
          if (changePct < cfg.min_price_change_pct) {
            console.log(`[LIGHT] Market ${mId}: price change ${changePct.toFixed(2)}% < ${cfg.min_price_change_pct}% threshold — skip`);
            skippedPrice++;
            continue;
          }
          console.log(`[LIGHT] Market ${mId}: price moved ${changePct.toFixed(2)}% → opening round`);
        } else {
          console.log(`[LIGHT] Market ${mId}: no prior round — opening first round`);
        }

        // Create round
        const existingRounds = await faSelect<{ round_number: number }>(
          'fa_rounds', `market_id=eq.${mId}&order=round_number.desc&limit=1&select=round_number`,
        );
        const nextRound = (existingRounds[0]?.round_number ?? 0) + 1;

        const inserted = await faInsert('fa_rounds', [{
          season_id:                seasonId,
          market_id:                mId,
          round_number:             nextRound,
          status:                   'open',
          market_yes_price_at_open: currentPrice,
          context_json:             { created_by: 'light-cycle', timestamp: new Date().toISOString() },
        }], { returning: true });

        const roundRow  = Array.isArray(inserted) ? inserted[0] : null;
        if (!roundRow) continue;
        const roundId   = (roundRow as any).id as string;
        created++;

        // Run agents
        await faPatch('fa_rounds', { id: roundId }, { status: 'running' });
        const results = await runAllAgentsOnRound(roundId);
        await faPatch('fa_rounds', { id: roundId }, { status: 'completed' });

        // ── Aggregate all model votes into ONE system decision ────────────────
        const votes: ModelVote[] = results
          .filter(r => r.success && r.submissionId && r.probabilityYes != null)
          .map(r => ({
            agentSlug:      r.agentSlug,
            submissionId:   r.submissionId!,
            probabilityYes: r.probabilityYes!,
            weight:         1.0,   // equal weights v1; increase for better models
          }));

        const decision = aggregateVotes(votes, currentPrice, bankrollBalance);

        // Persist system decision into round context_json
        const existingCtx = (await faSelect<{ context_json: any }>(
          'fa_rounds', `id=eq.${roundId}&select=context_json`,
        ).catch(() => [])) [0]?.context_json ?? {};

        await faPatch('fa_rounds', { id: roundId }, {
          context_json: { ...existingCtx, system_decision: decisionSnapshot(decision) },
        }).catch(() => {});

        // Open ONE system position if decision warrants it
        if (decision.action !== 'no_trade' && decision.nomineeSlug) {
          const agentRow = await faSelect<{ id: string }>(
            'fa_agents', `slug=eq.${decision.nomineeSlug}&select=id`,
          );
          if (agentRow[0]) {
            const posId = await openSystemPosition({
              nomineeAgentId:   agentRow[0].id,
              nomineeAgentSlug: decision.nomineeSlug,
              marketId:         mId,
              roundId,
              decision,
            }).catch(() => null);
            if (posId) positions++;
          }
        }

        console.log(
          `[LIGHT] Round ${roundId}: ${votes.length} votes → ` +
          `${decision.action} (agg_edge ${(decision.aggregatedEdge * 100).toFixed(1)}%, ` +
          `σ=${(decision.disagreement * 100).toFixed(1)}%)`,
        );
      } catch (mktErr: any) {
        console.error(`[LIGHT] Round error for market ${mId}:`, mktErr?.message);
      }
    }

    return { ok: true, created, positions, skipped_price: skippedPrice, skipped_capital: false };
  } catch (err: any) {
    console.error('[LIGHT] Rounds error:', err?.message);
    return { ok: false, created, positions, skipped_price: skippedPrice, skipped_capital: false, error: err?.message };
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runLightCycle(trigger: string): Promise<LightCycleResult> {
  const t0 = Date.now();
  console.log(`[LIGHT] Cycle started (trigger=${trigger})`);

  // Step 0: Read config
  const cfg = await readConfig();

  // Step 1: Check daily limit
  const cyclesToday = await countTodayLightCycles();
  if (cyclesToday >= cfg.max_light_cycles_per_day) {
    console.log(`[LIGHT] Budget limit reached: ${cyclesToday}/${cfg.max_light_cycles_per_day} today — pausing`);
    await faInsert('fa_audit_events', [{
      event_type:   'light_cycle_paused',
      entity_type:  'system',
      actor:        trigger,
      payload_json: {
        reason:       'max_daily_cycles_reached',
        cycles_today: cyclesToday,
        max_cycles:   cfg.max_light_cycles_per_day,
      },
    }]).catch(() => {});
    return {
      ok:           false,
      paused:       true,
      reason:       'max_daily_cycles_reached',
      trigger,
      elapsed_ms:   Date.now() - t0,
      cycles_today: cyclesToday,
      max_cycles:   cfg.max_light_cycles_per_day,
    };
  }

  // Step 2: Check capital
  const bankrollRows = await faSelect<{ available_usd: number }>(
    'fa_central_bankroll', 'select=available_usd&limit=1',
  ).catch(() => []);
  const availableUsd    = bankrollRows[0] ? Number(bankrollRows[0].available_usd) : 0;
  const canOpenPositions = availableUsd >= MIN_CAPITAL_TO_OPEN_USD;
  if (!canOpenPositions) {
    console.log(`[LIGHT] Capital low (${availableUsd}) — will sync/score but skip new positions`);
  }

  // Step 3: Sync markets
  const sync = await stepSyncMarkets();

  // Step 4: Score markets (cached news, no API calls)
  const score = await stepScoreMarketsCached(cfg);

  // Step 5: Rounds — only if capital allows
  let rounds: LightCycleRoundResult;
  if (canOpenPositions) {
    rounds = await stepRunRoundsIfPriceMoved(cfg);
  } else {
    rounds = { ok: true, created: 0, positions: 0, skipped_price: 0, skipped_capital: true };
  }

  const elapsed_ms = Date.now() - t0;

  // Write audit event
  await faInsert('fa_audit_events', [{
    event_type:   'light_cycle',
    entity_type:  'system',
    actor:        trigger,
    payload_json: {
      sync, score, rounds,
      elapsed_ms,
      capital_available_usd: availableUsd,
      cycles_today:          cyclesToday + 1,
      max_cycles:            cfg.max_light_cycles_per_day,
    },
  }]).catch(() => {});

  console.log(`[LIGHT] Cycle complete in ${elapsed_ms}ms — rounds=${rounds.created} positions=${rounds.positions}`);
  return {
    ok: true,
    trigger,
    elapsed_ms,
    cycles_today: cyclesToday + 1,
    max_cycles:   cfg.max_light_cycles_per_day,
    sync,
    score,
    rounds,
  };
}
