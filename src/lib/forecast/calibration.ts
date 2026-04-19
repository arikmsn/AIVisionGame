/**
 * Forecast Arena — Calibration Store
 *
 * Per-model, per-domain calibration tracking (Manus blueprint §8.1).
 *
 * Data flow:
 *   Round resolved  ──► recordCalibrationOnResolve()          writes fa_calibration_events (one row per submission)
 *   Nightly cron    ──► rolloverWindows()                     upserts fa_model_calibration  (agent × domain × window)
 *
 * This module is diagnostic-only in v1: it records what happened, it does
 * NOT change trading behavior. The aggregator will read these stats in a
 * later phase (empirical weights).
 */

import { faSelect, faUpsert, faInsert } from './db';
import { brierScore, logLoss }          from './scoring';
import { isValidDomain, type Domain }   from './domains';

// ── Types ─────────────────────────────────────────────────────────────────────

export type Window = '30d' | '90d' | 'all';
export const WINDOWS: Window[] = ['30d', '90d', 'all'];

interface SubmissionRow {
  id:              string;
  round_id:        string;
  agent_id:        string;
  probability_yes: number;
  error_text:      string | null;
}

interface RoundRow {
  id:                       string;
  market_id:                string;
  market_yes_price_at_open: number | null;
  context_json:             { system_decision?: { aggregated_p?: number } } | null;
}

interface MarketRow {
  id:     string;
  domain: string | null;
  title?: string;
}

interface CalibEvent {
  id:                 string;
  agent_id:           string;
  domain:             string;
  resolved_at:        string;
  p_model:            number;
  p_market_at_open:   number | null;
  p_system:           number | null;
  outcome:            boolean;
  brier:              number;
  log_loss:           number;
}

// ── Resolution hook ───────────────────────────────────────────────────────────

/**
 * Called from scoring.ts::scoreRound immediately after fa_scores is updated.
 * Writes one fa_calibration_events row per submission. Idempotent on
 * submission_id (uses upsert).
 *
 * Failures are swallowed and logged — never block resolution.
 */
export async function recordCalibrationOnResolve(
  roundId: string,
  outcome: boolean,
): Promise<{ recorded: number; error?: string }> {
  try {
    const rounds = await faSelect<RoundRow>(
      'fa_rounds',
      `id=eq.${roundId}&select=id,market_id,market_yes_price_at_open,context_json`,
    );
    if (rounds.length === 0) return { recorded: 0, error: 'round not found' };
    const round = rounds[0];

    const markets = await faSelect<MarketRow>(
      'fa_markets', `id=eq.${round.market_id}&select=id,domain,title`,
    );
    const market = markets[0];
    if (!market) return { recorded: 0, error: 'market not found' };

    const domain: Domain = isValidDomain(market.domain) ? market.domain : 'other';
    const pMarket = round.market_yes_price_at_open != null ? Number(round.market_yes_price_at_open) : null;
    const pSystem = round.context_json?.system_decision?.aggregated_p != null
      ? Number(round.context_json.system_decision.aggregated_p)
      : null;

    const submissions = await faSelect<SubmissionRow>(
      'fa_submissions',
      `round_id=eq.${roundId}&select=id,round_id,agent_id,probability_yes,error_text`,
    );
    if (submissions.length === 0) return { recorded: 0 };

    const rows = submissions.map(s => {
      const p = Number(s.probability_yes ?? 0.5);
      return {
        submission_id:    s.id,
        round_id:         s.round_id,
        market_id:        round.market_id,
        agent_id:         s.agent_id,
        resolved_at:      new Date().toISOString(),
        domain,
        p_model:          p,
        p_market_at_open: pMarket,
        p_system:         pSystem,
        outcome,
        brier:            brierScore(p, outcome),
        log_loss:         logLoss(p, outcome),
      };
    });

    const ok = await faUpsert('fa_calibration_events', rows, 'submission_id');
    if (!ok) return { recorded: 0, error: 'upsert failed' };

    return { recorded: rows.length };
  } catch (err: any) {
    console.error('[FA/CALIB] recordCalibrationOnResolve error:', err?.message ?? err);
    return { recorded: 0, error: err?.message ?? String(err) };
  }
}

// ── Window rollover ───────────────────────────────────────────────────────────

function windowCutoff(w: Window): string | null {
  if (w === 'all') return null;
  const days = w === '30d' ? 30 : 90;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/**
 * Recompute fa_model_calibration rollups for each window from the
 * fa_calibration_events substrate. Safe to run repeatedly.
 */
export async function rolloverWindows(
  windows: Window[] = WINDOWS,
): Promise<{ windows: Window[]; upserted: number; error?: string }> {
  try {
    let upsertedTotal = 0;

    for (const w of windows) {
      const cutoff = windowCutoff(w);
      const filter = cutoff
        ? `resolved_at=gte.${cutoff}&select=agent_id,domain,p_model,p_market_at_open,outcome,brier,log_loss&limit=50000`
        : `select=agent_id,domain,p_model,p_market_at_open,outcome,brier,log_loss&limit=50000`;

      const events = await faSelect<{
        agent_id:         string;
        domain:           string;
        p_model:          number;
        p_market_at_open: number | null;
        outcome:          boolean;
        brier:            number;
        log_loss:         number;
      }>('fa_calibration_events', filter);

      // Group by (agent_id, domain)
      const key = (a: string, d: string) => `${a}::${d}`;
      const buckets = new Map<string, typeof events>();
      for (const e of events) {
        const k = key(e.agent_id, e.domain);
        const arr = buckets.get(k);
        if (arr) arr.push(e); else buckets.set(k, [e]);
      }

      const rows: Record<string, unknown>[] = [];
      for (const [k, evs] of buckets) {
        const [agentId, domain] = k.split('::');
        const n = evs.length;
        if (n === 0) continue;

        const brierMean   = evs.reduce((s, e) => s + Number(e.brier), 0) / n;
        const logLossMean = evs.reduce((s, e) => s + Number(e.log_loss), 0) / n;
        const hits        = evs.filter(e =>
          ((Number(e.p_model) > 0.5) === e.outcome) || (Number(e.p_model) === 0.5)
        ).length;
        const hitRate     = hits / n;

        // mean_edge vs. market (positive = agent beat market)
        const edgeEvs = evs.filter(e => e.p_market_at_open != null);
        const meanEdge = edgeEvs.length === 0
          ? null
          : edgeEvs.reduce((s, e) => {
              const mBrier = brierScore(Number(e.p_market_at_open), e.outcome);
              return s + (mBrier - Number(e.brier));
            }, 0) / edgeEvs.length;

        rows.push({
          agent_id:    agentId,
          domain,
          window:      w,
          brier_score: brierMean,
          log_loss:    logLossMean,
          hit_rate:    hitRate,
          mean_edge:   meanEdge,
          n_resolved:  n,
          updated_at:  new Date().toISOString(),
        });
      }

      if (rows.length > 0) {
        // Composite on_conflict — PostgREST needs comma-separated columns
        const ok = await faUpsert('fa_model_calibration', rows, 'agent_id,domain,window');
        if (ok) upsertedTotal += rows.length;
      }
    }

    await faInsert('fa_audit_events', [{
      event_type:   'calibration_rollover',
      entity_type:  'system',
      actor:        'system',
      payload_json: { windows, upserted: upsertedTotal },
    }]).catch(() => {});

    return { windows, upserted: upsertedTotal };
  } catch (err: any) {
    console.error('[FA/CALIB] rolloverWindows error:', err?.message ?? err);
    return { windows, upserted: 0, error: err?.message ?? String(err) };
  }
}

/**
 * Placeholder for future empirical-weight reads. Not wired into the
 * aggregator yet (v1 keeps flat weights). See aggregator.ts TODO.
 */
export async function getCalibrationWeight(
  _agentId: string,
  _domain:  string,
  _window:  Window = '90d',
): Promise<number> {
  return 1.0;
}

// Re-export event type for consumers (benchmarks.ts)
export type { CalibEvent };
