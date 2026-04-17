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
import { openPosition } from '@/lib/forecast/positions';

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

    const positionResults: Array<{
      agent: string;
      positionId: string | null;
      side?: string;
    }> = [];

    if (marketId && marketPrice > 0) {
      for (const sub of succeeded) {
        if (!sub.submissionId || sub.probabilityYes == null) continue;

        // Load agent DB row
        const agents = await faSelect<{ id: string }>(
          'fa_agents', `slug=eq.${sub.agentSlug}&select=id`,
        );
        if (!agents[0]) continue;
        const agentId = agents[0].id;

        // Load wallet balance
        const wallets = await faSelect<{ paper_balance_usd: number }>(
          'fa_agent_wallets', `agent_id=eq.${agentId}&select=paper_balance_usd`,
        );
        const walletBalance = wallets[0] ? Number(wallets[0].paper_balance_usd) : 10000;

        const positionId = await openPosition({
          agentId,
          agentSlug:      sub.agentSlug,
          marketId,
          roundId,
          submissionId:   sub.submissionId,
          agentProbYes:   sub.probabilityYes,
          marketPrice,
          walletBalance,
        }).catch((err) => {
          console.error(`[RUN-ROUND] openPosition error for ${sub.agentSlug}:`, err?.message);
          return null;
        });

        positionResults.push({
          agent:      sub.agentSlug,
          positionId,
        });
      }
    }

    const positionsOpened = positionResults.filter(p => p.positionId !== null).length;

    return NextResponse.json({
      ok: true,
      roundId,
      total:            results.length,
      succeeded:        succeeded.length,
      failed:           failed.length,
      positions_opened: positionsOpened,
      submissions: succeeded.map(r => ({
        agent:          r.agentSlug,
        probabilityYes: r.probabilityYes,
        action:         r.action,
        rationale:      r.rationaleShort,
        latencyMs:      r.latencyMs,
        costUsd:        r.costUsd,
      })),
      positions: positionResults,
      errors: failed.map(r => ({ agent: r.agentSlug, error: r.error })),
    });
  } catch (err: any) {
    console.error('[API/FORECAST/RUN-ROUND] Error:', err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
