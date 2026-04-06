/**
 * Tournament Orchestrator — Phase 2
 *
 * Manages the lifecycle of a 20-round tournament:
 *   startTournament  — creates DB record, builds stable player_id mapping
 *   runTournamentRound — loads state, runs one round, persists everything, saves state
 *
 * Architecture:
 *   • Client calls POST /api/arena/tournament       → startTournament
 *   • Client calls POST /api/arena/tournament/[id]/round × 20 → runTournamentRound
 *   • Each round call is stateless — state lives entirely in arena_tournaments.config_snapshot
 *   • Vercel maxDuration = 300s covers one round (warmup + 11 model loops)
 *
 * Player ID invariant:
 *   All model names are translated to player_1..player_11 before any context is sent.
 *   The mapping is fixed at tournament creation and stored in config_snapshot.
 */

import { ARENA_AGENTS }           from '@/lib/agents/dispatcher';
import { runArenaRound }           from './round-orchestrator';
import { updateStandings }         from './standings';
import {
  createTournament,
  loadTournamentState,
  saveTournamentState,
  persistStandingsSnapshot,
  persistContextSnapshots,
  finalizeTournament,
  updateTournamentCost,
  persistCostLog,
}                                  from '@/lib/db/tournament-persistence';
import { persistArenaRound }       from '@/lib/db/arena-results';
import { BENCHMARK_IDIOMS }        from '@/lib/benchmark/idioms';
import type { TournamentState }    from './standings';
import type { RoundResult }        from './round-orchestrator';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TournamentConfig {
  totalRounds?:  number;    // default 20
  skipWarmup?:   boolean;   // skip for local testing
  /** Phase 3: run batch ID (groups 50 tournaments together) */
  runId?:        string;
  /** Phase 3: per-tournament spend cap in USD (default $5) */
  budgetCapUsd?: number;
}

export interface TournamentStartResult {
  tournamentId: string;
  totalRounds:  number;
  playerCount:  number;
  playerIdMap:  Record<string, string>; // for admin inspection only — never sent to models
}

export interface TournamentRoundRunResult {
  tournamentId:    string;
  roundNumber:     number;
  totalRounds:     number;
  roundsRemaining: number;
  isComplete:      boolean;
  roundResult:     RoundResult | null;  // null only when tournament already complete
  leaderboard:     Array<{
    rank:        number;
    player_id:   string;
    model_id:    string;   // included in round result response (server-side summary)
    label:       string;
    total_score: number;
    rounds_won:  number;
    rounds_correct: number;
  }>;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a new tournament and return the tournament ID.
 * Should be called once before the first round.
 */
export async function startTournament(
  config: TournamentConfig = {},
): Promise<TournamentStartResult | null> {
  const { totalRounds = 20 } = config;
  const agents = ARENA_AGENTS;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`[TOURNAMENT] Starting new tournament | ${agents.length} models | ${totalRounds} rounds`);
  console.log(`${'='.repeat(80)}\n`);

  const result = await createTournament(agents, totalRounds, config.runId, config.budgetCapUsd ?? 5.00);
  if (!result) {
    console.error('[TOURNAMENT] Failed to create tournament');
    return null;
  }

  const { tournamentId, state } = result;

  console.log('[TOURNAMENT] Player ID mapping:');
  for (const [modelId, playerId] of Object.entries(state.playerIdMap)) {
    console.log(`  ${playerId} → ${modelId}`);
  }

  return {
    tournamentId,
    totalRounds,
    playerCount:  agents.length,
    playerIdMap:  state.playerIdMap,
  };
}

/**
 * Run the next round of an ongoing tournament.
 *
 * Idempotent per round: loads state from DB, determines next round number,
 * picks an unused idiom, runs the round, persists everything, saves state.
 */
export async function runTournamentRound(
  tournamentId: string,
  options: { imageUrl?: string; idiomId?: number; skipWarmup?: boolean } = {},
): Promise<TournamentRoundRunResult | null> {

  // ── 1. Load tournament state ─────────────────────────────────────────────
  const state = await loadTournamentState(tournamentId);
  if (!state) {
    console.error(`[TOURNAMENT] Tournament ${tournamentId} not found`);
    return null;
  }

  const roundNumber = state.roundsCompleted + 1;

  if (roundNumber > state.totalRounds) {
    console.warn(`[TOURNAMENT] Tournament ${tournamentId} already complete (${state.roundsCompleted}/${state.totalRounds} rounds)`);
    return buildCompleteResult(tournamentId, state, null);
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`[TOURNAMENT] Round ${roundNumber}/${state.totalRounds} | tournament=${tournamentId}`);
  console.log(`${'='.repeat(80)}\n`);

  // ── 2. Select idiom (avoid repeats) ─────────────────────────────────────
  let idiom;
  if (options.idiomId != null) {
    idiom = BENCHMARK_IDIOMS.find(i => i.id === options.idiomId);
    if (!idiom) {
      console.error(`[TOURNAMENT] Idiom ID ${options.idiomId} not found`);
      return null;
    }
  } else {
    const available = BENCHMARK_IDIOMS.filter(i => !state.usedIdiomIds.includes(i.id));
    if (available.length === 0) {
      console.warn('[TOURNAMENT] All idioms used — cycling from full set');
      state.usedIdiomIds = [];
      idiom = BENCHMARK_IDIOMS[Math.floor(Math.random() * BENCHMARK_IDIOMS.length)];
    } else {
      idiom = available[Math.floor(Math.random() * available.length)];
    }
  }

  console.log(`[TOURNAMENT] Idiom: "${idiom.phrase}" (id=${idiom.id}, difficulty=${idiom.difficulty})`);

  // ── 3. Resolve image URL ─────────────────────────────────────────────────
  let imageUrl = options.imageUrl;
  if (!imageUrl) {
    console.log(`[TOURNAMENT] Generating image via fal.ai...`);
    imageUrl = await generateImage(idiom.visualPrompt) ?? undefined;
    if (!imageUrl) {
      console.error('[TOURNAMENT] Image generation failed — aborting round');
      return null;
    }
    console.log(`[TOURNAMENT] Image: ${imageUrl.slice(0, 80)}...`);
  }

  // ── 4. Run the arena round with tournament context ───────────────────────
  const agents = ARENA_AGENTS;
  const roundResult = await runArenaRound({
    idiomId:    idiom.id,
    idiomPhrase: idiom.phrase,
    imageUrl,
    agents,
    skipWarmup: options.skipWarmup ?? false,
    tournament: {
      tournamentId,
      roundNumber,
      totalRounds:     state.totalRounds,
      tournamentState: state,
    },
  });

  // ── 5. Update standings in memory ───────────────────────────────────────
  updateStandings(state, roundResult);
  state.usedIdiomIds.push(idiom.id);

  // ── 6. Persist round results ─────────────────────────────────────────────
  // 6a. Core round data (rounds + players + guesses + timeline)
  await persistArenaRound(roundResult).catch(err =>
    console.error('[TOURNAMENT] persistArenaRound failed:', err?.message ?? err),
  );

  // 6b. Phase 3: Persist cost log + update tournament accumulated cost
  const roundCostUsd = roundResult.models.reduce((sum, m) => sum + m.apiCostUsd, 0);
  if (roundCostUsd > 0) {
    const costLogEntries = roundResult.models
      .filter(m => m.inputTokensTotal > 0 || m.outputTokensTotal > 0)
      .map(m => ({
        roundId:      roundResult.roundId,
        modelId:      m.modelId,
        attemptNum:   m.attemptsUsed,
        inputTokens:  m.inputTokensTotal,
        outputTokens: m.outputTokensTotal,
        costUsd:      m.apiCostUsd,
      }));
    await Promise.all([
      persistCostLog(costLogEntries).catch(err =>
        console.error('[TOURNAMENT] persistCostLog failed:', err?.message ?? err),
      ),
      updateTournamentCost(tournamentId, roundCostUsd).catch(err =>
        console.error('[TOURNAMENT] updateTournamentCost failed:', err?.message ?? err),
      ),
    ]);
    console.log(`[TOURNAMENT] Round cost: $${roundCostUsd.toFixed(4)} | ${roundResult.models.length} models`);
  }

  // 6c. Context snapshots (stored in arena_round_timeline as 'context_snapshot' events)
  const contextSnapshots = roundResult.models
    .filter(m => m.contextSentJson && m.playerId)
    .map(m => ({
      modelId:     m.modelId,
      playerId:    m.playerId!,
      contextJson: m.contextSentJson!,
    }));

  if (contextSnapshots.length > 0) {
    await persistContextSnapshots(roundResult.roundId, contextSnapshots).catch(err =>
      console.error('[TOURNAMENT] persistContextSnapshots failed:', err?.message ?? err),
    );
  }

  // 6c. Standings snapshot (one row per model per round)
  await persistStandingsSnapshot(state, roundNumber).catch(err =>
    console.error('[TOURNAMENT] persistStandingsSnapshot failed:', err?.message ?? err),
  );

  // ── 7. Save updated state to DB ──────────────────────────────────────────
  await saveTournamentState(state).catch(err =>
    console.error('[TOURNAMENT] saveTournamentState failed:', err?.message ?? err),
  );

  // ── 8. Finalize if last round ────────────────────────────────────────────
  if (state.roundsCompleted >= state.totalRounds) {
    await finalizeTournament(tournamentId).catch(err =>
      console.error('[TOURNAMENT] finalizeTournament failed:', err?.message ?? err),
    );
    console.log(`[TOURNAMENT] Tournament ${tournamentId} COMPLETE after ${state.roundsCompleted} rounds`);
  }

  return buildCompleteResult(tournamentId, state, roundResult);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildCompleteResult(
  tournamentId: string,
  state:        TournamentState,
  roundResult:  RoundResult | null,
): TournamentRoundRunResult {
  const agents       = ARENA_AGENTS;
  const roundNumber  = state.roundsCompleted;
  const isComplete   = roundNumber >= state.totalRounds;

  // Build admin leaderboard (includes actual model names for server-side logs)
  const leaderboard = Object.values(state.stats)
    .sort((a, b) => b.totalScore - a.totalScore)
    .map((s, idx) => {
      const agent = agents.find(a => a.modelId === s.modelId);
      return {
        rank:           idx + 1,
        player_id:      s.playerId,
        model_id:       s.modelId,
        label:          agent?.label ?? s.modelId,
        total_score:    s.totalScore,
        rounds_won:     s.roundsWon,
        rounds_correct: s.roundsCorrect,
      };
    });

  console.log('\n[TOURNAMENT] Current leaderboard:');
  for (const entry of leaderboard) {
    console.log(
      `  #${String(entry.rank).padStart(2)} ${entry.player_id.padEnd(10)} ` +
      `${String(entry.total_score).padStart(7)}pts | ` +
      `won=${entry.rounds_won} correct=${entry.rounds_correct} | ${entry.label}`,
    );
  }

  return {
    tournamentId,
    roundNumber,
    totalRounds:     state.totalRounds,
    roundsRemaining: Math.max(0, state.totalRounds - roundNumber),
    isComplete,
    roundResult,
    leaderboard,
  };
}

/** Generate an image for a visual prompt via fal.ai flux/schnell */
async function generateImage(visualPrompt: string): Promise<string | null> {
  const falKey = process.env.FAL_KEY;
  if (!falKey) {
    console.error('[TOURNAMENT] FAL_KEY not set — cannot generate images');
    return null;
  }
  try {
    const res = await fetch('https://fal.run/fal-ai/flux/schnell', {
      method:  'POST',
      headers: { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ prompt: visualPrompt, image_size: 'landscape_4_3', num_images: 1 }),
      signal:  AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.error(`[TOURNAMENT] fal.ai HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    return data.images?.[0]?.url ?? null;
  } catch (err: any) {
    console.error(`[TOURNAMENT] fal.ai error: ${err?.message}`);
    return null;
  }
}
