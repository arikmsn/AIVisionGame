/**
 * POST /api/forecast/score-round
 *
 * Given roundId + outcome (boolean), scores all submissions.
 * Protected by ADMIN_PASSWORD header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { scoreRound } from '@/lib/forecast/scoring';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const password = request.headers.get('x-admin-password');
  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { roundId, outcome } = body as { roundId: string; outcome: boolean };

    if (!roundId) {
      return NextResponse.json({ error: 'roundId required' }, { status: 400 });
    }
    if (typeof outcome !== 'boolean') {
      return NextResponse.json({ error: 'outcome (boolean) required' }, { status: 400 });
    }

    const result = await scoreRound(roundId, outcome);

    return NextResponse.json({
      ok: true,
      roundId,
      outcome,
      scored: result.scored,
      errors: result.errors,
    });
  } catch (err: any) {
    console.error('[API/FORECAST/SCORE-ROUND] Error:', err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
