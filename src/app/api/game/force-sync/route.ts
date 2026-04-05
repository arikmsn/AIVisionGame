/**
 * POST /api/game/force-sync
 *
 * Manual diagnostic tool — pushes the current in-memory gameStore state
 * for a room directly to the Supabase active_rounds table.
 *
 * Use this when:
 *   • GET /api/game/sync returns phase:"idle" despite an active game
 *   • You want to confirm whether Supabase env vars are wired correctly
 *   • You need to unstick a room after a cold-start Vercel issue
 *
 * Also accepts a manual override payload so you can write arbitrary state
 * without needing the in-memory store to be warm.
 *
 * GET /api/game/force-sync?roomId=LOBBY_01
 *   → returns current in-memory state + what Supabase has for that room
 *
 * POST /api/game/force-sync
 *   { roomId, phase?, roundId?, imageUrl?, roundStartTime? }
 *   → upserts the provided (or in-memory) state to Supabase and returns
 *     a diagnostic summary
 *
 * This endpoint is intentionally unauthenticated (internal debug tool).
 * Remove or gate it behind a secret header before making the app public.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFullGameState } from '@/lib/gameStore';
import { upsertActiveRound, fetchActiveRound } from '@/lib/db/rounds';

// ── GET — diagnostic read ────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawRoomId = searchParams.get('roomId');

  if (!rawRoomId) {
    return NextResponse.json({ error: 'roomId required' }, { status: 400 });
  }

  const roomId = rawRoomId.trim().toUpperCase();

  const supabaseConfigured = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const localState = getFullGameState(roomId);
  const persisted  = await fetchActiveRound(roomId);

  return NextResponse.json({
    roomId,
    supabaseConfigured,
    localStore: {
      phase:          localState.phase,
      roundId:        localState.roundId || null,
      imageUrl:       localState.imageUrl ? localState.imageUrl.slice(0, 60) + '…' : null,
      roundStartTime: localState.roundStartTime,
    },
    supabaseRow: persisted
      ? {
          phase:          persisted.phase,
          roundId:        persisted.roundId || null,
          imageUrl:       persisted.imageUrl ? persisted.imageUrl.slice(0, 60) + '…' : null,
          roundStartTime: persisted.roundStartTime,
        }
      : null,
    diagnosis: buildDiagnosis(supabaseConfigured, localState.phase, persisted),
  });
}

// ── POST — force upsert ──────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  let body: Record<string, any> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rawRoomId = body.roomId;
  if (!rawRoomId) {
    return NextResponse.json({ error: 'roomId required' }, { status: 400 });
  }

  const roomId = String(rawRoomId).trim().toUpperCase();
  const supabaseConfigured = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Resolve row: explicit overrides win, fall back to in-memory store
  const localState = getFullGameState(roomId);

  const row = {
    roomId,
    roundId:        String(body.roundId        ?? localState.roundId        ?? ''),
    phase:          String(body.phase          ?? localState.phase          ?? 'idle'),
    imageUrl:       String(body.imageUrl       ?? localState.imageUrl       ?? '') || null,
    roundStartTime: Number(body.roundStartTime ?? localState.roundStartTime ?? 0)  || null,
  };

  console.log('[FORCE-SYNC] Manual upsert triggered:', row);

  const ok = await upsertActiveRound(row);

  // Read back what Supabase now has to confirm
  const readback = await fetchActiveRound(roomId);

  return NextResponse.json({
    roomId,
    supabaseConfigured,
    upsertSucceeded: ok,
    rowWritten: row,
    supabaseReadback: readback
      ? {
          phase:          readback.phase,
          roundId:        readback.roundId || null,
          imageUrl:       readback.imageUrl ? readback.imageUrl.slice(0, 60) + '…' : null,
          roundStartTime: readback.roundStartTime,
        }
      : null,
    message: ok
      ? `✅ Supabase active_rounds row updated for room "${roomId}"`
      : supabaseConfigured
        ? `❌ Upsert failed — check Vercel logs for [ROUNDS-DB] entries`
        : `⚠️  Supabase not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY`,
  });
}

// ── Helper ───────────────────────────────────────────────────────────────────

function buildDiagnosis(
  supabaseConfigured: boolean,
  localPhase: string,
  persisted: { phase: string } | null,
): string {
  if (!supabaseConfigured) {
    return '⚠️  SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — cross-instance fallback disabled. Sync will always return phase:idle on cold instances.';
  }
  if (localPhase !== 'idle' && persisted?.phase === 'idle') {
    return '⚠️  Local store has an active round but Supabase row is idle — the upsert from start-round did not complete. POST to this endpoint to force-fix.';
  }
  if (localPhase !== 'idle' && persisted?.phase === localPhase) {
    return '✅  Local store and Supabase are in sync.';
  }
  if (localPhase === 'idle' && persisted?.phase !== 'idle') {
    return `ℹ️  Local store is idle (cold instance) but Supabase has phase="${persisted?.phase}" — cross-instance fallback is working correctly.`;
  }
  if (localPhase === 'idle' && (!persisted || persisted.phase === 'idle')) {
    return 'ℹ️  Both local store and Supabase show idle — no active round has been started, or start-round ran on a separate Vercel instance AND the upsert failed. Start a round then re-check.';
  }
  return `phase mismatch: local="${localPhase}" supabase="${persisted?.phase}"`;
}
