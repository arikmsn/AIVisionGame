/**
 * Agent Strategy Profile — continuous self-correction engine (PRD v5.0).
 *
 * After every round the server runs a "Post-Round Review":
 *   • Computes the agent's net payoff (rewards − penalties) for the round
 *   • Evaluates whether the chosen strategy style was effective
 *   • Updates the agent's profile so the NEXT round's Battle Brief reflects
 *     what worked and what didn't
 *
 * The profile feeds back into the Battle Brief as a "Situational Directive" —
 * the agent receives an explicit instruction like:
 *   "Your last 2 rounds used 'Aggressive Blitzer' and resulted in a net payoff
 *   of −400. Switch to 'Calculated Observer' to improve SER."
 *
 * This creates a genuine learning loop without storing model weights — the
 * "learning" is prompt-engineering at runtime.
 */

import { IntelligenceEvent } from './config';
import { computeDecayedReward, C_FAIL, H_HINT } from '@/lib/game/mechanics';

// ── Types ─────────────────────────────────────────────────────────────────────

export type StrategyStyle =
  | 'Aggressive Blitzer'     // guess fast, exploit first-mover R_i advantage
  | 'Calculated Observer'    // wait for rival failures, prune before guessing
  | 'Adaptive Opportunist';  // responds to current score gap dynamically

export interface RoundOutcome {
  roundId:       string;
  style:         StrategyStyle;
  won:           boolean;
  netPayoff:     number;   // R_i gained − C_FAIL × failed_attempts − H_HINT × hintsUsed
  solveTimeMs:   number;   // 0 if didn't win
  failedAttempts: number;
  zleCount:      number;   // Zero-Learning Events committed
  hintsUsed:     number;   // Hints revealed this round (each costs H_HINT = 150 pts)
}

export interface StrategyProfile {
  agentName:            string;
  currentStyle:         StrategyStyle;
  /** Rolling net payoff over the last N rounds (positive = style working) */
  netPayoffRolling:     number;
  /** Consecutive rounds with positive net payoff under current style */
  streakPositive:       number;
  /** Consecutive rounds with negative net payoff */
  streakNegative:       number;
  history:              RoundOutcome[];
  roundsPlayed:         number;
  totalZLEsCommitted:   number;
  totalHintsUsed:       number;
  /**
   * The style that produced the highest average net payoff across all rounds.
   * null until at least one round is completed per style.
   */
  mostEffectiveStyle:   StrategyStyle | null;
}

// ── In-memory store ───────────────────────────────────────────────────────────
// Anchored to globalThis so Turbopack module re-evaluations don't wipe history.
declare global { var __strategyProfiles: Map<string, StrategyProfile> | undefined; }
if (!globalThis.__strategyProfiles) globalThis.__strategyProfiles = new Map();
const profiles: Map<string, StrategyProfile> = globalThis.__strategyProfiles;

const ROLLING_WINDOW = 4;  // how many rounds to average for style evaluation
/** Rotate style only after this many consecutive negative-payoff rounds.
 *  Positive value: agents build a track record before switching. */
const SWITCH_THRESHOLD = 2;

function defaultProfile(agentName: string): StrategyProfile {
  return {
    agentName,
    currentStyle:       'Aggressive Blitzer',
    netPayoffRolling:   0,
    streakPositive:     0,
    streakNegative:     0,
    history:            [],
    roundsPlayed:       0,
    totalZLEsCommitted: 0,
    totalHintsUsed:     0,
    mostEffectiveStyle: null,
  };
}

// ── Most-Effective Style computation ─────────────────────────────────────────

/**
 * Scan the history and return the StrategyStyle with the highest average
 * net payoff. Requires at least one completed round per style to qualify.
 * Returns null if no history exists yet.
 */
function computeMostEffectiveStyle(history: RoundOutcome[]): StrategyStyle | null {
  if (history.length === 0) return null;
  const payoffsByStyle = new Map<StrategyStyle, number[]>();
  for (const h of history) {
    const bucket = payoffsByStyle.get(h.style) ?? [];
    bucket.push(h.netPayoff);
    payoffsByStyle.set(h.style, bucket);
  }
  let best: StrategyStyle | null = null;
  let bestAvg = -Infinity;
  for (const [style, payoffs] of payoffsByStyle) {
    const avg = payoffs.reduce((a, b) => a + b, 0) / payoffs.length;
    if (avg > bestAvg) { bestAvg = avg; best = style; }
  }
  return best;
}

export function getStrategyProfile(agentName: string): StrategyProfile {
  if (!profiles.has(agentName)) profiles.set(agentName, defaultProfile(agentName));
  return profiles.get(agentName)!;
}

// ── Style selection logic ─────────────────────────────────────────────────────

/**
 * Determine the optimal next style based on recent history.
 *
 * Rules:
 *   - If current style worked for 3+ rounds: keep it
 *   - If negative streak ≥ SWITCH_THRESHOLD: rotate to next style
 *   - High ZLE rate → always switch to Calculated Observer (force pruning)
 */
function selectNextStyle(profile: StrategyProfile): StrategyStyle {
  const recent = profile.history.slice(-ROLLING_WINDOW);
  if (recent.length === 0) return 'Aggressive Blitzer';

  // High ZLE rate is a strong signal: this agent isn't using negative information
  const totalZle    = recent.reduce((s, r) => s + r.zleCount, 0);
  const zleRate     = totalZle / recent.length;
  if (zleRate >= 1) return 'Calculated Observer';

  // Switch if negative streak has hit threshold
  if (profile.streakNegative >= SWITCH_THRESHOLD) {
    const styles: StrategyStyle[] = [
      'Aggressive Blitzer', 'Calculated Observer', 'Adaptive Opportunist',
    ];
    const idx = styles.indexOf(profile.currentStyle);
    return styles[(idx + 1) % styles.length];
  }

  // Working well — stay the course
  return profile.currentStyle;
}

// ── Post-Round Review ─────────────────────────────────────────────────────────

/**
 * Called after every round for each registered agent.
 * Computes net payoff, updates rolling stats, and adapts style for next round.
 *
 * @param agentName   - The agent's display name
 * @param roundId     - The round that just ended
 * @param events      - All intelligence events from this round
 * @param won         - Did this agent win the round?
 * @param solveTimeMs - How long it took to win (0 if didn't win)
 * @param hintsUsed   - Number of hints revealed this round (each costs H_HINT = 150)
 */
export function runPostRoundReview(
  agentName:   string,
  roundId:     string,
  events:      IntelligenceEvent[],
  won:         boolean,
  solveTimeMs: number,
  hintsUsed:   number = 0,
): StrategyProfile {
  const profile = getStrategyProfile(agentName);
  const myEvents = events.filter(e => e.agentName === agentName);

  const failedAttempts  = myEvents.filter(e => !e.isCorrect).length;
  const zleCount        = myEvents.filter(e => e.zeroLearning).length;
  const reward          = won ? computeDecayedReward(solveTimeMs) : 0;
  const penalty         = failedAttempts * C_FAIL;
  const hintPenalty     = hintsUsed * H_HINT;
  const netPayoff       = reward - penalty - hintPenalty;

  const outcome: RoundOutcome = {
    roundId,
    style:         profile.currentStyle,
    won,
    netPayoff,
    solveTimeMs:   won ? solveTimeMs : 0,
    failedAttempts,
    zleCount,
    hintsUsed,
  };

  profile.history.push(outcome);
  if (profile.history.length > 20) profile.history.shift(); // cap at 20

  // Update rolling window stats
  const recent = profile.history.slice(-ROLLING_WINDOW);
  profile.netPayoffRolling = recent.reduce((s, r) => s + r.netPayoff, 0) / recent.length;

  if (netPayoff > 0) {
    profile.streakPositive += 1;
    profile.streakNegative  = 0;
  } else {
    profile.streakNegative += 1;
    profile.streakPositive  = 0;
  }

  profile.roundsPlayed       += 1;
  profile.totalZLEsCommitted += zleCount;

  // Adapt style for next round
  const nextStyle     = selectNextStyle(profile);
  const styleChanged  = nextStyle !== profile.currentStyle;
  if (styleChanged) {
    console.log(
      `[STRATEGY] 🔄 ${agentName} style switch: ${profile.currentStyle} → ${nextStyle} ` +
      `(netPayoff=${netPayoff}, streak−=${profile.streakNegative}, zle=${zleCount})`,
    );
  }
  profile.currentStyle        = nextStyle;
  profile.totalHintsUsed     += hintsUsed;
  profile.mostEffectiveStyle  = computeMostEffectiveStyle(profile.history);

  console.log(
    `[STRATEGY] 📊 ${agentName} post-round: won=${won} netPayoff=${netPayoff} ` +
    `hints=${hintsUsed} style=${profile.currentStyle} rolling=${profile.netPayoffRolling.toFixed(0)} ` +
    `bestStyle=${profile.mostEffectiveStyle ?? 'n/a'}`,
  );

  return { ...profile };
}

// ── Situational Directive (for Battle Brief) ──────────────────────────────────

/**
 * Build the "Situational Directive" injected into the Battle Brief.
 * Tells the agent how it's performing and what to do differently.
 */
export function buildSituationalDirective(agentName: string): string {
  const profile = getStrategyProfile(agentName);
  if (profile.roundsPlayed === 0) return '';

  const recent = profile.history.slice(-2);
  const trend  = profile.netPayoffRolling >= 0 ? '↑ trending positive' : '↓ trending negative';

  const lines: string[] = [
    `STRATEGY PROFILE UPDATE:`,
    `  Current style   : ${profile.currentStyle}`,
    `  Net payoff (avg): ${profile.netPayoffRolling.toFixed(0)} pts   ${trend}`,
    `  Rounds played   : ${profile.roundsPlayed}`,
    `  ZLEs committed  : ${profile.totalZLEsCommitted} (lower = better)`,
  ];

  if (profile.streakNegative >= 2) {
    lines.push(`  ⚠ WARNING: ${profile.streakNegative} consecutive negative-payoff rounds`);
    lines.push(`  → Switching to "${profile.currentStyle}" this round`);
    lines.push(`  → Focus on PRUNING before guessing. Do NOT repeat rival failures.`);
  } else if (profile.streakPositive >= 2) {
    lines.push(`  ✓ Style "${profile.currentStyle}" is working — ${profile.streakPositive} positive rounds`);
    lines.push(`  → Maintain this approach.`);
  }

  // Specific ZLE warning
  if (profile.totalZLEsCommitted > 0) {
    const zleRate = (profile.totalZLEsCommitted / profile.roundsPlayed).toFixed(2);
    lines.push(`  🚨 ZLE rate: ${zleRate}/round — you are repeatedly using eliminated concepts`);
    lines.push(`     Before every guess: verify your concept is NOT in the pruned set.`);
  }

  // ── Style-specific tactical reminder ─────────────────────────────────────
  const styleTactic: Record<string, string[]> = {
    'Aggressive Blitzer': [
      `  ⚡ BLITZ TACTIC: Strike IMMEDIATELY — first-mover R_i advantage is your weapon.`,
      `     Do NOT wait for rival failures. Speed beats information in this style.`,
      `     Accept the −200 risk. A fast correct guess at R_i=900 beats a slow one at R_i=500.`,
    ],
    'Calculated Observer': [
      `  🔭 CALC TACTIC: HOLD your first guess until at least ONE rival has failed.`,
      `     Each rival failure eliminates an entire semantic domain — free information.`,
      `     Only fire when you have ≥2 pruned concepts OR 35s have elapsed.`,
    ],
    'Adaptive Opportunist': [
      `  🎯 ADAPT TACTIC: React to the arena. Strike when prunedCount ≥ 1 OR R_i < 700.`,
      `     Monitor rival failures in real-time. One failure = one pruned domain = your edge.`,
      `     Balance speed and signal. Do not wait longer than 25s without guessing.`,
    ],
  };
  const tactics = styleTactic[profile.currentStyle];
  if (tactics) lines.push(...tactics);

  // Most-effective style note
  if (profile.mostEffectiveStyle && profile.mostEffectiveStyle !== profile.currentStyle) {
    lines.push(`  📈 BEST STYLE TO DATE: "${profile.mostEffectiveStyle}" yielded highest avg payoff`);
  }

  return lines.join('\n');
}

/** Get all profiles (for Research tab / admin view) */
export function getAllStrategyProfiles(): StrategyProfile[] {
  return Array.from(profiles.values());
}
