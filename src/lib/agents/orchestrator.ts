/**
 * Bot Orchestrator — PRD v5.0: Autonomous Decision Loop.
 *
 * ═══ Architecture ═══════════════════════════════════════════════════════════
 *
 * The server is a PASSIVE PLATFORM. Agents are autonomous actors.
 * No hardcoded think-time delays. Timing emerges from:
 *   1. A small entry jitter (50–300 ms) to stagger initial Groq API calls
 *   2. Natural LLM response latency (~2–8 s per call)
 *   3. Strategic self-regulation via the Opportunity Assessment function
 *
 * Reactive Loop per agent:
 *   • Round starts  → fire initial guess after jitter
 *   • Any intel-update (rival failure) → Opportunity Assessment
 *     If assessment = "strike" → fire guess immediately
 *     If assessment = "wait"   → listen for next intel-update
 *   • On wrong guess → immediately re-assess after intel-update propagates
 *   • On correct or exhausted → mark complete, trigger Post-Round Review
 *
 * ═══ Opportunity Assessment ═════════════════════════════════════════════════
 *
 * Deterministic game-theory function — no LLM call needed:
 *   Aggressive Blitzer  → always strike immediately on any new intel
 *   Calculated Observer → wait until prunedCount ≥ 2 OR round is urgent (>20s)
 *   Adaptive Opportunist → strike if prunedCount ≥ 1 OR R_i < 700 (>5s elapsed)
 *
 * ═══ Post-Round Review ══════════════════════════════════════════════════════
 *
 * After each round, each agent's strategy profile is updated:
 *   netPayoff = (reward if won) − (C_FAIL × failed_attempts)
 *   Style evolution: if 2+ consecutive negative rounds → rotate to next style
 *
 * De-dup: orchestratingRooms Map (roomId → roundId) prevents duplicate scheduling.
 *
 * ═══ Invocation ═════════════════════════════════════════════════════════════
 *
 * Internally: import { runOrchestrator } from '@/lib/agents/orchestrator'
 *             and call synchronously — no HTTP round-trip.
 * Externally: POST /api/game/orchestrate-bots wraps runOrchestrator for
 *             manual debugging or future external triggers.
 */

import Pusher from 'pusher';
import { getGameState, getScoreboard, updateScore, updateGameState, addGuess } from '@/lib/gameStore';
import { findIdiomByHe } from '@/lib/idioms-data';
import { strictIdiomMatch, normalizeText } from '@/lib/game/idiom-match';
import { AGENT_REGISTRY, AgentConfig } from '@/lib/agents/config';
import { createAgentGuess, BattleBriefOptions } from '@/lib/agents/factory';
import {
  computeRiskProfile,
  computeJitterMs,
  buildPruningSet,
  buildRivalInsights,
  buildStrategyReasoning,
  getIntelligenceEvents,
} from '@/lib/agents/strategy-engine';
import { computeDecayedReward, P_MAX } from '@/lib/game/mechanics';
import { upsertAgentPerformance } from '@/lib/db/agent-performance';
import { broadcastIntelligenceEvent } from '@/lib/agents/intelligence-broadcaster';
import {
  subscribeToIntel,
  subscribeRoundEnd,
  cleanupRound,
  emitRoundEnd,
  IntelUpdatePayload,
} from '@/lib/agents/arena-events';
import {
  getStrategyProfile,
  runPostRoundReview,
  buildSituationalDirective,
  StrategyStyle,
} from '@/lib/agents/strategy-profile';

// ── Configuration ─────────────────────────────────────────────────────────────

export const MAX_ATTEMPTS    = 3;
/** Entry jitter range — just enough to stagger simultaneous API calls */
const JITTER_MIN_MS   = 50;
const JITTER_MAX_MS   = 300;
/** Urgency threshold: if R_i has decayed below this % of P_MAX, even observers strike */
const URGENCY_RI_PCT  = 0.70;
/** Urgency threshold: seconds by style before all strategies strike.
 *  Blitzer strikes fast; Observer waits for more signal; Opportunist in between. */
const URGENCY_SEC_BY_STYLE: Record<string, number> = {
  'Aggressive Blitzer':    15,
  'Calculated Observer':   35,
  'Adaptive Opportunist':  25,
};
/** Typing indicator fires this many ms before the actual LLM call begins */
const TYPING_LEAD_MS  = 800;
/** Maximum time (ms) a round is allowed to run before a timeout is declared */
const ROUND_TIMEOUT_MS = 30_000;

// ── Pusher ────────────────────────────────────────────────────────────────────

const pusherServer = new Pusher({
  appId:   process.env.PUSHER_APP_ID   || '',
  key:     process.env.PUSHER_KEY       || '',
  secret:  process.env.PUSHER_SECRET    || '',
  cluster: process.env.PUSHER_CLUSTER  || 'eu',
  useTLS:  true,
});

// ── Per-round agent state ─────────────────────────────────────────────────────

interface AgentRoundState {
  attemptsUsed:     number;
  ownFailedGuesses: string[];
  completed:        boolean;
  /** Guard: prevents two concurrent LLM calls for the same agent */
  isGuessing:       boolean;
}

// ── Turbopack-safe singletons ─────────────────────────────────────────────────
// In Next.js 16+ dev mode, Turbopack re-evaluates modules between requests.
// Anchoring to globalThis keeps these Maps/Sets alive across re-evaluations
// so the dedup guard, agent state, and hint locks all survive.
declare global {
  var __orchestratingRooms:   Map<string, string>                         | undefined;
  var __roundAgentStates:     Map<string, Map<string, AgentRoundState>>   | undefined;
  var __roundRevealedHints:   Map<string, string[]>                       | undefined;
  var __hintRevealInProgress: Set<string>                                 | undefined;
  var __roundAllGuesses:      Map<string, Set<string>>                    | undefined;
}
if (!globalThis.__orchestratingRooms)   globalThis.__orchestratingRooms   = new Map();
if (!globalThis.__roundAgentStates)     globalThis.__roundAgentStates     = new Map();
if (!globalThis.__roundRevealedHints)   globalThis.__roundRevealedHints   = new Map();
if (!globalThis.__hintRevealInProgress) globalThis.__hintRevealInProgress = new Set();
if (!globalThis.__roundAllGuesses)      globalThis.__roundAllGuesses      = new Map();

/** roomId::roundId → agentName → state */
const roundAgentStates:    Map<string, Map<string, AgentRoundState>> = globalThis.__roundAgentStates;
const roundRevealedHints:  Map<string, string[]>                     = globalThis.__roundRevealedHints;
const hintRevealInProgress: Set<string>                              = globalThis.__hintRevealInProgress;
const orchestratingRooms:  Map<string, string>                       = globalThis.__orchestratingRooms;
/** roomId::roundId → normalized guesses from ALL players for cross-agent dedup */
const roundAllGuesses:     Map<string, Set<string>>                  = globalThis.__roundAllGuesses;

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function rk(roomId: string, roundId: string): string {
  return `${roomId}::${roundId}`;
}

function getOrCreateAgentState(roomId: string, roundId: string, agentName: string): AgentRoundState {
  const key = rk(roomId, roundId);
  if (!roundAgentStates.has(key)) roundAgentStates.set(key, new Map());
  const map = roundAgentStates.get(key)!;
  if (!map.has(agentName)) {
    map.set(agentName, { attemptsUsed: 0, ownFailedGuesses: [], completed: false, isGuessing: false });
  }
  return map.get(agentName)!;
}

// ── Opportunity Assessment ────────────────────────────────────────────────────

/**
 * Deterministic game-theory decision: should this agent act right now?
 *
 * Based on the agent's current Strategy Style (from their profile) and
 * the live arena environment (pruned set size, elapsed time, R_i).
 *
 * No LLM call required — pure logic.
 */
function opportunityAssessment(
  style:        StrategyStyle,
  prunedCount:  number,
  tElapsedMs:   number,
  ri:           number,
  isRetry:      boolean,
): boolean {
  // Retries always fire — we already waited for the intel-update to propagate
  if (isRetry) return true;

  // Dynamic urgency: each style has a different patience threshold.
  const urgencySec = URGENCY_SEC_BY_STYLE[style] ?? 25;
  const isUrgent   = tElapsedMs / 1_000 > urgencySec || ri < P_MAX * URGENCY_RI_PCT;

  switch (style) {
    case 'Aggressive Blitzer':
      return true;

    case 'Calculated Observer':
      return prunedCount >= 2 || isUrgent;

    case 'Adaptive Opportunist':
      return prunedCount >= 1 || isUrgent;

    default:
      return true;
  }
}

// ── Submit guess ──────────────────────────────────────────────────────────────
// ── Round timeout ─────────────────────────────────────────────────────────────
// Fires when no player guesses correctly within ROUND_TIMEOUT_MS.
// Broadcasts round-solved with winner:null so every client shows the answer.

async function fireRoundTimeout(roomId: string, roundId: string): Promise<void> {
  const cur = getGameState(roomId);
  if (!cur || cur.roundId !== roundId || cur.phase !== 'drawing') return; // already won

  const secretPrompt = cur.secretPrompt ?? '';
  const hasPusher    = !!(process.env.PUSHER_KEY && process.env.PUSHER_SECRET);
  const scoreboard   = getScoreboard(roomId);

  console.log(`[ORCHESTRATE] ⏰ Round timeout — no winner after ${ROUND_TIMEOUT_MS / 1000}s room=${roomId} round=${roundId} secret="${secretPrompt}"`);

  updateGameState(roomId, { phase: 'winner', winner: null });

  if (hasPusher) {
    try {
      await pusherServer.trigger(`presence-${roomId}`, 'round-solved', {
        winner:      null,
        secret:      secretPrompt,
        timedOut:    true,
        points:      0,
        scoreboard,
        nextRoundIn: 5,
      });
      console.log(`[ORCHESTRATE] ⏰ round-solved(timeout) broadcast → presence-${roomId}`);
    } catch (err: any) {
      console.error('[ORCHESTRATE] timeout round-solved Pusher error:', err.message);
    }
    // Broadcast to global activity channel
    pusherServer.trigger('global-activity', 'arena-timeout', {
      roomId, secret: secretPrompt, timestamp: Date.now(),
    }).catch(() => {});
  }
}

// Direct in-process implementation — no HTTP self-ping to /api/game/validate.
// Replicates the full validate route logic:
//   1. strictIdiomMatch for correctness (pure, zero latency)
//   2. guess-made Pusher event (so clients see bot guesses in guess history)
//   3. On win: updateScore + round-solved Pusher + updateGameState(winner)

async function submitBotGuess(
  roomId:         string,
  roundId:        string,
  agentName:      string,
  guess:          string,
  secretPrompt:   string,
  language:       'he' | 'en',
  roundStartTime: number,
): Promise<{ isCorrect: boolean; solveTimeMs: number; isDuplicate?: boolean }> {
  const solveTimeMs = Date.now() - roundStartTime;
  try {
    // ── Cross-agent dedup ────────────────────────────────────────────────────
    const key      = rk(roomId, roundId);
    if (!roundAllGuesses.has(key)) roundAllGuesses.set(key, new Set());
    const guessSet = roundAllGuesses.get(key)!;
    const normGuess = normalizeText(guess);

    if (guessSet.has(normGuess)) {
      console.log(`[ORCHESTRATE] 🔄 ${agentName} duplicate guess "${guess}" (already guessed this round) — skipping`);
      return { isCorrect: false, solveTimeMs, isDuplicate: true };
    }
    guessSet.add(normGuess);

    // Look up the English equivalent for bilingual matching
    const idiomEntry = findIdiomByHe(secretPrompt);
    const secretEn   = idiomEntry?.en ?? null;

    const { isCorrect } = strictIdiomMatch(guess, secretPrompt, secretEn);
    console.log(`[ORCHESTRATE] 🤖 ${agentName} → "${guess}" ${isCorrect ? '✅' : '❌'}`);

    const channelName = `presence-${roomId}`;
    const hasPusher   = !!(process.env.PUSHER_KEY && process.env.PUSHER_SECRET);

    // Record in gameStore so human players and future agents see this guess
    addGuess(roomId, {
      id:         Date.now().toString(36) + Math.random().toString(36).slice(2),
      playerName: agentName,
      text:       guess,
      timestamp:  Date.now(),
    });

    // Always broadcast guess-made so human spectators see bot guesses live
    if (hasPusher) {
      pusherServer.trigger(channelName, 'guess-made', {
        player: agentName,
        guess,
        isCorrect,
      }).catch(() => {});
    }

    // On a correct guess: update scoreboard, fire round-solved, flip phase
    if (isCorrect && hasPusher) {
      const points     = computeDecayedReward(solveTimeMs);
      const scoreboard = updateScore(roomId, agentName, points, 1);
      try {
        await pusherServer.trigger(channelName, 'round-solved', {
          winner:     agentName,
          secret:     secretPrompt,
          points,
          scoreboard,
          nextRoundIn: 5,
        });
        console.log(`[ORCHESTRATE] 🏆 round-solved → ${channelName} | winner: ${agentName} | pts: ${points}`);
      } catch (pusherErr: any) {
        console.error(`[ORCHESTRATE] round-solved Pusher error:`, pusherErr.message);
      }
      // Broadcast win to global activity channel for cross-room live ticker
      pusherServer.trigger('global-activity', 'arena-win', {
        roomId, winner: agentName, secret: secretPrompt, points, timestamp: Date.now(),
      }).catch(() => {});
      updateGameState(roomId, { phase: 'winner', winner: agentName });
    } else if (hasPusher) {
      // Broadcast wrong guess to global activity ticker
      pusherServer.trigger('global-activity', 'arena-guess', {
        roomId, agentName, guess, isCorrect: false, timestamp: Date.now(),
      }).catch(() => {});
    }

    return { isCorrect, solveTimeMs };
  } catch (err: any) {
    console.error(`[ORCHESTRATE] submitBotGuess failed for ${agentName}:`, err.message, '| stack:', err?.stack);
    return { isCorrect: false, solveTimeMs };
  }
}

// ── Broadcast intelligence ────────────────────────────────────────────────────

async function broadcastIntelligence(opts: {
  roomId: string; roundId: string; agentName: string; guess: string;
  isCorrect: boolean; solveTimeMs: number; riskProfile: string;
  potentialReward?: number; attemptNumber?: number; rationale?: string;
  latency_ms?: number;
}): Promise<void> {
  try {
    await broadcastIntelligenceEvent(opts);
  } catch (err: any) {
    console.warn('[ORCHESTRATE] broadcastIntelligence error:', err.message);
  }
}

// ── Deadlock / hint reveal ────────────────────────────────────────────────────

async function checkAndRevealHint(roomId: string, roundId: string): Promise<void> {
  const key = rk(roomId, roundId);
  if (hintRevealInProgress.has(key)) return;

  const agentMap = roundAgentStates.get(key);
  if (!agentMap) return;

  const allFired = AGENT_REGISTRY.every(a => {
    const s = agentMap.get(a.name);
    return s && s.attemptsUsed >= 1;
  });
  if (!allFired) return;

  const state = getGameState(roomId);
  if (!state || state.roundId !== roundId || state.phase !== 'drawing' || !state.secretPrompt) return;

  hintRevealInProgress.add(key);
  console.log(`[ORCHESTRATE] 🔔 Deadlock detected for room ${roomId} — generating hint`);

  try {
    const language: 'he' | 'en' = /[\u0590-\u05FF]/.test(state.secretPrompt) ? 'he' : 'en';
    // Generate hint directly via Groq — no HTTP self-ping to /api/game/validate
    let hint = language === 'he' ? 'חשוב על ביטוי יומיומי' : 'Think about a common expression';
    if (process.env.GROQ_API_KEY) {
      try {
        const { Groq } = await import('groq-sdk');
        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
        const langInstruction = language === 'he' ? 'Respond in Hebrew. Keep it short (max 8 words).' : 'Keep it short (max 8 words).';
        const completion = await groq.chat.completions.create({
          model: 'llama3-8b-8192',
          messages: [
            { role: 'system', content: `You are a hint generator for a Hebrew idiom guessing game. ${langInstruction}` },
            { role: 'user', content: `Give a subtle hint for the idiom: "${state.secretPrompt}". Don't reveal the answer directly.` },
          ],
          max_tokens: 60,
          temperature: 0.7,
        });
        hint = completion.choices[0]?.message?.content?.trim() || hint;
      } catch (groqErr: any) {
        console.error(`[ORCHESTRATE] Groq hint generation failed:`, groqErr.message);
      }
    }

    roundRevealedHints.set(key, [hint]);
    console.log(`[ORCHESTRATE] 💡 Hint: "${hint}"`);

    if (process.env.PUSHER_KEY && process.env.PUSHER_SECRET) {
      await pusherServer.trigger(`presence-${roomId}`, 'hint-revealed', {
        hint, roundId, source: 'deadlock-break',
        message: language === 'he'
          ? '🤖 כל הסוכנים נתקעו — הנה רמז מהמערכת!'
          : '🤖 All agents are stuck — system hint revealed!',
      });
    }
  } catch (err: any) {
    console.error(`[ORCHESTRATE] Hint reveal failed:`, err.message);
    hintRevealInProgress.delete(key);
  }
}

// ── Core: execute one agent attempt ──────────────────────────────────────────

async function executeAgentAttempt(
  roomId:       string,
  roundId:      string,
  agent:        AgentConfig,
  initialHints: string[],
): Promise<void> {
  const cur = getGameState(roomId);
  if (!cur || cur.roundId !== roundId || cur.phase !== 'drawing') {
    console.log(`[ORCHESTRATE] ⏹ ${agent.name} aborted — round ended`);
    return;
  }

  const agentState = getOrCreateAgentState(roomId, roundId, agent.name);
  if (agentState.completed || agentState.isGuessing) return;

  const { imageUrl, secretPrompt, roundStartTime } = cur;
  if (!imageUrl || !secretPrompt || !roundStartTime) return;

  agentState.isGuessing  = true;
  const attemptNumber    = agentState.attemptsUsed + 1;
  const language: 'he' | 'en' = /[\u0590-\u05FF]/.test(secretPrompt) ? 'he' : 'en';
  const key              = rk(roomId, roundId);

  const events         = getIntelligenceEvents(roomId, roundId);
  const allFailed      = events.filter(e => !e.isCorrect).map(e => e.guess);
  const prunedConcepts = buildPruningSet(allFailed);
  const rivalInsights  = buildRivalInsights(events, agent.name);

  const scoreboard   = getScoreboard(roomId);
  const scores       = Object.values(scoreboard).map(s => s.score).sort((a, b) => b - a);
  const leaderScore  = scores[0] ?? 0;
  const secondScore  = scores[1] ?? 0;
  const agentScore   = scoreboard[agent.name]?.score ?? 0;
  const profile      = computeRiskProfile(agentScore, leaderScore, secondScore);

  const allPlayers    = Object.keys(scoreboard).length || AGENT_REGISTRY.length;
  const sortedPlayers = Object.entries(scoreboard).sort((a, b) => b[1].score - a[1].score);
  const rankIndex     = sortedPlayers.findIndex(([n]) => n === agent.name);
  const rank          = rankIndex === -1 ? allPlayers : rankIndex + 1;

  const strategyReasoning = buildStrategyReasoning({
    profile, prunedConcepts, rivalInsights,
    leaderboardPosition: rank, totalPlayers: allPlayers,
  });

  const tElapsedMs      = Date.now() - roundStartTime;
  const potentialReward = computeDecayedReward(tElapsedMs);
  const revealedHints   = roundRevealedHints.get(key) ?? [];

  const situationalDirective = buildSituationalDirective(agent.name);

  const allGuessesSoFar = getGameState(roomId)?.guesses?.map(g => g.text) ?? [];

  const battleBrief: BattleBriefOptions = {
    tElapsedMs,
    rivalFailures: events.filter(e => !e.isCorrect && e.agentName !== agent.name)
      .map(e => ({ agentId: e.agentName, guess: e.guess })),
    attemptsRemaining:   MAX_ATTEMPTS - attemptNumber,
    ownPreviousGuesses:  agentState.ownFailedGuesses,
    revealedHints:       revealedHints.length > 0 ? revealedHints : undefined,
    allGuessHistory:     allGuessesSoFar.length > 0 ? allGuessesSoFar : undefined,
  };

  const fullReasoning = situationalDirective
    ? `${strategyReasoning}\n\n${situationalDirective}`
    : strategyReasoning;

  console.log(
    `[ORCHESTRATE] 🧠 ${agent.name} attempt=${attemptNumber}/${MAX_ATTEMPTS} ` +
    `profile=${profile} rank=${rank}/${allPlayers} pruned=${prunedConcepts.length} ` +
    `R_i=${potentialReward} style=${getStrategyProfile(agent.name).currentStyle}`,
  );

  try {
    await pusherServer.trigger(`presence-${roomId}`, 'bot-typing', {
      agentName: agent.name, agentId: agent.id, attemptNumber,
    });
  } catch {}

  const ownAndAll = [...new Set([...allFailed, ...agentState.ownFailedGuesses])];
  let guess: string;
  let rationale: string;
  let llmLatencyMs: number | undefined;

  try {
    const result = await createAgentGuess(
      agent, imageUrl,
      [...initialHints, ...revealedHints],
      ownAndAll, language, fullReasoning, battleBrief,
    );
    guess         = result.guess;
    rationale     = result.rationale;
    llmLatencyMs  = result.latencyMs;
    console.log(
      `[ORCHESTRATE] 💡 ${agent.name} #${attemptNumber} → "${guess}" ` +
      `latency=${llmLatencyMs ?? '?'}ms | rationale="${rationale.slice(0, 60)}..."`,
    );
  } catch (err: any) {
    console.error(`[ORCHESTRATE] ${agent.name} LLM error:`, err.message);
    agentState.attemptsUsed += 1;
    agentState.isGuessing    = false;
    if (agentState.attemptsUsed >= MAX_ATTEMPTS) {
      agentState.completed = true;
      await checkAndRevealHint(roomId, roundId);
    }
    return;
  }

  const latest = getGameState(roomId);
  if (!latest || latest.roundId !== roundId || latest.phase !== 'drawing') {
    console.log(`[ORCHESTRATE] ⏹ ${agent.name} discarding — round ended during LLM call`);
    agentState.isGuessing = false;
    return;
  }

  const { isCorrect, solveTimeMs, isDuplicate } = await submitBotGuess(
    roomId, roundId, agent.name, guess, secretPrompt, language, roundStartTime,
  );

  // Duplicate guess — don't count as an attempt, just retry on next loop iteration
  if (isDuplicate) {
    agentState.isGuessing = false;
    return;
  }

  agentState.attemptsUsed += 1;
  agentState.isGuessing    = false;
  if (!isCorrect) agentState.ownFailedGuesses.push(guess);
  if (isCorrect || agentState.attemptsUsed >= MAX_ATTEMPTS) {
    agentState.completed = true;
  }

  upsertAgentPerformance({ agentName: agent.name, isCorrect, solveTimeMs }).catch(() => {});

  await broadcastIntelligence({
    roomId, roundId,
    agentName:       agent.name,
    guess,
    isCorrect,
    solveTimeMs,
    riskProfile:     profile,
    potentialReward: computeDecayedReward(solveTimeMs),
    attemptNumber,
    rationale,
    latency_ms:      llmLatencyMs,
  });

  const hintsUsed = roundRevealedHints.get(key)?.length ?? 0;

  if (isCorrect) {
    const allEvents = getIntelligenceEvents(roomId, roundId);
    runPostRoundReview(agent.name, roundId, allEvents, true, solveTimeMs, hintsUsed);
    emitRoundEnd({ roomId, roundId, winner: agent.name, secret: secretPrompt });
  } else if (agentState.completed) {
    setTimeout(() => {
      const allEvents   = getIntelligenceEvents(roomId, roundId);
      const hintsFinal  = roundRevealedHints.get(key)?.length ?? 0;
      runPostRoundReview(agent.name, roundId, allEvents, false, 0, hintsFinal);
      console.log(`[ORCHESTRATE] 📉 ${agent.name} post-round review (exhausted — ${allEvents.filter(e => e.agentName === agent.name).length} events, hints=${hintsFinal})`);
    }, 1_500);
  }

  if (!isCorrect) {
    setImmediate(() => checkAndRevealHint(roomId, roundId));
  }
}

// ── Reactive listener per agent ───────────────────────────────────────────────

function registerAgentReactiveLoop(
  roomId:       string,
  roundId:      string,
  agent:        AgentConfig,
  initialHints: string[],
): void {
  const agentProfile = getStrategyProfile(agent.name);

  setTimeout(async () => {
    const cur = getGameState(roomId);
    if (!cur || cur.roundId !== roundId || cur.phase !== 'drawing') return;
    try {
      await pusherServer.trigger(`presence-${roomId}`, 'bot-typing', {
        agentName: agent.name, agentId: agent.id, attemptNumber: 1,
      });
      console.log(`[ORCHESTRATE] ⌨️ ${agent.name} entry typing`);
    } catch {}
  }, Math.max(0, JITTER_MIN_MS - TYPING_LEAD_MS));

  const entryJitterMs = randInt(JITTER_MIN_MS, JITTER_MAX_MS);
  setTimeout(() => {
    executeAgentAttempt(roomId, roundId, agent, initialHints);
  }, entryJitterMs);

  const unsubscribeIntel = subscribeToIntel(roomId, roundId, (payload: IntelUpdatePayload) => {
    const agentState = getOrCreateAgentState(roomId, roundId, agent.name);
    if (agentState.completed || agentState.isGuessing) return;
    if (payload.event.agentName === agent.name) return;
    if (payload.event.isCorrect) return;

    const cur = getGameState(roomId);
    if (!cur || cur.roundId !== roundId || cur.phase !== 'drawing') {
      unsubscribeIntel();
      return;
    }

    const tElapsedMs   = cur.roundStartTime ? Date.now() - cur.roundStartTime : 0;
    const ri           = computeDecayedReward(tElapsedMs);
    const isRetry      = agentState.attemptsUsed > 0;

    const shouldStrike = opportunityAssessment(
      agentProfile.currentStyle,
      payload.prunedConcepts.length,
      tElapsedMs,
      ri,
      isRetry,
    );

    if (shouldStrike) {
      console.log(
        `[ORCHESTRATE] ⚡ ${agent.name} reacting to ${payload.event.agentName} failure ` +
        `(style=${agentProfile.currentStyle} pruned=${payload.prunedConcepts.length} R_i=${ri})`,
      );
      executeAgentAttempt(roomId, roundId, agent, initialHints);
    } else {
      console.log(
        `[ORCHESTRATE] 🕐 ${agent.name} observing (style=${agentProfile.currentStyle}, ` +
        `pruned=${payload.prunedConcepts.length} — waiting for more intel)`,
      );
    }
  });

  subscribeRoundEnd(roomId, roundId, (payload) => {
    unsubscribeIntel();
    const agentState = getOrCreateAgentState(roomId, roundId, agent.name);
    const won        = payload.winner === agent.name;
    if (!won) {
      const allEvents = getIntelligenceEvents(roomId, roundId);
      runPostRoundReview(agent.name, roundId, allEvents, false, 0);
    }
  });
}

// ── Async sleep helper ────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface OrchestratorResult {
  success:      boolean;
  scheduled?:   number;
  maxAttempts?: number;
  model?:       string;
  deduped?:     boolean;
  reason?:      string;
}

/**
 * Register all agents into the reactive loop for a round.
 *
 * This is a synchronous function — it schedules agent timers and listeners
 * via setTimeout/setImmediate and returns immediately.  All LLM work happens
 * asynchronously in those callbacks, so the caller is never blocked.
 *
 * Call sites:
 *   - start-round/route.ts  → direct import, no HTTP round-trip
 *   - orchestrate-bots/route.ts → thin HTTP wrapper for external debugging
 */
export function runOrchestrator(
  roomId:  string,
  roundId: string,
  hints:   string[] = [],
): OrchestratorResult {
  // Dedup — same round already registered
  if (orchestratingRooms.get(roomId) === roundId) {
    console.log(`[ORCHESTRATE] 🔒 Already active for round ${roundId}`);
    return { success: true, deduped: true };
  }

  const state = getGameState(roomId);
  if (!state || state.phase !== 'drawing' || state.roundId !== roundId) {
    console.log(`[ORCHESTRATE] ⚠️ Round ${roundId} not active (phase=${state?.phase} stateRoundId=${state?.roundId})`);
    return { success: false, reason: 'round_not_active' };
  }

  orchestratingRooms.set(roomId, roundId);
  const key = rk(roomId, roundId);
  console.log(`[ORCHESTRATE] 🔑 Lock acquired room=${roomId} round=${roundId}`);

  // Clean up stale state from previous rounds in this room
  for (const [k] of roundAgentStates) {
    if (k.startsWith(`${roomId}::`) && k !== key) {
      roundAgentStates.delete(k);
      roundRevealedHints.delete(k);
      hintRevealInProgress.delete(k);
      roundAllGuesses.delete(k);
    }
  }

  // Pre-initialise agent states so reactive listeners never hit a missing entry
  for (const agent of AGENT_REGISTRY) {
    getOrCreateAgentState(roomId, roundId, agent.name);
  }

  // Register all agents — schedules entry-jitter timers and intel subscribers
  for (const agent of AGENT_REGISTRY) {
    console.log(
      `[ORCHESTRATE] 📡 Registering ${agent.name} ` +
      `(style=${getStrategyProfile(agent.name).currentStyle} jitter=${JITTER_MIN_MS}–${JITTER_MAX_MS}ms)`,
    );
    registerAgentReactiveLoop(roomId, roundId, agent, hints);
  }

  // Auto-release lock after max window so a crashed round never blocks the room
  const lockTtlMs = MAX_ATTEMPTS * 30_000 + 20_000;
  setTimeout(() => {
    if (orchestratingRooms.get(roomId) === roundId) {
      orchestratingRooms.delete(roomId);
      roundAllGuesses.delete(key);
      cleanupRound(roomId, roundId);
      const agentMap = roundAgentStates.get(key);
      if (agentMap) {
        const allEvents  = getIntelligenceEvents(roomId, roundId);
        const hintsFinal = roundRevealedHints.get(key)?.length ?? 0;
        for (const agent of AGENT_REGISTRY) {
          const s = agentMap.get(agent.name);
          if (s && !s.completed) {
            runPostRoundReview(agent.name, roundId, allEvents, false, 0, hintsFinal);
          }
        }
      }
      console.log(`[ORCHESTRATE] 🔓 Lock TTL expired for room ${roomId}`);
    }
  }, lockTtlMs);

  return {
    success:     true,
    scheduled:   AGENT_REGISTRY.length,
    maxAttempts: MAX_ATTEMPTS,
    model:       'autonomous-reactive-v5',
  };
}

/**
 * Async variant of runOrchestrator — designed for use with Next.js `after()`.
 *
 * Unlike runOrchestrator (which schedules work via setTimeout and returns
 * immediately), this function actually awaits each agent's execution to
 * completion before resolving.  This keeps the Vercel serverless function
 * instance alive via the event loop rather than relying on background timers
 * that are discarded once the HTTP response is sent.
 *
 * Use in start-round:
 *   after(async () => { await runOrchestratorAsync(roomId, roundId); });
 */
export async function runOrchestratorAsync(
  roomId:  string,
  roundId: string,
  hints:   string[] = [],
): Promise<OrchestratorResult> {
  // Dedup — same round already orchestrating
  if (orchestratingRooms.get(roomId) === roundId) {
    console.log(`[ORCHESTRATE] 🔒 Async: already active for round ${roundId}`);
    return { success: true, deduped: true };
  }

  const state = getGameState(roomId);
  if (!state || state.phase !== 'drawing' || state.roundId !== roundId) {
    console.log(`[ORCHESTRATE] ⚠️ Async: round ${roundId} not active (phase=${state?.phase} stateRoundId=${state?.roundId})`);
    return { success: false, reason: 'round_not_active' };
  }

  orchestratingRooms.set(roomId, roundId);
  const key = rk(roomId, roundId);
  console.log(`[ORCHESTRATE] 🔑 Async lock acquired room=${roomId} round=${roundId}`);

  // Clean up stale state from previous rounds
  for (const [k] of roundAgentStates) {
    if (k.startsWith(`${roomId}::`) && k !== key) {
      roundAgentStates.delete(k);
      roundRevealedHints.delete(k);
      hintRevealInProgress.delete(k);
      roundAllGuesses.delete(k);
    }
  }
  for (const agent of AGENT_REGISTRY) {
    getOrCreateAgentState(roomId, roundId, agent.name);
  }

  // Run all agents concurrently.  Each agent awaits its entry jitter then
  // loops attempts.  Using await-based sleep keeps this async function's
  // Promise pending — which keeps the Vercel instance alive — rather than
  // relying on setTimeout callbacks that are discarded after response.
  await Promise.allSettled([
    // 30-second round timeout — fires if no correct guess is made in time
    sleep(ROUND_TIMEOUT_MS).then(() => fireRoundTimeout(roomId, roundId)),
    ...AGENT_REGISTRY.map(async (agent) => {
      const jitter = randInt(JITTER_MIN_MS, JITTER_MAX_MS);
      console.log(`[ORCHESTRATE] 📡 Async registering ${agent.name} — entry jitter ${jitter}ms`);

      // Entry typing indicator
      try {
        await pusherServer.trigger(`presence-${roomId}`, 'bot-typing', {
          agentName: agent.name, agentId: agent.id, attemptNumber: 1,
        });
      } catch {}

      await sleep(jitter);

      // ── Wait for imageUrl to be confirmed in game state ───────────────────
      // game-started fires before after() runs, but clients may need imageUrl
      // to be non-null before agents make their first guess.
      {
        let waited = 0;
        while (!getGameState(roomId)?.imageUrl && waited < 10_000) {
          await sleep(500);
          waited += 500;
        }
        if (!getGameState(roomId)?.imageUrl) {
          console.log(`[ORCHESTRATE] ⏹ Async: ${agent.name} — imageUrl not available after ${waited}ms, aborting`);
          return;
        }
        if (waited > 0) {
          console.log(`[ORCHESTRATE] 🖼 ${agent.name} — imageUrl confirmed after ${waited}ms`);
        }
      }

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const cur = getGameState(roomId);
        if (!cur || cur.roundId !== roundId || cur.phase !== 'drawing') {
          console.log(`[ORCHESTRATE] ⏹ Async: ${agent.name} — round ended, stopping`);
          break;
        }

        const agentState = getOrCreateAgentState(roomId, roundId, agent.name);
        if (agentState.completed) break;

        await executeAgentAttempt(roomId, roundId, agent, hints);

        const stateAfter = getOrCreateAgentState(roomId, roundId, agent.name);
        if (stateAfter.completed) break;

        // Brief inter-attempt pause so the intel-update from a rival can propagate
        if (attempt < MAX_ATTEMPTS - 1) await sleep(1_500);
      }
    }),
  ]);

  // Release lock
  if (orchestratingRooms.get(roomId) === roundId) {
    orchestratingRooms.delete(roomId);
    roundAllGuesses.delete(key);
    cleanupRound(roomId, roundId);
  }

  console.log(`[ORCHESTRATE] ✅ Async orchestration complete — room=${roomId} round=${roundId}`);
  return {
    success:     true,
    scheduled:   AGENT_REGISTRY.length,
    maxAttempts: MAX_ATTEMPTS,
    model:       'autonomous-reactive-v5-async',
  };
}
