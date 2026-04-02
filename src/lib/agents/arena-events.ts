/**
 * Arena Event Bus — in-process reactive signalling for the autonomous agent loop.
 *
 * Architecture:
 *   broadcast-intelligence/route.ts  ──emit──►  arenaEventBus
 *   orchestrate-bots/route.ts        ──listen─►  arenaEventBus
 *
 * Why in-process? Pusher is for client↔server. Within the same Node.js process,
 * a lightweight EventEmitter gives us zero-latency signal delivery — critical for
 * the "immediate opportunity assessment" trigger after any rival failure.
 *
 * Lifecycle:
 *   • `emitIntelUpdate`  — called by broadcast-intelligence after recording an event
 *   • `subscribeToIntel` — called by orchestrate-bots for each active round
 *   • `unsubscribeAll`   — called when a round ends or the lock is released
 *   • `emitRoundEnd`     — called when a round concludes (phase → winner)
 *   • `subscribeRoundEnd`— called by orchestrate-bots to trigger post-round review
 */

import { EventEmitter } from 'events';
import { IntelligenceEvent } from './config';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IntelUpdatePayload {
  roomId:         string;
  roundId:        string;
  event:          IntelligenceEvent;
  prunedConcepts: string[];
  failedAgents:   string[];
  zleCount:       number;
}

export interface RoundEndPayload {
  roomId:  string;
  roundId: string;
  winner:  string;
  secret:  string;
}

// ── Event Bus ─────────────────────────────────────────────────────────────────
// Anchored to globalThis so broadcast-intelligence and orchestrate-bots share
// the SAME EventEmitter instance even when Turbopack re-evaluates modules.

class ArenaEventBus extends EventEmitter {}

declare global { var __arenaEventBus: ArenaEventBus | undefined; }
if (!globalThis.__arenaEventBus) {
  const _bus = new ArenaEventBus();
  _bus.setMaxListeners(200);
  globalThis.__arenaEventBus = _bus;
}
export const arenaEventBus: ArenaEventBus = globalThis.__arenaEventBus;

// ── Channel name helpers ──────────────────────────────────────────────────────

export function intelChannel(roomId: string, roundId: string): string {
  return `intel:${roomId}:${roundId}`;
}

export function roundEndChannel(roomId: string, roundId: string): string {
  return `roundEnd:${roomId}:${roundId}`;
}

// ── Emit helpers ──────────────────────────────────────────────────────────────

/** Called by broadcast-intelligence after every recorded guess event */
export function emitIntelUpdate(payload: IntelUpdatePayload): void {
  arenaEventBus.emit(intelChannel(payload.roomId, payload.roundId), payload);
}

/** Called by orchestrate-bots (or validate) when a round concludes */
export function emitRoundEnd(payload: RoundEndPayload): void {
  arenaEventBus.emit(roundEndChannel(payload.roomId, payload.roundId), payload);
  // Clean up all listeners for this round channel to prevent memory leaks
  arenaEventBus.removeAllListeners(intelChannel(payload.roomId, payload.roundId));
  arenaEventBus.removeAllListeners(roundEndChannel(payload.roomId, payload.roundId));
}

// ── Subscribe helpers ─────────────────────────────────────────────────────────

/**
 * Subscribe to intelligence updates for a specific round.
 * Returns an unsubscribe function — call it when the agent is done.
 */
export function subscribeToIntel(
  roomId:  string,
  roundId: string,
  handler: (payload: IntelUpdatePayload) => void,
): () => void {
  const channel = intelChannel(roomId, roundId);
  arenaEventBus.on(channel, handler);
  return () => arenaEventBus.off(channel, handler);
}

/**
 * Subscribe to round-end events for post-round review.
 * Auto-unsubscribes after first call (rounds only end once).
 */
export function subscribeRoundEnd(
  roomId:  string,
  roundId: string,
  handler: (payload: RoundEndPayload) => void,
): () => void {
  const channel = roundEndChannel(roomId, roundId);
  arenaEventBus.once(channel, handler);
  return () => arenaEventBus.off(channel, handler);
}

/** Remove all event listeners for a given room/round (called on lock release) */
export function cleanupRound(roomId: string, roundId: string): void {
  arenaEventBus.removeAllListeners(intelChannel(roomId, roundId));
  arenaEventBus.removeAllListeners(roundEndChannel(roomId, roundId));
}
