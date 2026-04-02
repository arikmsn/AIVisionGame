/**
 * Intelligence Broadcaster — shared core logic for recording and Pusher-pushing
 * every guess event.
 *
 * Both internal routes import this directly (no HTTP hop):
 *   • /api/game/broadcast-intelligence   — human / internal bot path
 *   • /api/v1/agent/submit               — external agent path
 *
 * Calling this directly (vs. fetch-to-self) guarantees the Pusher `intelligence-update`
 * event is fired and awaited BEFORE the calling route returns a response — critical in
 * serverless environments (Vercel) where fire-and-forget fetches can be cancelled
 * after the response is sent.
 */

import Pusher from 'pusher';
import { IntelligenceEvent } from '@/lib/agents/config';
import { computeDecayedReward } from '@/lib/game/mechanics';
import {
  recordIntelligenceEvent,
  getIntelligenceEvents,
  buildPruningSet,
  extractSemanticConcepts,
  updateAgentPerformance,
} from '@/lib/agents/strategy-engine';
import { upsertAgentPerformance } from '@/lib/db/agent-performance';
import { emitIntelUpdate } from '@/lib/agents/arena-events';
import { insertGuessEvent } from '@/lib/db/guesses';

// ── Pusher singleton (one per process) ───────────────────────────────────────
// Anchored to globalThis so Turbopack module re-evaluations don't destroy it.
declare global { var __pusherBroadcaster: Pusher | null | undefined; }

function getPusher(): Pusher | null {
  if (!process.env.PUSHER_KEY || !process.env.PUSHER_SECRET) return null;
  if (globalThis.__pusherBroadcaster === undefined) {
    globalThis.__pusherBroadcaster = new Pusher({
      appId:   process.env.PUSHER_APP_ID   || '',
      key:     process.env.PUSHER_KEY,
      secret:  process.env.PUSHER_SECRET,
      cluster: process.env.PUSHER_CLUSTER  || 'eu',
      useTLS:  true,
    });
  }
  return globalThis.__pusherBroadcaster;
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface BroadcastParams {
  roomId:           string;
  roundId:          string;
  agentName:        string;
  guess:            string;
  isCorrect:        boolean;
  solveTimeMs:      number;
  riskProfile:      string | null;
  potentialReward?: number;
  attemptNumber?:   number;
  rationale?:       string;
  isHuman?:         boolean;
  /**
   * Agent internal processing time in milliseconds.
   * • Internal bots:      LLM API call duration (measured in factory.ts)
   * • External agents:    Think time supplied by the agent in the request body
   * Stored in the `guesses` Supabase table for comparative telemetry.
   */
  latency_ms?:      number;
}

export interface BroadcastResult {
  zeroLearning:    boolean;
  prunedConcepts:  string[];
  totalEvents:     number;
  failedAgents:    string[];
  zleCount:        number;
  potentialReward: number;
}

// ── Core broadcaster ──────────────────────────────────────────────────────────

/**
 * Record one guess event, update all in-memory stores, emit the in-process
 * arena event, persist to Supabase, and trigger the Pusher `intelligence-update`
 * event — all in one awaited call.
 *
 * The Pusher trigger is the last async step so callers receive the response only
 * after the broadcast is confirmed (or gracefully failed).
 */
export async function broadcastIntelligenceEvent(
  params: BroadcastParams,
): Promise<BroadcastResult> {
  const {
    roomId, roundId, agentName, guess, isCorrect,
    solveTimeMs   = 0,
    riskProfile   = null,
    potentialReward: incomingReward,
    attemptNumber,
    rationale,
    isHuman       = false,
    latency_ms,
  } = params;

  const semanticCluster = extractSemanticConcepts(guess);
  const potentialReward = incomingReward ?? computeDecayedReward(solveTimeMs);

  // ── ZLE detection — must read prior events BEFORE recording this one ────────
  const priorEvents  = getIntelligenceEvents(roomId, roundId);
  const priorFailed  = priorEvents.filter(e => !e.isCorrect).map(e => e.guess);
  const priorPruned  = buildPruningSet(priorFailed);
  const zeroLearning = !isCorrect && priorPruned.length > 0
    && semanticCluster.some(c => priorPruned.includes(c));

  if (zeroLearning) {
    console.log(
      `[BROADCASTER] ⚠️  ZLE: ${agentName} "${guess}" overlaps ` +
      `pruned set [${priorPruned.slice(0, 3).join(', ')}]`,
    );
  }

  // ── Build the canonical intelligence event ────────────────────────────────
  const event: IntelligenceEvent = {
    roundId,
    agentName,
    guess,
    isCorrect,
    semanticCluster,
    timestamp:      Date.now(),
    solveTimeMs,
    riskProfile:    (riskProfile as IntelligenceEvent['riskProfile']) ?? null,
    zeroLearning,
    potentialReward,
    attemptNumber,
    rationale:      rationale ?? undefined,
    latency_ms,
  };

  // ── Record in in-memory intelligence store ────────────────────────────────
  recordIntelligenceEvent(roomId, event);

  // ── Update legacy strategy-engine perf record ─────────────────────────────
  if (riskProfile === 'aggressive' || riskProfile === 'defensive' || riskProfile === 'balanced') {
    updateAgentPerformance(agentName, isCorrect, solveTimeMs, riskProfile);
  }

  // ── Emit in-process arena event (zero-latency for orchestrate-bots loop) ──
  const allEventsNow    = getIntelligenceEvents(roomId, roundId);
  const allFailedNow    = allEventsNow.filter(e => !e.isCorrect).map(e => e.guess);
  const prunedNow       = buildPruningSet(allFailedNow);
  const failedAgentsNow = [...new Set(allEventsNow.filter(e => !e.isCorrect).map(e => e.agentName))];

  emitIntelUpdate({
    roomId, roundId, event,
    prunedConcepts: prunedNow,
    failedAgents:   failedAgentsNow,
    zleCount:       allEventsNow.filter(e => e.zeroLearning).length,
  });

  // ── Async DB persistence — fire-and-forget (never blocks the response) ─────
  upsertAgentPerformance({ agentName, isCorrect, solveTimeMs }).catch(() => {});

  insertGuessEvent({
    roomId, roundId, agentName, guess, isCorrect,
    solveTimeMs,
    latency_ms:      latency_ms ?? null,
    potentialReward,
    attemptNumber:   attemptNumber ?? null,
    zeroLearning:    zeroLearning ?? false,
    rationale:       rationale ?? null,
    isExternal:      !isHuman,
  }).catch(() => {});

  // ── Compute final pruning set for the Pusher payload ─────────────────────
  const allEvents      = getIntelligenceEvents(roomId, roundId);
  const failedGuesses  = allEvents.filter(e => !e.isCorrect).map(e => e.guess);
  const prunedConcepts = buildPruningSet(failedGuesses);
  const failedAgents   = [...new Set(allEvents.filter(e => !e.isCorrect).map(e => e.agentName))];
  const zleCount       = allEvents.filter(e => e.zeroLearning).length;

  // ── Pusher broadcast — AWAITED so the event fires before caller responds ──
  const pusher = getPusher();
  if (pusher) {
    try {
      await pusher.trigger(`presence-${roomId}`, 'intelligence-update', {
        event,
        prunedConcepts,
        totalEvents: allEvents.length,
        failedAgents,
        zleCount,
      });
    } catch (pusherErr: any) {
      // Non-fatal — analytics data is advisory, not game-critical
      console.warn('[BROADCASTER] Pusher error (non-fatal):', pusherErr.message);
    }
  }

  return {
    zeroLearning,
    prunedConcepts,
    totalEvents:     allEvents.length,
    failedAgents,
    zleCount,
    potentialReward,
  };
}
