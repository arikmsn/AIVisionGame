import { NextRequest, NextResponse } from 'next/server';
import Pusher from 'pusher';
import { updateGameState, addGuess, getFullGameState } from '@/lib/gameStore';
import { extractBearerToken, resolveAgentKey } from '@/lib/agents/api-keys';

const ROUND_TTL_MS = 60_000;

/**
 * GET /api/game/sync?roomId=<id>
 *
 * State-recovery endpoint for external agents.
 * Returns the information needed to (re)join an active round:
 *   imageUrl, roundId, phase, timeLeft, guessHistory
 *
 * secretPrompt is NEVER returned — agents must guess from the image.
 * Authenticated agents (Bearer token) additionally get their resolved identity.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const roomId = searchParams.get('roomId');

  if (!roomId) {
    return NextResponse.json({ error: 'roomId required' }, { status: 400 });
  }

  // Optional agent auth — resolves identity but does not gate access
  const token    = extractBearerToken(request.headers.get('Authorization'));
  const identity = token ? resolveAgentKey(token) : null;

  const state = getFullGameState(roomId);
  const timeLeft = state.roundStartTime && state.phase === 'drawing'
    ? Math.max(0, ROUND_TTL_MS - (Date.now() - state.roundStartTime))
    : 0;

  return NextResponse.json({
    roomId,
    phase:        state.phase,
    imageUrl:     state.imageUrl,
    roundId:      state.roundId,
    roundStartTime: state.roundStartTime,
    timeLeft,
    guessHistory: state.guesses.map(g => ({ player: g.playerName, text: g.text, timestamp: g.timestamp })),
    ...(identity ? { agentName: identity.agentName, agentId: identity.agentId } : {}),
  });
}

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID || '',
  key: process.env.PUSHER_KEY || '',
  secret: process.env.PUSHER_SECRET || '',
  cluster: process.env.PUSHER_CLUSTER || 'eu',
  useTLS: true,
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { roomId, action, data } = body;

    if (!roomId || !action) {
      return NextResponse.json(
        { error: 'MISSING_PARAMS', message: 'roomId and action are required' },
        { status: 400 }
      );
    }

    console.log('[SYNC] Received:', { roomId, action, data });

    // Only the server (start-round, validate) may write phase to the store.
    // Clients use the sync route purely as a Pusher relay for UI-only events.
    switch (action) {
      case 'on-guess':
        addGuess(roomId, data);
        break;
      case 'on-image-update':
        // imageUrl writes still allowed (legacy path — start-round owns this now)
        updateGameState(roomId, { imageUrl: data.imageUrl });
        break;
      // 'on-phase-change' intentionally removed: clients NEVER write phase
    }

    if (process.env.PUSHER_KEY && process.env.PUSHER_SECRET) {
      const channel = `presence-${roomId}`;
      await pusher.trigger(channel, action, data);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[SYNC] Error:', error);
    return NextResponse.json(
      { error: 'SYNC_FAILED', message: error.message || 'Failed to sync' },
      { status: 500 }
    );
  }
}
