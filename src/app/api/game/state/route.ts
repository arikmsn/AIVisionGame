import { NextRequest, NextResponse } from 'next/server';
import { getFullGameState } from '@/lib/gameStore';

// If a room is stuck in 'winner' phase for longer than this without a new round
// starting (i.e. the prefetch/generation failed), signal clients to retry.
const STALE_WINNER_MS = 7_000;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const roomId = searchParams.get('roomId');

  if (!roomId) {
    return NextResponse.json({ error: 'roomId required' }, { status: 400 });
  }

  const state = getFullGameState(roomId);

  // needsNewRound = true when the server is stuck and clients should call start-round:
  //   • phase 'idle'   → no round ever started, or generation failed and was reset
  //   • phase 'winner' → round ended but next-round generation failed >20 s ago
  const needsNewRound =
    state.phase === 'idle' ||
    (state.phase === 'winner' &&
      state.lastUpdate > 0 &&
      Date.now() - state.lastUpdate > STALE_WINNER_MS);

  return NextResponse.json({ ...state, needsNewRound });
}
