/**
 * Intelligence Broadcast — distributes negative metadata to all active agents.
 *
 * Called after every guess (bot or human) to:
 *  1. Record the intelligence event in the strategy engine's in-memory store
 *  2. Compute the updated pruning set for this round
 *  3. Broadcast `intelligence-update` via Pusher so every client receives
 *     real-time strategic context
 *
 * All core logic lives in @/lib/agents/intelligence-broadcaster — imported
 * directly so the Pusher call is always awaited before this route responds.
 * Previously, orchestrate-bots fired these as fire-and-forget HTTP requests
 * which could be killed by Vercel before Pusher delivery was confirmed.
 *
 * External agents may POST with an `X-Agent-Signature` / `X-Agent-ID` header
 * pair to participate in the feed. Unsigned internal calls (from orchestrate-bots
 * and the game client) are accepted without a signature.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyHmacSignature, checkRateLimit } from '@/lib/security-guard';
import { broadcastIntelligenceEvent } from '@/lib/agents/intelligence-broadcaster';
import { getIntelligenceEvents, buildPruningSet } from '@/lib/agents/strategy-engine';

// ── POST — record and broadcast one intelligence event ────────────────────────
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    let body: {
      roomId: string;
      roundId: string;
      agentName: string;
      guess: string;
      isCorrect: boolean;
      solveTimeMs?: number;
      riskProfile?: string | null;
      roundStartTime?: number;
      potentialReward?: number;
      attemptNumber?: number;
      /** PRD v5.0 — required for all AI agent submissions (optional for human players) */
      rationale?: string;
      /** true when caller is a human player (exempts from rationale requirement) */
      isHuman?: boolean;
      /** PRD v6.0 — agent think time: LLM call duration for bots, external think time */
      latency_ms?: number;
    };

    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const {
      roomId, roundId, agentName, guess, isCorrect,
      solveTimeMs = 0, riskProfile = null,
      potentialReward,
      attemptNumber,
      rationale,
      isHuman = false,
      latency_ms,
    } = body;

    if (!roomId || !roundId || !agentName || guess == null) {
      return NextResponse.json(
        { error: 'Missing required fields: roomId, roundId, agentName, guess' },
        { status: 400 },
      );
    }

    // ── External agent path: HMAC verification + rate limiting ───────────────
    const extSig     = request.headers.get('x-agent-signature');
    const extId      = request.headers.get('x-agent-id');
    const isExternal = !!(extSig || extId);

    if (isExternal) {
      const webhookSecret = process.env.AGENT_WEBHOOK_SECRET;
      if (!webhookSecret) {
        return NextResponse.json(
          { error: 'External agent webhook not configured on this server' },
          { status: 503 },
        );
      }
      if (!extSig || !extId) {
        return NextResponse.json(
          { error: 'External agents must supply both X-Agent-ID and X-Agent-Signature' },
          { status: 401 },
        );
      }
      const valid = verifyHmacSignature(`${extId}:${rawBody}`, extSig, webhookSecret);
      if (!valid) {
        return NextResponse.json(
          { error: 'Signature mismatch — Sybil attack prevention active' },
          { status: 401 },
        );
      }
      const rl = checkRateLimit(extId);
      if (!rl.allowed) {
        return NextResponse.json(
          { error: 'Rate limit exceeded', retryAfterMs: 60_000 },
          { status: 429, headers: { 'Retry-After': '60', 'X-RateLimit-Remaining': '0' } },
        );
      }
    }

    // ── PRD v5.0: Rationale required for external AI agents ──────────────────
    if (isExternal && !isHuman && !rationale) {
      return NextResponse.json(
        {
          error:   'Missing Strategic Rationale',
          message: 'Coliseum Rules v5.0 §RATIONALE_REQUIREMENT: Every AI agent submission must include a "rationale" field.',
          code:    'MISSING_RATIONALE',
        },
        { status: 400 },
      );
    }

    // ── Core broadcast (shared module — awaited, Pusher guaranteed) ───────────
    const result = await broadcastIntelligenceEvent({
      roomId, roundId, agentName, guess, isCorrect,
      solveTimeMs, riskProfile,
      potentialReward,
      attemptNumber,
      rationale,
      isHuman,
      latency_ms,
    });

    return NextResponse.json({
      success:         true,
      prunedConcepts:  result.prunedConcepts,
      totalEvents:     result.totalEvents,
      zeroLearning:    result.zeroLearning,
      zleCount:        result.zleCount,
      potentialReward: result.potentialReward,
    });
  } catch (err: any) {
    console.error('[BROADCAST-INTEL] Error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── GET — retrieve the current intelligence state for a room/round ────────────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const roomId  = searchParams.get('roomId');
  const roundId = searchParams.get('roundId');

  if (!roomId || !roundId) {
    return NextResponse.json({ error: 'roomId and roundId are required' }, { status: 400 });
  }

  const events         = getIntelligenceEvents(roomId, roundId);
  const failedGuesses  = events.filter(e => !e.isCorrect).map(e => e.guess);
  const prunedConcepts = buildPruningSet(failedGuesses);

  return NextResponse.json({
    events,
    prunedConcepts,
    totalEvents: events.length,
  });
}
