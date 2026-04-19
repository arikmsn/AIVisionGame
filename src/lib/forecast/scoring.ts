/**
 * Forecast Arena — Scoring Engine
 *
 * Computes Brier score, log loss, and edge vs market for each submission.
 */

import { faInsert, faSelect, faPatch, faUpsert } from './db';

// ── Score functions ──────────────────────────────────────────────────────────

export function brierScore(probabilityYes: number, outcome: boolean): number {
  const o = outcome ? 1 : 0;
  return Math.pow(probabilityYes - o, 2);
}

export function logLoss(probabilityYes: number, outcome: boolean): number {
  // Clamp to avoid log(0)
  const p = Math.max(0.001, Math.min(0.999, probabilityYes));
  return outcome ? -Math.log(p) : -Math.log(1 - p);
}

/**
 * Edge = how much better the agent's forecast was vs the market price.
 * Positive = agent was better than market. Negative = worse.
 * Computed as: market_brier - agent_brier (so positive is good).
 */
export function edgeVsMarket(
  agentProbability: number,
  marketPrice: number,
  outcome: boolean,
): number {
  const marketBrier = brierScore(marketPrice, outcome);
  const agentBrier  = brierScore(agentProbability, outcome);
  return marketBrier - agentBrier;
}

// ── Score a round ────────────────────────────────────────────────────────────

export async function scoreRound(
  roundId: string,
  outcome: boolean,
): Promise<{ scored: number; errors: string[] }> {
  const result = { scored: 0, errors: [] as string[] };

  // Get round info (for market price at open)
  const rounds = await faSelect<{
    id: string; market_id: string; market_yes_price_at_open: number;
  }>('fa_rounds', `id=eq.${roundId}&select=id,market_id,market_yes_price_at_open`);

  if (rounds.length === 0) {
    result.errors.push(`Round ${roundId} not found`);
    return result;
  }
  const round = rounds[0];
  const marketPrice = round.market_yes_price_at_open ?? 0.5;

  // Get all submissions for this round
  const submissions = await faSelect<{
    id: string; agent_id: string; probability_yes: number; error_text: string | null;
  }>('fa_submissions', `round_id=eq.${roundId}&select=id,agent_id,probability_yes,error_text`);

  if (submissions.length === 0) {
    result.errors.push(`No submissions found for round ${roundId}`);
    return result;
  }

  // Score each submission
  const scoreRows: Record<string, unknown>[] = [];

  for (const sub of submissions) {
    try {
      if (sub.error_text && sub.probability_yes === 0.5) {
        // Error submission — still score it but note it
        console.log(`[FA/SCORING] Scoring error submission ${sub.id} (default 0.5)`);
      }

      const brier = brierScore(sub.probability_yes, outcome);
      const ll    = logLoss(sub.probability_yes, outcome);
      const edge  = edgeVsMarket(sub.probability_yes, marketPrice, outcome);

      scoreRows.push({
        submission_id:      sub.id,
        round_id:           roundId,
        agent_id:           sub.agent_id,
        brier_score:        brier,
        log_loss:           ll,
        edge_at_submission: edge,
        resolved_outcome:   outcome,
      });

      result.scored++;
    } catch (err: any) {
      result.errors.push(`Score error for submission ${sub.id}: ${err?.message}`);
    }
  }

  // Upsert scores (idempotent on submission_id)
  if (scoreRows.length > 0) {
    const ok = await faUpsert('fa_scores', scoreRows, 'submission_id');
    if (!ok) {
      result.errors.push('Failed to upsert scores');
    }
  }

  // Update round status
  await faPatch('fa_rounds', { id: roundId }, {
    status:      'resolved',
    resolved_at: new Date().toISOString(),
  });

  // Update market resolution
  await faPatch('fa_markets', { id: round.market_id }, {
    resolution_outcome: outcome,
    resolved_at:        new Date().toISOString(),
    status:             'resolved',
  });

  // Audit event
  await faInsert('fa_audit_events', [{
    event_type:   'round_scored',
    entity_type:  'round',
    entity_id:    roundId,
    actor:        'system',
    payload_json: {
      outcome,
      scored:     result.scored,
      errors:     result.errors.length,
      market_price_at_open: marketPrice,
    },
  }]);

  // ── Calibration hook ──────────────────────────────────────────────────────
  // Write per-submission calibration events. Failures do not block resolution.
  try {
    const { recordCalibrationOnResolve } = await import('./calibration');
    const calib = await recordCalibrationOnResolve(roundId, outcome);
    if (calib.error) {
      console.warn(`[FA/SCORING] calibration hook warning: ${calib.error}`);
    } else {
      console.log(`[FA/SCORING] calibration: recorded ${calib.recorded} events`);
    }
  } catch (err: any) {
    console.error('[FA/SCORING] calibration hook failed (non-blocking):', err?.message ?? err);
  }

  console.log(`[FA/SCORING] Round ${roundId} scored: ${result.scored} submissions, outcome=${outcome}`);
  return result;
}
