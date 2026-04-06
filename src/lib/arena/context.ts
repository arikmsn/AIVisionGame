/**
 * Context Layer — Section 3 of AI Vision Arena Spec v2
 *
 * Assembles the per-model JSON context payload sent on every model query.
 * Each model receives a personalised view with `is_you: true` on its own entry.
 *
 * Phase 1: simplified context (single round, no tournament standings).
 * Phase 2: full tournament context with opponent profiles.
 */

import {
  S_MAX,
  T_MAX_MS,
  MAX_ATTEMPTS,
  ATTEMPT_MULTIPLIER,
  WRONG_GUESS_BASE_PENALTY,
} from './scoring';

import type {
  TournamentState,
  YourStanding,
  LeaderboardEntry,
  OpponentProfile,
} from './standings';

import {
  buildYourStanding,
  buildLeaderboard,
  buildOpponentProfiles,
} from './standings';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PublicGuess {
  model:   string;
  guess:   string;
  t_ms:    number;
  attempt: number;
}

/** Phase 1 context — sent to each model on every query within a round */
export interface Phase1Context {
  meta: {
    protocol_version: string;
    round_id:         string;
  };
  current_round: {
    image_url:              string;
    idiom_language:         string;
    time_elapsed_ms:        number;
    time_remaining_ms:      number;
    your_model_name:        string;
    your_attempts_used:     number;
    your_attempts_remaining: number;
    public_guesses:         PublicGuess[];
  };
  game_rules: {
    max_points_per_round:            number;
    decay_formula:                   string;
    attempt_penalty:                 Record<string, number>;
    wrong_guess_penalty:             string;
    max_attempts_per_round:          number;
    round_duration_ms:               number;
    guesses_broadcast_immediately:   boolean;
    guesses_not_labeled_during_round: boolean;
  };
}

// ── Static game rules (never changes between queries) ─────────────────────────

const GAME_RULES: Phase1Context['game_rules'] = {
  max_points_per_round:            S_MAX,
  decay_formula:                   'e^(-λt) where λ=ln(10)/30000',
  attempt_penalty:                 { '1': ATTEMPT_MULTIPLIER[1], '2': ATTEMPT_MULTIPLIER[2], '3': ATTEMPT_MULTIPLIER[3] },
  wrong_guess_penalty:             `${WRONG_GUESS_BASE_PENALTY} × attempt_number`,
  max_attempts_per_round:          MAX_ATTEMPTS,
  round_duration_ms:               T_MAX_MS,
  guesses_broadcast_immediately:   true,
  guesses_not_labeled_during_round: true,
};

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * Build the Phase 1 context payload for a specific model.
 *
 * @param roundId       UUID of the current round
 * @param imageUrl      CDN URL of the round image
 * @param modelId       The model this context is for
 * @param attemptsUsed  How many attempts this model has used so far
 * @param tElapsedMs    Time elapsed since image drop (ms)
 * @param publicGuesses All public guesses submitted so far in this round
 */
// ── Phase 2: Tournament context ───────────────────────────────────────────────

const TOKEN_BUDGET_THRESHOLD = 6_000; // estimated tokens; triggers public_guesses truncation
const PUBLIC_GUESSES_FULL    = 10;
const PUBLIC_GUESSES_TRIMMED = 5;

/** Public guess as seen by models in Phase 2 (player_id, not model name) */
export interface Phase2PublicGuess {
  player_id: string;
  guess:     string;
  t_ms:      number;
  attempt:   number;
}

/** Full Phase 2 context payload — what each model receives in tournament mode */
export interface Phase2Context {
  meta: {
    protocol_version: string;
    round_id:         string;
    tournament_id:    string;
    round_number:     number;
    rounds_remaining: number;
  };
  current_round: {
    image_url:               string;
    idiom_language:          string;
    time_elapsed_ms:         number;
    time_remaining_ms:       number;
    your_attempts_used:      number;
    your_attempts_remaining: number;
    public_guesses:          Phase2PublicGuess[];
  };
  your_standing:         YourStanding;
  tournament_leaderboard: LeaderboardEntry[];
  opponent_profiles:     OpponentProfile[];
  game_rules:            Phase1Context['game_rules'];
}

/**
 * Build the Phase 2 tournament context payload for a specific model.
 *
 * Applies player_id translation (model names NEVER appear in output).
 * Enforces token budget: if estimated tokens > 6000, truncates public_guesses 10→5.
 *
 * @param roundId           UUID of the current round
 * @param imageUrl          CDN URL of the round image
 * @param modelId           The model this context is for
 * @param attemptsUsed      How many attempts this model has used so far
 * @param tElapsedMs        Time elapsed since image drop (ms)
 * @param publicGuesses     Shared public guesses — model field already player_id in tournament mode
 * @param tournamentState   Full tournament state (standings, player_id map, etc.)
 * @param roundNumber       Current round number (1-indexed)
 */
export function buildTournamentContext(params: {
  roundId:         string;
  imageUrl:        string;
  modelId:         string;
  attemptsUsed:    number;
  tElapsedMs:      number;
  publicGuesses:   PublicGuess[];   // .model is already player_id in tournament loops
  tournamentState: TournamentState;
  roundNumber:     number;
}): Phase2Context {
  const { roundId, imageUrl, modelId, attemptsUsed, tElapsedMs, publicGuesses, tournamentState, roundNumber } = params;
  const roundsRemaining = tournamentState.totalRounds - roundNumber; // rounds AFTER this one

  // Translate publicGuesses: .model → player_id (already translated in loop, just rename field)
  const allGuesses: Phase2PublicGuess[] = publicGuesses
    .slice(-PUBLIC_GUESSES_FULL)
    .map(g => ({ player_id: g.model, guess: g.guess, t_ms: g.t_ms, attempt: g.attempt }));

  const ctx: Phase2Context = {
    meta: {
      protocol_version: 'v2.0-phase2',
      round_id:         roundId,
      tournament_id:    tournamentState.tournamentId,
      round_number:     roundNumber,
      rounds_remaining: roundsRemaining,
    },
    current_round: {
      image_url:               imageUrl,
      idiom_language:          'English',
      time_elapsed_ms:         tElapsedMs,
      time_remaining_ms:       Math.max(0, T_MAX_MS - tElapsedMs),
      your_attempts_used:      attemptsUsed,
      your_attempts_remaining: MAX_ATTEMPTS - attemptsUsed,
      public_guesses:          allGuesses,
    },
    your_standing:          buildYourStanding(tournamentState, modelId),
    tournament_leaderboard: buildLeaderboard(tournamentState, modelId),
    opponent_profiles:      buildOpponentProfiles(tournamentState, modelId),
    game_rules:             GAME_RULES,
  };

  // ── Token budget check ────────────────────────────────────────────────────
  const estimatedTokens = Math.round(JSON.stringify(ctx).length / 4);
  if (estimatedTokens > TOKEN_BUDGET_THRESHOLD) {
    console.warn(
      `[CONTEXT] Token budget exceeded for ${modelId}: ~${estimatedTokens} tokens` +
      ` — truncating public_guesses ${PUBLIC_GUESSES_FULL}→${PUBLIC_GUESSES_TRIMMED}`,
    );
    ctx.current_round.public_guesses = allGuesses.slice(-PUBLIC_GUESSES_TRIMMED);
  }

  return ctx;
}

// ── Phase 1 context (unchanged below) ────────────────────────────────────────

export function buildPhase1Context(params: {
  roundId:        string;
  imageUrl:       string;
  modelId:        string;
  attemptsUsed:   number;
  tElapsedMs:     number;
  publicGuesses:  PublicGuess[];
}): Phase1Context {
  return {
    meta: {
      protocol_version: 'v2.0-phase1',
      round_id:         params.roundId,
    },
    current_round: {
      image_url:              params.imageUrl,
      idiom_language:         'English',
      time_elapsed_ms:        params.tElapsedMs,
      time_remaining_ms:      Math.max(0, T_MAX_MS - params.tElapsedMs),
      your_model_name:        params.modelId,
      your_attempts_used:     params.attemptsUsed,
      your_attempts_remaining: MAX_ATTEMPTS - params.attemptsUsed,
      public_guesses:         params.publicGuesses,
    },
    game_rules: GAME_RULES,
  };
}
