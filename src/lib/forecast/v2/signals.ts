/**
 * Forecast Arena v2 — Signal State Service
 *
 * Maintains fa_v2_signals: the latest market-level signal for each market,
 * updated after every round that runs agents. Also computes the conviction
 * score that feeds the desired-exposure model.
 *
 * Conviction formula (0–1):
 *   base     = clamp(|edge| / 0.25, 0, 1)         strong edge → higher
 *   agree    = 1 − clamp(σ / 0.40, 0, 1)          low disagreement → higher
 *   fresh    = clamp(1 − freshness_h / 48, 0, 1)  fresh evidence → higher
 *   conviction = base × 0.50 + agree × 0.35 + fresh × 0.15
 */

import { faUpsert, faSelect } from '../db';
import type { V2Signal }      from './types';
import type { AggregatedDecision } from '../aggregator';

// ── Compute conviction ────────────────────────────────────────────────────────

export function computeConviction(
  edge:            number,
  disagreement:    number,
  freshnessHours:  number | null = null,
): number {
  const base  = Math.min(Math.abs(edge) / 0.25, 1.0);
  const agree = 1 - Math.min((disagreement ?? 0) / 0.40, 1.0);
  const fresh = freshnessHours != null
    ? Math.max(1 - freshnessHours / 48, 0)
    : 0.5;  // unknown freshness — neutral
  return Math.round((base * 0.50 + agree * 0.35 + fresh * 0.15) * 1000) / 1000;
}

// ── Compute tier ──────────────────────────────────────────────────────────────

export function computeTier(
  conviction: number,
  edge:       number,
  hasCooldown: boolean,
): V2Signal['tier'] {
  if (hasCooldown)          return 'cooling';
  if (Math.abs(edge) < 0.05) return 'monitored';
  if (conviction >= 0.65)   return 'hot';
  if (Math.abs(edge) >= 0.08 && conviction >= 0.40) return 'tradable';
  return 'monitored';
}

// ── Upsert signal after a round ───────────────────────────────────────────────

export async function upsertSignalFromRound(
  marketId:      string,
  pilotId:       string | null,
  domain:        string | null,
  decision:      AggregatedDecision,
  roundId:       string,
  freshnessHours: number | null = null,
  hasCooldown:   boolean = false,
): Promise<void> {
  const conviction = computeConviction(
    decision.aggregatedEdge,
    decision.disagreement,
    freshnessHours,
  );

  const tier = computeTier(conviction, decision.aggregatedEdge, hasCooldown);

  await faUpsert('fa_v2_signals', [{
    market_id:            marketId,
    pilot_id:             pilotId,
    domain,
    market_price:         decision.marketPrice,
    aggregated_p:         decision.aggregatedP,
    edge:                 decision.aggregatedEdge,
    disagreement:         decision.disagreement,
    conviction,
    n_models:             decision.modelCount,
    last_round_id:        roundId,
    last_refresh:         new Date().toISOString(),
    evidence_freshness_h: freshnessHours,
    tier,
    is_stale:             false,
    updated_at:           new Date().toISOString(),
  }], 'market_id');
}

// ── Read signals ──────────────────────────────────────────────────────────────

export async function getSignal(marketId: string): Promise<V2Signal | null> {
  const rows = await faSelect<V2Signal>(
    'fa_v2_signals',
    `market_id=eq.${marketId}&select=*`,
  );
  return rows[0] ?? null;
}

export async function getHotSignals(limit = 20): Promise<V2Signal[]> {
  return faSelect<V2Signal>(
    'fa_v2_signals',
    `tier=in.(hot,tradable)&is_stale=eq.false&order=conviction.desc&limit=${limit}&select=*`,
  );
}

// ── Mark signals stale ────────────────────────────────────────────────────────

/**
 * Mark signals older than `maxAgeHours` as stale.
 * Called at the start of each cycle to age out old data.
 */
export async function markStaleSignals(maxAgeHours = 26): Promise<void> {
  const cutoff = new Date(Date.now() - maxAgeHours * 3_600_000).toISOString();
  // PostgREST doesn't support UPDATE with WHERE on a non-PK easily via REST,
  // so we read + batch-upsert. Signals table is small (≤ 500 rows in v1).
  const stale = await faSelect<V2Signal>(
    'fa_v2_signals',
    `last_refresh=lt.${cutoff}&is_stale=eq.false&select=market_id`,
  );
  if (stale.length === 0) return;
  await faUpsert(
    'fa_v2_signals',
    stale.map(s => ({
      market_id:  s.market_id,
      is_stale:   true,
      tier:       'monitored',
      updated_at: new Date().toISOString(),
    })),
    'market_id',
  );
}
