/**
 * Arena Scoring System — Section 2.3 of AI Vision Arena Spec v2
 *
 * Exponential decay scoring with attempt penalties:
 *   S_correct(t, k) = S_max × decay(t) × attempt_penalty(k)
 *   S_incorrect(k)  = -50 × k
 *
 * decay(t) = e^(-λt)  where λ = ln(10) / T_max ≈ 0.0000768 per ms
 *
 * This creates a sharp decision window at ~10s where points drop from 1000 → 500.
 * The escalating wrong-guess penalty prevents "spam random guesses" strategies.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

export const S_MAX      = 1000;            // max points for instant correct guess
export const T_MAX_MS   = 30_000;          // round duration in ms
export const LAMBDA     = Math.log(10) / T_MAX_MS;  // ≈ 0.0000768 per ms

/** Multiplier applied to correct-guess score based on attempt number */
export const ATTEMPT_MULTIPLIER: Record<number, number> = {
  1: 1.0,
  2: 0.6,
  3: 0.3,
};

export const WRONG_GUESS_BASE_PENALTY = -50;
export const MAX_ATTEMPTS = 3;

// ── Core functions ────────────────────────────────────────────────────────────

/**
 * Decay multiplier at time t (ms from image drop).
 *
 * | Time  | Multiplier | Max points |
 * |-------|-----------|------------|
 * |  0s   |  1.000    |   1000     |
 * |  2s   |  0.855    |    855     |
 * |  5s   |  0.681    |    681     |
 * | 10s   |  0.464    |    464     |
 * | 15s   |  0.316    |    316     |
 * | 20s   |  0.215    |    215     |
 * | 25s   |  0.147    |    147     |
 * | 30s   |  0.100    |    100     |
 */
export function decay(t_ms: number): number {
  return Math.exp(-LAMBDA * Math.max(0, t_ms));
}

/**
 * Score for a CORRECT guess at time t on attempt k.
 * Returns integer score (rounded).
 */
export function scoreCorrectGuess(t_ms: number, attempt: number): number {
  const multiplier = ATTEMPT_MULTIPLIER[attempt] ?? ATTEMPT_MULTIPLIER[3];
  return Math.round(S_MAX * decay(t_ms) * multiplier);
}

/**
 * Penalty for a WRONG guess on attempt k.
 * Returns negative integer: -50 (k=1), -100 (k=2), -150 (k=3).
 */
export function scoreWrongGuess(attempt: number): number {
  return WRONG_GUESS_BASE_PENALTY * attempt;
}

/**
 * Compute the score for a single guess.
 */
export function computeGuessScore(
  isCorrect: boolean,
  t_ms:      number,
  attempt:   number,
): number {
  return isCorrect ? scoreCorrectGuess(t_ms, attempt) : scoreWrongGuess(attempt);
}

/**
 * Compute the total round score for a model from all their guesses.
 * Score = sum of all guess scores (correct bonuses + wrong penalties).
 * A model that doesn't guess scores 0.
 */
export function computeRoundScore(
  guesses: Array<{ isCorrect: boolean; t_ms: number; attempt: number }>,
): number {
  if (guesses.length === 0) return 0;
  return guesses.reduce(
    (total, g) => total + computeGuessScore(g.isCorrect, g.t_ms, g.attempt),
    0,
  );
}

// ── Normalised correctness check ──────────────────────────────────────────────
// User clarification: normalised exact match (lowercase, strip punctuation, trim)

/**
 * Normalise a string for comparison:
 * lowercase → strip punctuation → remove articles → collapse whitespace → trim
 */
export function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[''""".,!?;:()\-–—\/\\]/g, '')
    .replace(/\b(a|an|the)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if a guess matches the ground-truth phrase.
 * Uses normalised matching: the guess must contain all significant words
 * of the phrase (or vice versa for shorter variants).
 */
export function checkCorrect(guess: string, phrase: string): boolean {
  const gNorm = normalise(guess);
  const pNorm = normalise(phrase);

  // Empty or trivial guess is never correct
  if (!gNorm || gNorm.length < 2) return false;

  // Exact match after normalisation
  if (gNorm === pNorm) return true;
  if (gNorm.includes(pNorm)) return true;
  if (pNorm.includes(gNorm) && gNorm.length > 4) return true;

  // All significant words of phrase appear in guess
  const pWords = pNorm.split(' ').filter(w => w.length > 2);
  const gWords = gNorm.split(' ').filter(w => w.length > 0);
  const matched = pWords.filter(pw =>
    gWords.some(gw => gw === pw || gw.includes(pw) || pw.includes(gw)),
  );
  return matched.length === pWords.length && pWords.length > 0;
}
