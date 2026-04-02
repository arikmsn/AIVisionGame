/**
 * Strategy Engine — Game Theory orchestration for the AI Arena.
 *
 * Implements the PRD v3.0 spec:
 *  • Risk/Defensive/Balanced profile computation (leaderboard-driven pacing)
 *  • Negative Information Filtering (semantic pruning of failed guesses)
 *  • Rival Competence Tracking (weight rival insights by their win-rate)
 *  • Latency Normalization (jitter buffer for network fairness)
 *  • Per-agent performance bookkeeping
 *
 * This module is SERVER-ONLY — never import it from client components.
 * Client-facing types (RiskProfile, IntelligenceEvent) live in config.ts.
 */

import { RiskProfile, IntelligenceEvent } from './config';

// ── Re-export shared types for convenience ───────────────────────────────────
export type { RiskProfile, IntelligenceEvent };

// ── Performance bookkeeping ──────────────────────────────────────────────────

export interface AgentPerformanceRecord {
  name: string;
  wins: number;
  attempts: number;
  /** Running average of solve times for correct guesses only (ms) */
  avgSolveTimeMs: number;
  /** Most recent risk profile used */
  riskProfile: RiskProfile;
}

// Anchored to globalThis — survives Turbopack module re-evaluations in Next.js 16+
declare global {
  var __stratEnginePerf:  Map<string, AgentPerformanceRecord> | undefined;
  var __stratEngineIntel: Map<string, IntelligenceEvent[]>    | undefined;
}
if (!globalThis.__stratEnginePerf)  globalThis.__stratEnginePerf  = new Map();
if (!globalThis.__stratEngineIntel) globalThis.__stratEngineIntel = new Map();
const performanceStore: Map<string, AgentPerformanceRecord> = globalThis.__stratEnginePerf;

export function updateAgentPerformance(
  name: string,
  won: boolean,
  solveTimeMs: number,
  riskProfile: RiskProfile,
): void {
  const prev = performanceStore.get(name) ?? { name, wins: 0, attempts: 0, avgSolveTimeMs: 0, riskProfile };
  const attempts = prev.attempts + 1;
  const wins     = prev.wins + (won ? 1 : 0);
  const avgSolveTimeMs = won && prev.attempts > 0
    ? Math.round((prev.avgSolveTimeMs * prev.wins + solveTimeMs) / wins)
    : won
    ? solveTimeMs
    : prev.avgSolveTimeMs;
  performanceStore.set(name, { name, wins, attempts, avgSolveTimeMs, riskProfile });
}

export function getAgentPerformance(name: string): AgentPerformanceRecord | null {
  return performanceStore.get(name) ?? null;
}

export function getAllPerformanceRecords(): AgentPerformanceRecord[] {
  return Array.from(performanceStore.values());
}

// ── Intelligence store ───────────────────────────────────────────────────────
// Keyed by `${roomId}:${roundId}`. Capped at 200 events per key.

const intelligenceStore: Map<string, IntelligenceEvent[]> = globalThis.__stratEngineIntel;
const STORE_CAP = 200;

export function recordIntelligenceEvent(roomId: string, event: IntelligenceEvent): void {
  const key    = `${roomId}:${event.roundId}`;
  const events = intelligenceStore.get(key) ?? [];
  events.push(event);
  if (events.length > STORE_CAP) events.splice(0, events.length - STORE_CAP);
  intelligenceStore.set(key, events);
}

export function getIntelligenceEvents(roomId: string, roundId: string): IntelligenceEvent[] {
  return intelligenceStore.get(`${roomId}:${roundId}`) ?? [];
}

// ── Semantic concept extraction ──────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have',
  'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'may', 'might', 'shall', 'can', 'this', 'that', 'it', 'its',
]);

export function extractSemanticConcepts(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[\u0591-\u05C7]/g, '')               // strip Hebrew niqqud
    .replace(/[^a-zA-Z\u0590-\u05FF\s]/g, ' ')    // keep letters + Hebrew
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Build the full pruning set from all failed guesses in the round.
 * Returns a deduplicated array of semantic concepts to avoid.
 */
export function buildPruningSet(failedGuesses: string[]): string[] {
  const concepts = new Set<string>();
  for (const g of failedGuesses) {
    for (const c of extractSemanticConcepts(g)) concepts.add(c);
  }
  return Array.from(concepts);
}

// ── Risk profile computation ─────────────────────────────────────────────────

/**
 * Determine a risk profile from leaderboard standing.
 *
 * Trailing  (gap to leader > 20 %)  → aggressive (fast, lower confidence)
 * Leading   (lead over #2 > 20 %)   → defensive  (wait, exploit failures)
 * Otherwise                          → balanced
 */
export function computeRiskProfile(
  agentScore: number,
  leaderScore: number,
  secondScore: number,
): RiskProfile {
  if (leaderScore === 0) return 'balanced';
  const gapToLeader   = (leaderScore - agentScore) / leaderScore;
  const leadOverSecond = agentScore > 0 && agentScore === leaderScore
    ? (agentScore - secondScore) / Math.max(agentScore, 1)
    : 0;

  if (gapToLeader > 0.20) return 'aggressive';
  if (leadOverSecond > 0.20) return 'defensive';
  return 'balanced';
}

// ── Think-time adjustment ────────────────────────────────────────────────────

/**
 * Returns a small random jitter (0–200 ms) to normalize network latency.
 * Prevents faster network connections from having an unfair first-mover edge.
 */
export function computeJitterMs(): number {
  return Math.floor(Math.random() * 200);
}

/**
 * Adjust a base think-time in milliseconds based on risk profile + jitter.
 *
 * Aggressive → 65 % of base (guess sooner, catch up)
 * Defensive  → 135 % of base (wait, exploit rival failures)
 * Balanced   → 100 % of base
 */
export function adjustThinkTime(baseMs: number, profile: RiskProfile, jitterMs: number): number {
  const mult = profile === 'aggressive' ? 0.65 : profile === 'defensive' ? 1.35 : 1.0;
  return Math.round(baseMs * mult) + jitterMs;
}

// ── Rival insights ───────────────────────────────────────────────────────────

/**
 * Build human-readable rival insight strings from recorded events.
 * Used to enrich the LLM strategy prompt with negative evidence.
 *
 * Weights rival intelligence by the rival's historical win-rate so that
 * failures by high-accuracy rivals carry more pruning weight.
 */
export function buildRivalInsights(events: IntelligenceEvent[], currentAgent: string): string[] {
  const failed = events.filter(e => !e.isCorrect && e.agentName !== currentAgent);
  if (failed.length === 0) return [];

  return failed.slice(-6).map(e => {
    const rival   = getAgentPerformance(e.agentName);
    const winRate = rival && rival.attempts > 0
      ? ((rival.wins / rival.attempts) * 100).toFixed(0) + '% win-rate rival'
      : 'rival';
    const cluster = e.semanticCluster.slice(0, 3).join(', ');
    return `${e.agentName} (${winRate}) tried "${e.guess}" → FAILED — prune cluster: [${cluster}]`;
  });
}

// ── Strategy reasoning string ────────────────────────────────────────────────

/**
 * Compose the strategy context paragraph injected into the agent LLM prompt.
 * The LLM uses this to avoid already-failed semantic paths and calibrate
 * its confidence threshold according to its leaderboard position.
 */
export function buildStrategyReasoning(opts: {
  profile: RiskProfile;
  prunedConcepts: string[];
  rivalInsights: string[];
  leaderboardPosition: number;
  totalPlayers: number;
}): string {
  const { profile, prunedConcepts, rivalInsights, leaderboardPosition, totalPlayers } = opts;

  const posLine = leaderboardPosition === 1
    ? `You are LEADING (rank 1 / ${totalPlayers}).`
    : `You are rank ${leaderboardPosition} / ${totalPlayers}.`;

  const profileLine =
    profile === 'aggressive' ? 'STRATEGY: AGGRESSIVE — guess quickly with lower confidence. Catching up requires bold moves.'
    : profile === 'defensive' ? 'STRATEGY: DEFENSIVE — exploit all available failure data. Only guess when confident; rivals are doing the elimination work for you.'
    : 'STRATEGY: BALANCED — moderate pacing, moderate confidence.';

  const pruneLines = prunedConcepts.length > 0
    ? `HARD CONSTRAINT — DO NOT guess anything semantically related to: ${prunedConcepts.join(', ')}. These have been conclusively ruled out by rival guesses.`
    : '';

  const rivalLines = rivalInsights.length > 0
    ? `Rival intelligence feed:\n${rivalInsights.map(r => `  • ${r}`).join('\n')}`
    : '';

  return [posLine, profileLine, pruneLines, rivalLines]
    .filter(Boolean)
    .join('\n');
}
