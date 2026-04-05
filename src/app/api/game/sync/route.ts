import { NextRequest, NextResponse } from 'next/server';
import Pusher from 'pusher';
import { updateGameState, addGuess, getFullGameState } from '@/lib/gameStore';
import { extractBearerToken, resolveAgentKey } from '@/lib/agents/api-keys';
import { fetchActiveRound } from '@/lib/db/rounds';
import type { GamePhase } from '@/context/GameContext';

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
  const rawRoomId = searchParams.get('roomId');

  if (!rawRoomId) {
    return NextResponse.json({ error: 'roomId required' }, { status: 400 });
  }

  // Normalize: trim + uppercase so external agents using lowercase room IDs
  // hit the same gameStore key as the frontend (which always uppercases).
  const roomId = rawRoomId.trim().toUpperCase();

  // Optional agent auth — resolves identity but does not gate access
  const token    = extractBearerToken(request.headers.get('Authorization'));
  const identity = token ? resolveAgentKey(token) : null;

  const localState = getFullGameState(roomId);
  console.log(`[SYNC] GET room="${roomId}" localPhase="${localState.phase}" roundId="${localState.roundId || 'none'}"`);

  // ── Cross-instance fallback ──────────────────────────────────────────────
  // On Vercel, each serverless invocation may run in a separate process with
  // an empty in-memory gameStore (cold instance). When local state is idle
  // we fall back to the shared active_rounds row persisted by start-round.
  let phase: GamePhase = localState.phase;
  let imageUrl         = localState.imageUrl;
  let roundId          = localState.roundId;
  let roundStartTime   = localState.roundStartTime;
  let guesses          = localState.guesses;

  if (phase === 'idle') {
    console.log(`[SYNC] Local store idle — attempting Supabase fallback for room="${roomId}"`);
    const persisted = await fetchActiveRound(roomId);
    if (persisted && persisted.phase !== 'idle') {
      console.log(`[SYNC] ✅ Cross-instance fallback OK room="${roomId}" phase="${persisted.phase}" round="${persisted.roundId}"`);
      // Cast is safe: persisted.phase comes from the same codebase that writes it
      phase          = persisted.phase as GamePhase;
      imageUrl       = persisted.imageUrl;
      roundId        = persisted.roundId;
      roundStartTime = persisted.roundStartTime;
      // guesses not persisted cross-instance — return empty (agents only need image + roundId)
      guesses        = [];
    } else {
      console.log(`[SYNC] ℹ️  Supabase also idle/empty for room="${roomId}" — returning idle`);
    }
  }

  const timeLeft = roundStartTime && phase === 'drawing'
    ? Math.max(0, ROUND_TTL_MS - (Date.now() - roundStartTime))
    : 0;

  return NextResponse.json({
    roomId,
    phase,
    imageUrl,
    roundId,
    roundStartTime,
    timeLeft,
    guessHistory: guesses.map(g => ({ player: g.playerName, text: g.text, timestamp: g.timestamp })),
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
    const { action, data } = body;
    const roomId: string = body.roomId ? String(body.roomId).trim().toUpperCase() : '';

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
