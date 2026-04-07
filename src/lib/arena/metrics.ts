/**
 * Phase 3 Metrics — per-round computation
 *
 * Derives behavioural metrics from a completed ModelRoundResult:
 *   dnf                   — model produced no valid guesses (all errors/timeouts)
 *   firstAttemptAction    — whether first query was 'guess' or 'wait'
 *   mentionsStanding      — reasoning references rank/standing keywords
 *   standingActionRational — did the model act rationally given its standing?
 *
 * See spec Section 3.3 and Phase 2 analysis findings.
 */

// ── Standing keyword detector ──────────────────────────────────────────────────

/**
 * Keywords that indicate a model is referencing tournament standing context.
 * Calibrated against Phase 2 reasoning text samples.
 */
const STANDING_PATTERN = /\b(rank(?:ed|ing)?|standing|(?:in\s+)?last\s+place|(?:in\s+)?first\s+place|bottom\s*3|top\s*[123]|behind|ahead|lead(?:ing)?|trail(?:ing)?|point(?:s)?\s+(?:lead|deficit|gap|behind|ahead)|rounds?\s+remaining|final\s+round|tournament\s+(?:score|standing|rank|position))\b/i;

// ── Input type ─────────────────────────────────────────────────────────────────

/** Minimal shape of a guess record needed for metric computation */
export interface GuessForMetrics {
  attempt:      number;
  action:       'guess' | 'wait';
  isKeyMissing?: boolean;
  error?:       string;
}

// ── Core computation ───────────────────────────────────────────────────────────

export interface Phase3Metrics {
  /** True when the model produced zero valid guesses (all timeouts or API errors) */
  dnf: boolean;

  /** The action the model chose on its very first API call (null if no call was made) */
  firstAttemptAction: 'guess' | 'wait' | null;

  /**
   * True when reasoning_text contains explicit tournament standing keywords.
   * This is the "perception" signal — does the model acknowledge context?
   */
  mentionsStanding: boolean;

  /**
   * Whether the model's action was strategically rational given its standing.
   *
   *   Bottom 3 + mentions standing + guessed immediately → true  (correct urgency)
   *   Bottom 3 + mentions standing + waited             → false (Llama 4 Scout pattern)
   *   Top 2    + mentions lead    + waited/deliberate   → true  (correct patience)
   *   null when there's no standing mention, no tournament context, or ambiguous rank
   */
  standingActionRational: boolean | null;
}

/**
 * Compute Phase 3 metrics for a single model's round result.
 *
 * @param reasoning        Concatenated reasoning text from all attempts
 * @param guesses          Array of guess records (in attempt order)
 * @param attemptsUsed     Total attempts the model made
 * @param rankAtStart      Model's rank at round start (1=leader, 11=last).
 *                         Pass undefined for Phase 1 (no tournament context).
 * @param roundNumber      Current round number (1-indexed). Used for late-game DNF detection.
 * @param totalRounds      Total rounds in the tournament. Used for late-game DNF detection.
 */
export function computePhase3Metrics(
  reasoning:    string,
  guesses:      GuessForMetrics[],
  attemptsUsed: number,
  rankAtStart?: number,
  roundNumber?: number,
  totalRounds?: number,
): Phase3Metrics {

  // ── DNF ──────────────────────────────────────────────────────────────────────
  const dnf = attemptsUsed === 0 ||
    guesses.every(g => g.isKeyMissing || Boolean(g.error));

  // ── First attempt action ──────────────────────────────────────────────────────
  const firstGuess = guesses.find(g => g.attempt === 1);
  const firstAttemptAction: Phase3Metrics['firstAttemptAction'] =
    firstGuess ? firstGuess.action : null;

  // ── Mentions standing ─────────────────────────────────────────────────────────
  const mentionsStanding = STANDING_PATTERN.test(reasoning);

  // ── Standing action rational ──────────────────────────────────────────────────
  let standingActionRational: boolean | null = null;

  if (rankAtStart !== undefined) {
    const inBottom3  = rankAtStart >= 9;   // ranks 9, 10, 11 (of 11 players)
    const inTop2     = rankAtStart <= 2;

    // ── Case A: model took an explicit action ────────────────────────────────
    if (mentionsStanding && firstAttemptAction !== null) {
      const guessedFirst = firstAttemptAction === 'guess';
      if (inBottom3) {
        // Correct strategy: rush — every second = fewer points due to decay.
        standingActionRational = guessedFirst;
      } else if (inTop2) {
        // Leader can afford caution; any action is defensible.
        standingActionRational = true;
      }
      // Mid-table (3-8): strategy ambiguous. Leave null.
    }

    // ── Case B: model DNF'd while bottom-3 in the late game ─────────────────
    // DNF (no guesses at all) when trailing badly and the tournament is nearly
    // over is the worst possible strategic outcome — equivalent to passing when
    // you needed a Hail Mary. Count this as irrational.
    if (
      dnf &&
      inBottom3 &&
      roundNumber !== undefined &&
      totalRounds !== undefined &&
      roundNumber >= Math.floor(totalRounds * 0.8)  // final 20% of rounds (rounds 16-20 for a 20-round tournament)
    ) {
      standingActionRational = false;
    }
  }

  return { dnf, firstAttemptAction, mentionsStanding, standingActionRational };
}
