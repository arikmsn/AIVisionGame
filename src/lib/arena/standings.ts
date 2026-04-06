/**
 * Tournament Standings — Phase 2
 *
 * Manages per-model tournament stats and assembles the three context payload
 * sections that make Phase 2 interesting:
 *   • your_standing  — how YOU are doing in the tournament
 *   • tournament_leaderboard — ranked list of all players (player_id, never model names)
 *   • opponent_profiles — behavioural summaries of the other 10 players
 *
 * CRITICAL DESIGN INVARIANT:
 *   Actual model names are NEVER exposed in any context payload.
 *   Only player_1..player_N aliases are sent to models.
 *   The modelId ↔ playerId mapping lives server-side only.
 */

import type { AgentConfig } from '@/lib/agents/dispatcher';
import type { RoundResult }  from '@/lib/arena/round-orchestrator';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ModelTournamentStats {
  playerId:           string;     // 'player_1' … 'player_11'
  modelId:            string;     // actual model ID — server-side only, never sent to models
  totalScore:         number;
  roundsPlayed:       number;
  roundsCorrect:      number;
  roundsWon:          number;
  firstGuessTimesMs:  number[];   // tMsFromStart for each correct first-attempt guess
  recentScores:       number[];   // rolling last-5 round scores (for trend)
}

export interface TournamentState {
  tournamentId:      string;
  roundsCompleted:   number;
  totalRounds:       number;
  usedIdiomIds:      number[];    // idiom IDs already played — prevents repeats
  playerIdMap:       Record<string, string>; // modelId → playerId
  modelIdFromPlayer: Record<string, string>; // playerId → modelId
  stats:             Record<string, ModelTournamentStats>; // modelId → stats
}

// ── Context payload types (what models actually see) ──────────────────────────

export interface YourStanding {
  your_id:              string;
  rank:                 number;
  total_score:          number;
  rounds_played:        number;
  rounds_correct:       number;
  rounds_won:           number;
  avg_first_correct_ms: number | null;
}

export interface LeaderboardEntry {
  player_id:   string;
  total_score: number;
  rank:        number;
  rounds_won:  number;
  is_you:      boolean;
}

export interface OpponentProfile {
  player_id:            string;
  rounds_played:        number;
  accuracy:             number;
  avg_first_correct_ms: number | null;
  rounds_won:           number;
  note:                 string;
}

// ── Initialisation ────────────────────────────────────────────────────────────

/**
 * Create a brand-new tournament state with a stable, shuffled player_1..N mapping.
 *
 * Shuffle is deterministic from tournamentId so the mapping is fully reproducible
 * from the tournament record in the DB — no extra mapping table needed.
 */
export function initTournamentState(
  tournamentId: string,
  agents:       AgentConfig[],
  totalRounds:  number,
): TournamentState {
  const positions = Array.from({ length: agents.length }, (_, i) => i + 1);
  const shuffled  = deterministicShuffle(positions, tournamentId);

  const playerIdMap:       Record<string, string>              = {};
  const modelIdFromPlayer: Record<string, string>              = {};
  const stats:             Record<string, ModelTournamentStats> = {};

  agents.forEach((agent, idx) => {
    const playerId               = `player_${shuffled[idx]}`;
    playerIdMap[agent.modelId]   = playerId;
    modelIdFromPlayer[playerId]  = agent.modelId;
    stats[agent.modelId] = {
      playerId,
      modelId:           agent.modelId,
      totalScore:        0,
      roundsPlayed:      0,
      roundsCorrect:     0,
      roundsWon:         0,
      firstGuessTimesMs: [],
      recentScores:      [],
    };
  });

  return {
    tournamentId,
    roundsCompleted:   0,
    totalRounds,
    usedIdiomIds:      [],
    playerIdMap,
    modelIdFromPlayer,
    stats,
  };
}

/**
 * Deterministic Fisher-Yates shuffle seeded from a string.
 * Uses a simple LCG so it's fast and reproducible without external deps.
 */
function deterministicShuffle<T>(arr: T[], seed: string): T[] {
  const result = [...arr];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (Math.imul(hash, 31) + seed.charCodeAt(i)) | 0;
  }
  let state = Math.abs(hash) || 1;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    return (state >>> 0) / 4294967296;
  };
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ── Standings update ───────────────────────────────────────────────────────────

/**
 * Update tournament stats in-place after a round completes.
 * Called by the tournament orchestrator immediately after runArenaRound returns.
 */
export function updateStandings(state: TournamentState, roundResult: RoundResult): void {
  const winnerId = roundResult.winner?.modelId ?? null;

  for (const model of roundResult.models) {
    const s = state.stats[model.modelId];
    if (!s) continue; // model not in this tournament — skip

    s.roundsPlayed++;
    s.totalScore  += model.finalScore;
    s.recentScores = [...s.recentScores.slice(-4), model.finalScore]; // keep last 5

    if (model.isCorrect) {
      s.roundsCorrect++;
      // Record time-to-correct for first-attempt correct guesses only
      const firstCorrect = model.guesses.find(g => g.isCorrect && g.attempt === 1);
      if (firstCorrect) s.firstGuessTimesMs.push(firstCorrect.tMsFromStart);
    }

    if (winnerId && model.modelId === winnerId) s.roundsWon++;
  }

  state.roundsCompleted++;
}

// ── Context section builders ──────────────────────────────────────────────────

/** your_standing section for the querying model */
export function buildYourStanding(state: TournamentState, modelId: string): YourStanding {
  const s = state.stats[modelId];
  if (!s) throw new Error(`[STANDINGS] No stats for model "${modelId}"`);

  return {
    your_id:              s.playerId,
    rank:                 computeRank(state, modelId),
    total_score:          s.totalScore,
    rounds_played:        s.roundsPlayed,
    rounds_correct:       s.roundsCorrect,
    rounds_won:           s.roundsWon,
    avg_first_correct_ms: avgMs(s.firstGuessTimesMs),
  };
}

/** tournament_leaderboard — all players, ranked, with is_you flag */
export function buildLeaderboard(state: TournamentState, modelId: string): LeaderboardEntry[] {
  return Object.values(state.stats)
    .sort((a, b) => b.totalScore - a.totalScore)
    .map((s, idx) => ({
      player_id:   s.playerId,
      total_score: s.totalScore,
      rank:        idx + 1,
      rounds_won:  s.roundsWon,
      is_you:      s.modelId === modelId,
    }));
}

/** opponent_profiles — all players EXCEPT the querying model (10 entries for 11 models) */
export function buildOpponentProfiles(state: TournamentState, modelId: string): OpponentProfile[] {
  return Object.values(state.stats)
    .filter(s => s.modelId !== modelId)
    .sort((a, b) => a.playerId.localeCompare(b.playerId, undefined, { numeric: true }))
    .map(s => {
      const accuracy = s.roundsPlayed > 0 ? s.roundsCorrect / s.roundsPlayed : 0;
      return {
        player_id:            s.playerId,
        rounds_played:        s.roundsPlayed,
        accuracy:             Math.round(accuracy * 100) / 100,
        avg_first_correct_ms: avgMs(s.firstGuessTimesMs),
        rounds_won:           s.roundsWon,
        note:                 buildNote(s),
      };
    });
}

// ── Private helpers ────────────────────────────────────────────────────────────

function computeRank(state: TournamentState, modelId: string): number {
  const sorted = Object.values(state.stats).sort((a, b) => b.totalScore - a.totalScore);
  const idx    = sorted.findIndex(s => s.modelId === modelId);
  return idx === -1 ? 999 : idx + 1;
}

function avgMs(times: number[]): number | null {
  if (times.length === 0) return null;
  return Math.round(times.reduce((a, b) => a + b, 0) / times.length);
}

function buildNote(s: ModelTournamentStats): string {
  if (s.roundsPlayed === 0) return 'no data yet';
  const accuracy = s.roundsPlayed > 0 ? s.roundsCorrect / s.roundsPlayed : 0;
  const avg      = avgMs(s.firstGuessTimesMs);
  const parts: string[] = [];

  if      (accuracy >= 0.8) parts.push('high accuracy');
  else if (accuracy <= 0.3) parts.push('low accuracy');

  if (avg !== null) {
    if      (avg < 5_000)  parts.push('very fast');
    else if (avg < 12_000) parts.push('fast');
    else if (avg > 20_000) parts.push('slow');
  }

  if (s.roundsWon >= 3) parts.push('frequent winner');

  // Trend from recent scores
  if (s.recentScores.length >= 3) {
    const half  = Math.floor(s.recentScores.length / 2);
    const early = s.recentScores.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const late  = s.recentScores.slice(-half).reduce((a, b) => a + b, 0) / half;
    if      (late > early * 1.15) parts.push('improving');
    else if (late < early * 0.85) parts.push('declining');
  }

  return parts.length > 0 ? parts.join(', ') : 'average performance';
}
