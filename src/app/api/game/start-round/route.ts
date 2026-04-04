import { NextRequest, NextResponse, after } from 'next/server';
import Pusher from 'pusher';
import { updateGameState, getGameState, pickNextIdiomIndex, getFullGameState } from '@/lib/gameStore';
import { IDIOMS } from '@/lib/idioms-data';
import { runOrchestratorAsync } from '@/lib/agents/orchestrator';

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
    roomId = body.roomId || 'lobby';
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

    // Single source-of-truth timestamp — used in both the store and the Pusher payload
    const roundStartTime = Date.now();

    // Persist to store BEFORE broadcasting so late-joiners who poll /api/game/state
    // immediately get the correct image.
    updateGameState(roomId, {
      phase: 'drawing',
      imageUrl,
      secretPrompt: idiom.he,
      explanation: idiom.explanation,
      category: 'idiom',
      roundStartTime,
      roundId,
      countdownActive: false,
      countdownSeconds: 5,
      winner: null,
      guesses: [],
    });

    // ── Kick off bot orchestration via after() ───────────────────────────────
    // `after()` tells Next.js / Vercel to keep this function instance alive
    // after the HTTP response is returned, for up to maxDuration (60s).
    // runOrchestratorAsync uses await-based sleep so the Promise stays pending
    // and the instance stays alive while agents are guessing — unlike the
    // previous setTimeout approach whose callbacks were discarded on response.
    after(async () => {
      try {
        console.log('[START-ROUND] 🤖 [after] runOrchestratorAsync | roomId:', roomId, '| roundId:', roundId);
        const result = await runOrchestratorAsync(roomId, roundId);
        console.log('[START-ROUND] ✅ [after] done:', JSON.stringify(result));
      } catch (err: any) {
        console.error('[START-ROUND] ❌ [after] runOrchestratorAsync failed:', err?.message, '| stack:', err?.stack);
      }
    });

    // Broadcast to every client in the room.
    // Store is already written above — polling clients will find it immediately.
    // We fire the Pusher event TWICE (primary + 500 ms follow-up) so late-subscribers
    // who missed the first delivery still receive the authoritative imageUrl.
    //
    // When delayBroadcastMs > 0 (prefetch path from validate), we hold the broadcast
    // until max(0, delayBroadcastMs - elapsed_generation_time) ms so the victory
    // countdown finishes before clients transition to the new round.
    if (process.env.PUSHER_KEY && process.env.PUSHER_SECRET) {
      const gameStartedPayload = {
        imageUrl,
        prompt: idiom.he,       // Hebrew secret — used for local match and display
        promptEn: idiom.en,     // English equivalent — enables bilingual guessing
        category: 'idiom',
        roomId,
        explanation: idiom.explanation,
        roundStartTime,
        roundId,                // cache-buster: clients use as React key on <img>
      };

      const fireBroadcast = async () => {
        try {
          await pusherServer.trigger(`presence-${roomId}`, 'game-started', gameStartedPayload);
          console.log('[START-ROUND] ✅ game-started broadcast #1 → presence-' + roomId, '| image:', imageUrl.slice(0, 60));
        } catch (pusherErr: any) {
          console.error('[START-ROUND] Pusher error (first broadcast):', pusherErr.message);
        }
        // Second broadcast 500 ms later — catches clients that subscribed during the first trigger
        setTimeout(async () => {
          try {
            await pusherServer.trigger(`presence-${roomId}`, 'game-started', gameStartedPayload);
            console.log('[START-ROUND] ✅ game-started broadcast #2 (500ms) → presence-' + roomId);
          } catch {
            // Non-critical — polling will cover any remaining stragglers
          }
        }, 500);
      };

      const elapsed = Date.now() - callStart;
      const remainingDelay = Math.max(0, delayBroadcastMs - elapsed);

      if (remainingDelay > 0) {
        console.log(`[START-ROUND] ⏳ Image ready in ${elapsed}ms — holding broadcast for ${remainingDelay}ms more`);
        setTimeout(fireBroadcast, remainingDelay);
      } else {
        await fireBroadcast();
      }
    }

    return NextResponse.json({
      success: true,
      imageUrl,
      secret: idiom.he,
      secretEn: idiom.en,
      explanation: idiom.explanation,
      category: 'idiom',
      roundStartTime,
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
