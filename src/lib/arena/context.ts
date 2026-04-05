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
