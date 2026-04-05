import { NextRequest, NextResponse, after } from 'next/server';
import Pusher from 'pusher';
import { updateGameState, getGameState, pickNextIdiomIndex, getFullGameState } from '@/lib/gameStore';
import { IDIOMS } from '@/lib/idioms-data';
import { runOrchestratorAsync } from '@/lib/agents/orchestrator';
import { upsertActiveRound } from '@/lib/db/rounds';

// Vercel Hobby tier defaults to 10s. start-round calls Fal.ai (up to 30s) so
// we need a higher ceiling. 60s is the maximum on Hobby; Pro allows 300s.
export const maxDuration = 60;

const FAL_KEY = process.env.FAL_KEY;
const TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 1000;
const FETCH_TIMEOUT_MS = 10000;
const MAX_RETRIES = 3;

async function fetchWithRetry(url: string, options: RequestInit, attempt = 1): Promise<Response> {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err: any) {
    const isNet = err?.cause?.code === 'EAI_AGAIN' || err?.code === 'EAI_AGAIN' || err?.message?.includes('EAI_AGAIN') || err?.message?.includes('fetch failed');
    if (isNet && attempt < MAX_RETRIES) {
      console.warn(`[START-ROUND] Network error attempt ${attempt}, retrying...`);
      await new Promise(r => setTimeout(r, 1000));
      return fetchWithRetry(url, options, attempt + 1);
    }
    if (isNet) { const e: any = new Error('DNS Resolution failed'); e.code = 'NETWORK_ERROR'; throw e; }
    throw err;
  }
}

const pusherServer = new Pusher({
  appId: process.env.PUSHER_APP_ID || '',
  key: process.env.PUSHER_KEY || '',
  secret: process.env.PUSHER_SECRET || '',
  cluster: process.env.PUSHER_CLUSTER || 'eu',
  useTLS: true,
});

// Idioms are now sourced from the curated database in @/lib/idioms-data.
// Do not add idioms here — add them to idioms-data.ts instead.

async function waitForFalResult(requestId: string): Promise<string> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < TIMEOUT_MS) {
    const statusRes = await fetchWithRetry(`https://queue.fal.run/fal-ai/fast-lightning-sdxl/requests/${requestId}/status`, {
      headers: { 'Authorization': `Key ${FAL_KEY}` },
    });

    if (!statusRes.ok) throw new Error(`Status check failed: ${statusRes.status}`);

    const statusData = await statusRes.json();
    if (statusData.status === 'COMPLETED') {
      const resultRes = await fetchWithRetry(`https://queue.fal.run/fal-ai/fast-lightning-sdxl/requests/${requestId}`, {
        headers: { 'Authorization': `Key ${FAL_KEY}` },
      });
      const result = await resultRes.json();
      return result.images?.[0]?.url || result.image?.url;
    }
    if (statusData.status === 'FAILED') throw new Error('Fal.ai image generation failed');
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error('Fal.ai request timed out');
}

// ── Per-room generation lock ────────────────────────────────────────────────
// Acquired synchronously (no await before the add) so two concurrent requests
// cannot both pass the gate and both call Fal.ai.
const generatingRooms = new Set<string>();

// A round is "active" for this many milliseconds after it starts.
const ROUND_TTL_MS = 60_000;

export async function POST(request: NextRequest) {
  let roomId = '';
  const callStart = Date.now(); // used to calculate remaining broadcast delay
  try {
    const body = await request.json();
    // Fall back to 'lobby' so a missing roomId never hard-errors — the room
    // will be created on first access rather than returning a 400.
    // Normalize roomId: consistent uppercase + trim so all instances key on
    // the same string regardless of how the caller formatted the value.
    roomId = (body.roomId || 'lobby').trim().toUpperCase();
    // When > 0, the game-started broadcast is held until max(0, delayBroadcastMs - generationTime) ms
    // after image generation completes, ensuring clients don't exit the winner overlay early.
    const delayBroadcastMs: number = body.delayBroadcastMs ?? 0;

    // ── GATE 1: Race-condition lock ──────────────────────────────────────────
    // If another request is already generating for this room, return the
    // partial/pending state immediately — do NOT call Fal.ai again.
    if (generatingRooms.has(roomId)) {
      console.log('[START-ROUND] 🔒 Generation in flight for room:', roomId, '— returning pending state');
      const pending = getGameState(roomId);
      return NextResponse.json({
        inProgress: true,
        generating: true,
        imageUrl: pending?.imageUrl ?? null,
        phase: pending?.phase ?? 'idle',
        state: pending,
      });
    }

    // ── GATE 2: Active-round TTL ─────────────────────────────────────────────
    // If the room already has a fresh round (started < 60 s ago), return it
    // unchanged — no Fal.ai call, same image for every client in the room.
    const existing = getGameState(roomId);
    if (
      existing?.phase === 'drawing' &&
      existing.roundStartTime &&
      Date.now() - existing.roundStartTime < ROUND_TTL_MS
    ) {
      console.log('[START-ROUND] ♻️ Active round within TTL — returning existing image for room:', roomId);
      return NextResponse.json({
        inProgress: true,
        imageUrl: existing.imageUrl,
        phase: existing.phase,
        state: existing,
      });
    }

    // ── Acquire the lock synchronously ──────────────────────────────────────
    // Everything below involves awaits; the lock prevents any second request
    // from reaching this line while we are mid-generation.
    generatingRooms.add(roomId);
    console.log('[START-ROUND] 🔑 Lock acquired for room:', roomId);

    // Pick next idiom from the room's shuffle deck (no repeats until all 100 shown)
    const idiomIndex = pickNextIdiomIndex(roomId, IDIOMS.length);
    const idiom = IDIOMS[idiomIndex];
    const prompt = idiom.visualPrompt;
    // Unique opaque ID for this round — clients use it as React key to bust image cache
    const roundId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    console.log('[START-ROUND] 🎨 Deck idx', idiomIndex, '→', idiom.he, '/', idiom.en);

    const submitRes = await fetchWithRetry('https://queue.fal.run/fal-ai/fast-lightning-sdxl', {
      method: 'POST',
      headers: { 'Authorization': `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, image_size: { width: 512, height: 512 } }),
    });

    if (!submitRes.ok) {
      return NextResponse.json({ error: 'FAL_SUBMIT_ERROR' }, { status: 500 });
    }

    const submitData = await submitRes.json();
    const requestId = submitData.request_id || submitData.id;
    const imageUrl = await waitForFalResult(requestId);

    // Persist state to store BEFORE broadcasting so late-joiners who poll /api/game/state
    // immediately get the correct image. roundStartTime is set inside fireBroadcast so it
    // captures the exact moment the Pusher event fires — clients receive t=0 = 1000 pts.
    updateGameState(roomId, {
      phase: 'drawing',
      imageUrl,
      secretPrompt: idiom.he,
      explanation: idiom.explanation,
      category: 'idiom',
      roundId,
      countdownActive: false,
      countdownSeconds: 5,
      winner: null,
      guesses: [],
    });

    // Cross-instance persistence: write to Supabase so cold Vercel instances
    // can serve /api/game/sync even if they didn't handle this start-round call.
    // Fire-and-forget — never blocks the broadcast path.
    upsertActiveRound({ roomId, roundId, phase: 'drawing', imageUrl, roundStartTime: null }).catch(() => {});

    // ── Kick off bot orchestration via after() ───────────────────────────────
    after(async () => {
      try {
        console.log('[START-ROUND] 🤖 [after] runOrchestratorAsync | roomId:', roomId, '| roundId:', roundId);
        const result = await runOrchestratorAsync(roomId, roundId);
        console.log('[START-ROUND] ✅ [after] done:', JSON.stringify(result));
      } catch (err: any) {
        console.error('[START-ROUND] ❌ [after] runOrchestratorAsync failed:', err?.message, '| stack:', err?.stack);
      }
    });

    // roundStartTime is captured inside fireBroadcast for maximum freshness.
    // For the delayed-broadcast path (delayBroadcastMs > 0) we write a preliminary
    // value to the store so the orchestrator / polling clients can see it immediately.
    let capturedRoundStartTime = 0;

    const gameStartedBase = {
      imageUrl,
      prompt:       idiom.he,
      promptEn:     idiom.en,
      category:     'idiom',
      roomId,
      explanation:  idiom.explanation,
      roundId,
    };

    const fireBroadcast = async () => {
      // Set roundStartTime at the last possible moment — right before the Pusher
      // event fires — so the client's 1000-pt decay timer starts from this instant.
      capturedRoundStartTime = Date.now();
      updateGameState(roomId, { roundStartTime: capturedRoundStartTime });
      // Update persisted row with the final roundStartTime so sync can compute timeLeft
      upsertActiveRound({ roomId, roundId, phase: 'drawing', imageUrl, roundStartTime: capturedRoundStartTime }).catch(() => {});
      const payload = { ...gameStartedBase, roundStartTime: capturedRoundStartTime };

      if (process.env.PUSHER_KEY && process.env.PUSHER_SECRET) {
        try {
          await pusherServer.trigger(`presence-${roomId}`, 'game-started', payload);
          console.log('[START-ROUND] ✅ game-started broadcast #1 → presence-' + roomId, '| image:', imageUrl.slice(0, 60));
        } catch (pusherErr: any) {
          console.error('[START-ROUND] Pusher error (first broadcast):', pusherErr.message);
        }
        // Second broadcast 500 ms later — catches late subscribers
        setTimeout(async () => {
          try {
            await pusherServer.trigger(`presence-${roomId}`, 'game-started', payload);
            console.log('[START-ROUND] ✅ game-started broadcast #2 (500ms) → presence-' + roomId);
          } catch { /* non-critical */ }
        }, 500);
      }
    };

    const elapsed = Date.now() - callStart;
    const remainingDelay = Math.max(0, delayBroadcastMs - elapsed);

    if (remainingDelay > 0) {
      // Preliminary roundStartTime for the response body and store
      capturedRoundStartTime = Date.now();
      updateGameState(roomId, { roundStartTime: capturedRoundStartTime });
      console.log(`[START-ROUND] ⏳ Image ready in ${elapsed}ms — holding broadcast for ${remainingDelay}ms more`);
      setTimeout(fireBroadcast, remainingDelay);
    } else {
      await fireBroadcast();
    }

    return NextResponse.json({
      success:      true,
      imageUrl,
      secret:       idiom.he,
      secretEn:     idiom.en,
      explanation:  idiom.explanation,
      category:     'idiom',
      roundStartTime: capturedRoundStartTime,
      roundId,
    });
  } catch (error: any) {
    console.error('[START-ROUND] Error:', error);

    // Reset phase to 'idle' so the next call can pass GATE 2 and retry cleanly.
    // Without this, a Fal.ai timeout leaves the room stuck in 'winner' or 'drawing'
    // forever — the state route signals needsNewRound but start-round's TTL guard
    // would block it because phase !== 'drawing' || roundStartTime is old.
    if (roomId) {
      updateGameState(roomId, { phase: 'idle', imageUrl: null });
      upsertActiveRound({ roomId, roundId: '', phase: 'idle', imageUrl: null, roundStartTime: null }).catch(() => {});

      // Notify connected clients so they can show a retry indicator immediately
      // instead of silently spinning until the poll wakeup fires.
      if (process.env.PUSHER_KEY && process.env.PUSHER_SECRET) {
        pusherServer.trigger(`presence-${roomId}`, 'round-error', {
          message: 'Image generation failed — retrying shortly',
          retryIn: 3,
        }).catch(() => {}); // fire-and-forget; non-fatal
      }
    }

    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    // Always release — even on error — so the room is unblocked for the next round.
    if (roomId) {
      generatingRooms.delete(roomId);
      console.log('[START-ROUND] 🔓 Lock released for room:', roomId);
    }
  }
}
