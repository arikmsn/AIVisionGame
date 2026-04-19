/**
 * POST /api/forecast/run-round
 *
 * Given a roundId:
 *   1. Runs all active agents → captures submissions
 *   2. For each successful submission, opens a paper position if edge ≥ 10%
 * Protected by ADMIN_PASSWORD header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runAllAgentsOnRound } from '@/lib/forecast/runner';
import { faPatch, faSelect } from '@/lib/forecast/db';
import { openSystemPosition } from '@/lib/forecast/positions';
import { aggregateVotes, decisionSnapshot, type ModelVote } from '@/lib/forecast/aggregator';

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const password = request.headers.get('x-admin-password');
  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { roundId } = body as { roundId: string };

    if (!roundId) {
      return NextResponse.json({ error: 'roundId required' }, { status: 400 });
    }

    // ── 1. Run all agents ────────────────────────────────────────────────────

    await faPatch('fa_rounds', { id: roundId }, { status: 'running' });
    const results = await runAllAgentsOnRound(roundId);
    await faPatch('fa_rounds', { id: roundId }, { status: 'completed' });

    const succeeded = results.filter(r => r.success);
    const failed    = results.filter(r => !r.success);

    // ── 2. Open positions for successful submissions ──────────────────────────

    // Load round + market info once
    const rounds = await faSelect<{ market_id: string; market_yes_price_at_open: number }>(
      'fa_rounds',
      `id=eq.${roundId}&select=market_id,market_yes_price_at_open`,
    );
    const marketId   = rounds[0]?.market_id;
    const marketPrice = Number(rounds[0]?.market_yes_price_at_open ?? 0);

    // ── Aggregate all model votes → ONE system decision ───────────────────────
    const bankrollRows = await faSelect<{ available_usd: number }>(
      'fa_central_bankroll', 'select=available_usd&limit=1',
    ).catch(() => []);
    const centralBalance = bankrollRows[0] ? Number(bankrollRows[0].available_usd) : 60000;

    let systemPositionId: string | null = null;
    let systemDecision: ReturnType<typeof aggregateVotes> | null = null;

    if (marketId && marketPrice > 0) {
      const votes: ModelVote[] = succeeded
        .filter(r => r.submissionId && r.probabilityYes != null)
        .map(r => ({
          agentSlug:      r.agentSlug,
          submissionId:   r.submissionId!,
          probabilityYes: r.probabilityYes!,
          weight:         1.0,
        }));

      systemDecision = aggregateVotes(votes, marketPrice, centralBalance);

      // Persist into round context_json
      await faPatch('fa_rounds', { id: roundId }, {
        context_json: { system_decision: decisionSnapshot(systemDecision) },
      }).catch(() => {});

      if (systemDecision.action !== 'no_trade' && systemDecision.nomineeSlug) {
        const agentRow = await faSelect<{ id: string }>(
          'fa_agents', `slug=eq.${systemDecision.nomineeSlug}&select=id`,
        );
        if (agentRow[0]) {
          systemPositionId = await openSystemPosition({
            nomineeAgentId:   agentRow[0].id,
            nomineeAgentSlug: systemDecision.nomineeSlug,
            marketId,
            roundId,
            decision: systemDecision,
          }).catch((err) => {
            console.error('[RUN-ROUND] openSystemPosition error:', err?.message);
            return null;
          });
        }
      }
    }

    const positionsOpened = systemPositionId ? 1 : 0;

    return NextResponse.json({
      ok: true,
      roundId,
      total:            results.length,
      succeeded:        succeeded.length,
      failed:           failed.length,
      positions_opened: positionsOpened,
      system_decision: systemDecision ? {
        action:           systemDecision.action,
        aggregated_p:     systemDecision.aggregatedP,
        aggregated_edge:  systemDecision.aggregatedEdge,
        disagreement:     systemDecision.disagreement,
        long_votes:       systemDecision.longVotes,
        short_votes:      systemDecision.shortVotes,
        size_usd:         systemDecision.sizeUsd,
        reason:           systemDecision.reason,
      } : null,
      submissions: succeeded.map(r => ({
        agent:          r.agentSlug,
        probabilityYes: r.probabilityYes,
        action:         r.action,
        rationale:      r.rationaleShort,
        latencyMs:      r.latencyMs,
        costUsd:        r.costUsd,
      })),
      errors: failed.map(r => ({ agent: r.agentSlug, error: r.error })),
    });
  } catch (err: any) {
    console.error('[API/FORECAST/RUN-ROUND] Error:', err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
