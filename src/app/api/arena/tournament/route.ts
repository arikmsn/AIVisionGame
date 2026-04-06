/**
 * POST /api/arena/tournament
 *
 * Create a new tournament session and return the tournament ID.
 * Call this once, then call POST /api/arena/tournament/[id]/round up to 20 times.
 *
 * Body (all optional):
 *   { totalRounds?: number }   — default 20
 *
 * Response:
 *   { tournamentId, totalRounds, playerCount, playerIdMap }
 *
 * playerIdMap is included in the response for server-side admin visibility only.
 * It maps actual model IDs to anonymised player_1..N aliases.
 */

import { NextRequest, NextResponse }  from 'next/server';
import { startTournament }            from '@/lib/arena/tournament-orchestrator';

export const maxDuration = 30; // just DB insert — very fast

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { totalRounds } = body as { totalRounds?: number };

    const result = await startTournament({ totalRounds });
    if (!result) {
      return NextResponse.json({ error: 'Failed to create tournament' }, { status: 500 });
    }

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[API/TOURNAMENT] Unexpected error:', err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
