/**
 * Agent Performance Persistence — Supabase-compatible in-memory store.
 *
 * Schema mirrors the `agent_performance` Supabase table:
 *
 *   agent_performance (
 *     id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     agent_name    text NOT NULL,
 *     session_id    text NOT NULL,
 *     wins          int NOT NULL DEFAULT 0,
 *     total_guesses int NOT NULL DEFAULT 0,
 *     total_latency_ms bigint NOT NULL DEFAULT 0,
 *     failed_attempts  int NOT NULL DEFAULT 0,
 *     ser           float8 NOT NULL DEFAULT 0,
 *     updated_at    timestamptz DEFAULT now()
 *   )
 *
 * When SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are present, every write is
 * replicated to the real Supabase table via its REST API. The in-memory layer
 * always stays warm as a read-through cache.
 */

import { computeSER, serTier } from '@/lib/game/mechanics';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AgentPerformanceRow {
  agentName:      string;
  sessionId:      string;
  wins:           number;
  totalGuesses:   number;
  totalLatencyMs: number;
  failedAttempts: number;
  /** Computed and stored — primary leaderboard sort key */
  ser:            number;
  /**
   * PRD v5.0 — SER tier label for prestige display.
   * One of: 'ELITE' | 'COMPETITIVE' | 'LEARNING' | 'CALIBRATING'
   * Stored alongside SER so leaderboard can render prestige badges without
   * recomputing tier thresholds on the client.
   */
  serTierLabel:   string;
  updatedAt:      number;  // epoch ms
}

// ── Turbopack-safe singletons ─────────────────────────────────────────────────
// Next.js 16+ Turbopack re-evaluates modules per request in dev mode. Anchoring
// mutable singletons to globalThis ensures all route handlers share the same
// session ID and performance Map within a single Node.js process.
declare global {
  var __agentPerfStore:     Map<string, AgentPerformanceRow> | undefined;
  var __agentPerfSessionId: string                           | undefined;
}
if (!globalThis.__agentPerfStore)     globalThis.__agentPerfStore     = new Map();
if (!globalThis.__agentPerfSessionId) globalThis.__agentPerfSessionId = `session_${Date.now()}`;

// ── Session management ───────────────────────────────────────────────────────

export function getSessionId(): string {
  return globalThis.__agentPerfSessionId!;
}

export function rotateSession(): string {
  globalThis.__agentPerfSessionId = `session_${Date.now()}`;
  console.log('[PERF-DB] 🔄 New session:', globalThis.__agentPerfSessionId);
  return globalThis.__agentPerfSessionId;
}

// ── In-memory store ──────────────────────────────────────────────────────────

/** Keyed by `${sessionId}::${agentName}` */
const store: Map<string, AgentPerformanceRow> = globalThis.__agentPerfStore;

function rowKey(sessionId: string, agentName: string): string {
  return `${sessionId}::${agentName}`;
}

function getOrCreate(sessionId: string, agentName: string): AgentPerformanceRow {
  const key = rowKey(sessionId, agentName);
  if (!store.has(key)) {
    store.set(key, {
      agentName,
      sessionId,
      wins:           0,
      totalGuesses:   0,
      totalLatencyMs: 0,
      failedAttempts: 0,
      ser:            0,
      serTierLabel:   'CALIBRATING',
      updatedAt:      Date.now(),
    });
  }
  return store.get(key)!;
}

// ── Supabase replication (optional) ─────────────────────────────────────────

async function replicateToSupabase(row: AgentPerformanceRow): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  try {
    await fetch(`${url}/rest/v1/agent_performance`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':         key,
        'Authorization': `Bearer ${key}`,
        'Prefer':        'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        agent_name:       row.agentName,
        session_id:       row.sessionId,
        wins:             row.wins,
        total_guesses:    row.totalGuesses,
        total_latency_ms: row.totalLatencyMs,
        failed_attempts:  row.failedAttempts,
        ser:              row.ser,
        ser_tier:         row.serTierLabel,
        updated_at:       new Date(row.updatedAt).toISOString(),
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err: any) {
    // Non-fatal — in-memory store is the source of truth during this process
    console.warn('[PERF-DB] Supabase replication failed:', err.message);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Record one guess event and recompute SER.
 * Call this after every guess (correct or incorrect).
 */
export async function upsertAgentPerformance(opts: {
  agentName:    string;
  sessionId?:   string;
  isCorrect:    boolean;
  solveTimeMs:  number;
}): Promise<AgentPerformanceRow> {
  const sid = opts.sessionId ?? globalThis.__agentPerfSessionId!;
  const row = getOrCreate(sid, opts.agentName);

  row.totalGuesses   += 1;
  row.totalLatencyMs += opts.solveTimeMs;
  if (opts.isCorrect) {
    row.wins += 1;
  } else {
    row.failedAttempts += 1;
  }

  // Recompute SER + prestige tier using mechanics.ts
  row.ser          = computeSER(row.wins, row.totalLatencyMs, row.failedAttempts);
  row.serTierLabel = serTier(row.ser).label;
  row.updatedAt    = Date.now();

  // Fire-and-forget to Supabase
  replicateToSupabase(row).catch(() => {});

  return { ...row };
}

/**
 * Get current performance for a specific agent in the current (or given) session.
 */
export function getAgentPerformance(agentName: string, sessionId?: string): AgentPerformanceRow | null {
  return store.get(rowKey(sessionId ?? globalThis.__agentPerfSessionId!, agentName)) ?? null;
}

/**
 * Get all agents ranked by SER descending (global leaderboard sort).
 */
export function getTopAgentsBySER(sessionId?: string): AgentPerformanceRow[] {
  const sid = sessionId ?? globalThis.__agentPerfSessionId!;
  return Array.from(store.values())
    .filter(r => r.sessionId === sid)
    .sort((a, b) => b.ser - a.ser);
}

/**
 * Get all performance records for the current session (for Analytics Terminal).
 */
export function getSessionPerformance(sessionId?: string): AgentPerformanceRow[] {
  const sid = sessionId ?? globalThis.__agentPerfSessionId!;
  return Array.from(store.values()).filter(r => r.sessionId === sid);
}

/**
 * Dump all records across all sessions (admin/debug use).
 */
export function getAllPerformanceRecords(): AgentPerformanceRow[] {
  return Array.from(store.values());
}
