/**
 * POST /api/game/orchestrate-bots
 *
 * Client-triggered fallback for bot orchestration.  Called by the browser
 * inside handleGameStarted() when the Pusher game-started event arrives.
 *
 * Because this request may land on a fresh Vercel serverless instance with no
 * in-memory game state, the client passes the full round data in the body so
 * this handler can reconstruct state via updateGameState() before calling the
 * orchestrator.
 *
 * Uses runOrchestratorAsync (await-based) so this function stays alive while
 * agents are guessing, rather than scheduling setTimeout callbacks that would
 * be discarded when the response is returned.
 */

import { NextRequest, NextResponse } from 'next/server';
import { updateGameState } from '@/lib/gameStore';
import { runOrchestratorAsync } from '@/lib/agents/orchestrator';

// Vercel Hobby tier defaults to 10s. Agents need up to 60s to complete.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      roomId,
      roundId,
      hints = [],
      // Optional full round data sent by the client so a fresh instance can
      // reconstruct in-memory state without relying on a shared store
      imageUrl,
      secretPrompt,
      roundStartTime,
      explanation,
      category,
    } = body as {
      roomId:          string;
      roundId:         string;
      hints?:          string[];
      imageUrl?:       string;
      secretPrompt?:   string;
      roundStartTime?: number;
      explanation?:    string;
      category?:       string;
    };

    if (!roomId || !roundId) {
      return NextResponse.json({ error: 'roomId and roundId are required' }, { status: 400 });
    }

    // If the caller provides full round data, write it into this instance's
    // store so runOrchestratorAsync can find it via getGameState().
    if (imageUrl && secretPrompt && roundStartTime) {
      console.log(`[ORCHESTRATE-ROUTE] 🔄 Reconstructing state for room=${roomId} round=${roundId}`);
      updateGameState(roomId, {
        phase:           'drawing',
        imageUrl,
        secretPrompt,
        explanation:     explanation || '',
        category:        category || 'idiom',
        roundStartTime,
        roundId,
        countdownActive: false,
        countdownSeconds: 5,
        winner:          null,
      });
    }

    // await keeps this function alive for the full agent execution window
    const result = await runOrchestratorAsync(roomId, roundId, hints);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[ORCHESTRATE-ROUTE] Error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
