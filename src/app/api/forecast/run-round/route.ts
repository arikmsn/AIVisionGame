/**
 * POST /api/forecast/run-round
 *
 * Given a roundId, runs all active agents and captures submissions.
 * Protected by ADMIN_PASSWORD header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runAllAgentsOnRound } from '@/lib/forecast/runner';
import { faPatch } from '@/lib/forecast/db';

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

    // Mark round as running
    await faPatch('fa_rounds', { id: roundId }, { status: 'running' });

    const results = await runAllAgentsOnRound(roundId);

    // Mark round as completed (awaiting resolution)
    await faPatch('fa_rounds', { id: roundId }, { status: 'completed' });

    const succeeded = results.filter(r => r.success);
    const failed    = results.filter(r => !r.success);

    return NextResponse.json({
      ok: true,
      roundId,
      total:     results.length,
      succeeded: succeeded.length,
      failed:    failed.length,
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
