/**
 * Game Theory Mechanics — Mathematical Payoff Engine (PRD v4.0)
 *
 * Implements:
 *   R_i(t, g) = P_max · e^(−λ·t)   if correct
 *             = −C                   if incorrect
 *
 * Where:
 *   P_max  = 1000   (maximum possible reward at t = 0)
 *   λ      = 0.05   (decay constant per second)
 *   C      = 200    (flat penalty for an incorrect guess)
 *
 * Decay characteristics:
 *   t =  0s → R = 1000
 *   t = 10s → R ≈  607
 *   t = 14s → R ≈  500  (half-life)
 *   t = 30s → R ≈  223
 *   t = 60s → R ≈   50
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum reward awarded for an instantaneous correct guess */
export const P_MAX   = 1_000;

/** Decay constant (per second) — controls how fast the reward erodes */
export const LAMBDA  = 0.05;

/** Flat penalty deducted for each incorrect guess */
export const C_FAIL  = 200;

/** Flat penalty deducted when a hint is revealed/used during a round.
 *  Reflects reliance on external aid vs pure visual-strategic inference. */
export const H_HINT  = 150;

/** Floor: reward never drops below this even after very long rounds */
export const R_FLOOR = 25;

// ── Core reward function ─────────────────────────────────────────────────────

/**
 * Compute the payoff R_i for a single guess.
 *
 * @param tElapsedMs   - Milliseconds since the round started
 * @param isCorrect    - Whether the guess is correct
 * @returns Positive integer reward or negative penalty
 */
export function computePayoff(tElapsedMs: number, isCorrect: boolean): number {
  if (!isCorrect) return -C_FAIL;
  return computeDecayedReward(tElapsedMs);
}

/**
 * Compute the current potential reward at a given elapsed time.
 * Safe to call on both server and client — pure math, no side effects.
 *
 * @param tElapsedMs - Milliseconds since the round started
 */
export function computeDecayedReward(tElapsedMs: number): number {
  const t = Math.max(0, tElapsedMs) / 1_000;  // convert to seconds
  const raw = P_MAX * Math.exp(-LAMBDA * t);
  return Math.max(R_FLOOR, Math.round(raw));
}

// ── Strategic Efficiency Ratio ───────────────────────────────────────────────

/**
 * Strategic Efficiency Ratio — the primary global leaderboard ranking metric.
 *
 * SER = Σ(correct_guesses) / (Σ(latency_s) × Σ(failed_attempts))
 *
 * Higher SER = more wins with less time and fewer wasted attempts.
 * Edge case: failed_attempts = 0 uses 1 as denominator (perfect play).
 *
 * Typical ranges:
 *   SER > 0.05   → elite
 *   SER 0.01–0.05 → competitive
 *   SER < 0.01   → learning
 */
export function computeSER(
  wins: number,
  totalLatencyMs: number,
  failedAttempts: number,
  /** Number of hints used across all rounds — each hint slightly lowers SER */
  totalHintsUsed: number = 0,
): number {
  if (wins === 0) return 0;
  const latencySeconds = Math.max(1, totalLatencyMs / 1_000);
  const failures       = Math.max(1, failedAttempts);
  // Each hint adds a 0.5-attempt equivalent to the denominator, penalising
  // external-aid reliance without catastrophically collapsing the ratio.
  const hintWeight     = totalHintsUsed * 0.5;
  const raw            = wins / (latencySeconds * (failures + hintWeight));
  return Math.round(raw * 100_000) / 100_000;  // 5 decimal places
}

/**
 * Classify a SER value into a human-readable tier.
 */
export function serTier(ser: number): { label: string; color: string } {
  if (ser >= 0.05) return { label: 'ELITE',        color: '#fbbf24' };
  if (ser >= 0.02) return { label: 'COMPETITIVE',  color: '#06b6d4' };
  if (ser >= 0.005) return { label: 'LEARNING',    color: '#a855f7' };
  return               { label: 'CALIBRATING',     color: '#4b5563' };
}

// ── Cumulative payoff ────────────────────────────────────────────────────────

/**
 * Compute the cumulative payoff from a sequence of events.
 * Correct guesses add decayed reward; failed guesses deduct C_FAIL.
 */
export function computeCumulativePayoff(
  events: Array<{ isCorrect: boolean; solveTimeMs: number }>,
): number {
  return events.reduce((total, ev) => total + computePayoff(ev.solveTimeMs, ev.isCorrect), 0);
}
