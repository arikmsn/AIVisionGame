/**
 * POST /api/arena/tournament/[id]/round
 *
 * Run the next round of an ongoing tournament.
 *
 * The round number is determined automatically from state stored in the DB
 * (arena_tournaments.config_snapshot.roundsCompleted + 1). Call this endpoint
 * sequentially 20 times to complete a tournament.
 *
 * Body (all optional):
 *   {
 *     imageUrl?:   string   — skip fal.ai generation (use pre-generated URL)
 *     idiomId?:   number   — force a specific idiom (default: random unused)
 *     skipWarmup?: boolean  — skip model warm-up (faster for testing)
 *   }
 *
 * Response: TournamentRoundRunResult
 *   { tournamentId, roundNumber, totalRounds, roundsRemaining, isComplete,
 *     roundResult, leaderboard }
 *
 * maxDuration = 300s covers: warmup (5s) + 11 independent model loops (≤55s each,
 * in parallel), + DB writes. In practice 30-90s per round.
 */

import { NextRequest, NextResponse }  from 'next/server';
import { runTournamentRound }         from '@/lib/arena/tournament-orchestrator';

export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: tournamentId } = await params;
    if (!tournamentId) {
      return NextResponse.json({ error: 'Tournament ID required' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const { imageUrl, idiomId, skipWarmup } = body as {
      imageUrl?:   string;
      idiomId?:   number;
      skipWarmup?: boolean;
    };

    console.log(`[API/TOURNAMENT/ROUND] Tournament ${tournamentId} | skipWarmup=${skipWarmup ?? false}`);

    const result = await runTournamentRound(tournamentId, {
      imageUrl,
      idiomId,
      skipWarmup: skipWarmup === true,
    });

    if (!result) {
      return NextResponse.json({ error: 'Failed to run round — check tournament ID and server logs' }, { status: 500 });
    }

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[API/TOURNAMENT/ROUND] Unexpected error:', err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
