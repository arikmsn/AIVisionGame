/**
 * Reset Session — wipes all globalThis in-memory caches for a clean slate.
 * Development / admin use only. Safe to call before a Golden Round.
 */
import { NextResponse } from 'next/server';
import { clearPerRoundBuckets, clearRateBuckets } from '@/lib/security-guard';
import { clearSecretsCache } from '@/lib/db/agent-secrets';

export async function POST() {
  // ── Wipe strategy profiles ────────────────────────────────────────────────
  if (globalThis.__strategyProfiles) globalThis.__strategyProfiles.clear();

  // ── Wipe intelligence + performance stores ────────────────────────────────
  if (globalThis.__stratEnginePerf)  globalThis.__stratEnginePerf.clear();
  if (globalThis.__stratEngineIntel) globalThis.__stratEngineIntel.clear();

  // ── Wipe agent performance (SER leaderboard) ─────────────────────────────
  if (globalThis.__agentPerfStore) globalThis.__agentPerfStore.clear();
  // Rotate the session ID so SER history starts fresh
  globalThis.__agentPerfSessionId = `session_${Date.now()}`;

  // ── Wipe round management stores ─────────────────────────────────────────
  if (globalThis.__orchestratingRooms)   globalThis.__orchestratingRooms.clear();
  if (globalThis.__roundAgentStates)     globalThis.__roundAgentStates.clear();
  if (globalThis.__roundRevealedHints)   globalThis.__roundRevealedHints.clear();
  if (globalThis.__hintRevealInProgress) globalThis.__hintRevealInProgress.clear();

  // ── Wipe game state (rooms) ───────────────────────────────────────────────
  if (globalThis.__gameStore) {
    for (const key of Object.keys(globalThis.__gameStore)) {
      delete (globalThis.__gameStore as any)[key];
    }
  }

  // ── Remove all arena event listeners ─────────────────────────────────────
  if (globalThis.__arenaEventBus) globalThis.__arenaEventBus.removeAllListeners();

  // ── Wipe security rate-limit buckets ──────────────────────────────────────
  clearPerRoundBuckets();
  clearRateBuckets();

  // ── Invalidate agent secrets cache (picks up rotated secrets immediately) ─
  clearSecretsCache();

  console.log('[RESET] 🧹 Full session wipe complete — all caches cleared');

  return NextResponse.json({
    wiped: [
      'strategyProfiles', 'stratEnginePerf', 'stratEngineIntel',
      'agentPerfStore', 'agentPerfSessionId', 'orchestratingRooms',
      'roundAgentStates', 'roundRevealedHints', 'hintRevealInProgress',
      'gameStore', 'arenaEventBus listeners',
      'perRoundBuckets', 'rateBuckets', 'agentSecretsCache',
    ],
    newSessionId: globalThis.__agentPerfSessionId,
    timestamp: new Date().toISOString(),
  });
}
