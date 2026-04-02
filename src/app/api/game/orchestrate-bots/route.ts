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
 */

import { NextRequest, NextResponse } from 'next/server';
import Pusher from 'pusher';

// Vercel Hobby tier defaults to 10s. orchestrate-bots runs LLM loops (~24s)
// so we need a higher ceiling. 60s is the maximum on Hobby; Pro allows 300s.
export const maxDuration = 60;
import { getGameState, getScoreboard } from '@/lib/gameStore';
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

const MAX_ATTEMPTS    = 3;
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
  attemptsUsed:    number;
  ownFailedGuesses: string[];
  completed:       boolean;
  /** Guard: prevents two concurrent LLM calls for the same agent */
  isGuessing:      boolean;
}

// ── Turbopack-safe singletons ─────────────────────────────────────────────────
// In Next.js 16+ dev mode, Turbopack re-evaluates route-handler modules between
// requests. Anchoring to globalThis keeps these Maps/Sets alive across
// re-evaluations so the dedup guard, agent state, and hint locks all survive.
declare global {
  var __orchestratingRooms:   Map<string, string>                         | undefined;
  var __roundAgentStates:     Map<string, Map<string, AgentRoundState>>   | undefined;
  var __roundRevealedHints:   Map<string, string[]>                       | undefined;
  var __hintRevealInProgress: Set<string>                                 | undefined;
}
if (!globalThis.__orchestratingRooms)   globalThis.__orchestratingRooms   = new Map();
if (!globalThis.__roundAgentStates)     globalThis.__roundAgentStates     = new Map();
if (!globalThis.__roundRevealedHints)   globalThis.__roundRevealedHints   = new Map();
if (!globalThis.__hintRevealInProgress) globalThis.__hintRevealInProgress = new Set();

/** roomId::roundId → agentName → state */
const roundAgentStates:    Map<string, Map<string, AgentRoundState>> = globalThis.__roundAgentStates;
const roundRevealedHints:  Map<string, string[]>                     = globalThis.__roundRevealedHints;
const hintRevealInProgress: Set<string>                              = globalThis.__hintRevealInProgress;
const orchestratingRooms:  Map<string, string>                       = globalThis.__orchestratingRooms;

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
  // Observer waits longest (35s) to accumulate negative information;
  // Blitzer is impatient (15s); Opportunist is in between (25s).
  const urgencySec = URGENCY_SEC_BY_STYLE[style] ?? 25;
  const isUrgent   = tElapsedMs / 1_000 > urgencySec || ri < P_MAX * URGENCY_RI_PCT;

  switch (style) {
    case 'Aggressive Blitzer':
      // Always strike. First-mover advantage maximizes R_i.
      return true;

    case 'Calculated Observer':
      // Wait for at least 2 pruned concepts (one from each rival) OR urgency
      return prunedCount >= 2 || isUrgent;

    case 'Adaptive Opportunist':
      // Strike once there's any signal OR time pressure kicks in
      return prunedCount >= 1 || isUrgent;

    default:
      return true;
  }
}

// ── Submit guess ──────────────────────────────────────────────────────────────

async function submitBotGuess(
  roomId:         string,
  agentName:      string,
  guess:          string,
  secretPrompt:   string,
  language:       'he' | 'en',
  roundStartTime: number,
): Promise<{ isCorrect: boolean; solveTimeMs: number }> {
  const solveTimeMs = Date.now() - roundStartTime;
  try {
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const res = await fetch(`${baseUrl}/api/game/validate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guess, secretPrompt, roomId, playerName: agentName, language, hintUsed: false, isFast: false }),
    });
    const data     = await res.json();
    const isCorrect = !!data.isCorrect;
    console.log(`[ORCHESTRATE] 🤖 ${agentName} → "${guess}" ${isCorrect ? '✅' : '❌'}`);
    return { isCorrect, solveTimeMs };
  } catch (err: any) {
    console.error(`[ORCHESTRATE] Submit failed for ${agentName}:`, err.message);
    return { isCorrect: false, solveTimeMs };
  }
}

// ── Broadcast intelligence ────────────────────────────────────────────────────
// Uses the shared broadcaster directly (no HTTP hop) so the Pusher event is
// always awaited before executeAgentAttempt returns. Pass latency_ms so the
// Research Tab can compare internal bot LLM durations vs external agent times.

async function broadcastIntelligence(opts: {
  roomId: string; roundId: string; agentName: string; guess: string;
  isCorrect: boolean; solveTimeMs: number; riskProfile: string;
  potentialReward?: number; attemptNumber?: number; rationale?: string;
  latency_ms?: number;
}): Promise<void> {
  try {
    await broadcastIntelligenceEvent(opts);
  } catch (err: any) {
    // Non-fatal — never let analytics failure interrupt the game loop
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
    const baseUrl  = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const language: 'he' | 'en' = /[\u0590-\u05FF]/.test(state.secretPrompt) ? 'he' : 'en';
    const res      = await fetch(`${baseUrl}/api/game/validate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'get-hint', secretPrompt: state.secretPrompt, language }),
    });
    const data  = await res.json();
    const hint  = data.hint || (language === 'he' ? 'חשוב על ביטוי יומיומי' : 'Think about a common expression');

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

  // ── Build live strategy context ────────────────────────────────────────────
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

  // ── Battle Brief ───────────────────────────────────────────────────────────
  const tElapsedMs      = Date.now() - roundStartTime;
  const potentialReward = computeDecayedReward(tElapsedMs);
  const revealedHints   = roundRevealedHints.get(key) ?? [];

  // Build Situational Directive from the agent's post-round profile
  const situationalDirective = buildSituationalDirective(agent.name);

  const battleBrief: BattleBriefOptions = {
    tElapsedMs,
    rivalFailures: events.filter(e => !e.isCorrect && e.agentName !== agent.name)
      .map(e => ({ agentId: e.agentName, guess: e.guess })),
    attemptsRemaining:   MAX_ATTEMPTS - attemptNumber,
    ownPreviousGuesses:  agentState.ownFailedGuesses,
    revealedHints:       revealedHints.length > 0 ? revealedHints : undefined,
  };

  // Append situational directive to strategy reasoning
  const fullReasoning = situationalDirective
    ? `${strategyReasoning}\n\n${situationalDirective}`
    : strategyReasoning;

  console.log(
    `[ORCHESTRATE] 🧠 ${agent.name} attempt=${attemptNumber}/${MAX_ATTEMPTS} ` +
    `profile=${profile} rank=${rank}/${allPlayers} pruned=${prunedConcepts.length} ` +
    `R_i=${potentialReward} style=${getStrategyProfile(agent.name).currentStyle}`,
  );

  // ── Typing indicator ───────────────────────────────────────────────────────
  try {
    await pusherServer.trigger(`presence-${roomId}`, 'bot-typing', {
      agentName: agent.name, agentId: agent.id, attemptNumber,
    });
  } catch {}

  // ── Call the LLM ──────────────────────────────────────────────────────────
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

  // ── Post-LLM abort check ──────────────────────────────────────────────────
  const latest = getGameState(roomId);
  if (!latest || latest.roundId !== roundId || latest.phase !== 'drawing') {
    console.log(`[ORCHESTRATE] ⏹ ${agent.name} discarding — round ended during LLM call`);
    agentState.isGuessing = false;
    return;
  }

  // ── Submit guess ──────────────────────────────────────────────────────────
  const { isCorrect, solveTimeMs } = await submitBotGuess(
    roomId, agent.name, guess, secretPrompt, language, roundStartTime,
  );

  agentState.attemptsUsed += 1;
  agentState.isGuessing    = false;
  if (!isCorrect) agentState.ownFailedGuesses.push(guess);
  if (isCorrect || agentState.attemptsUsed >= MAX_ATTEMPTS) {
    agentState.completed = true;
  }

  // ── Persist SER ───────────────────────────────────────────────────────────
  upsertAgentPerformance({ agentName: agent.name, isCorrect, solveTimeMs }).catch(() => {});

  // ── Broadcast ─────────────────────────────────────────────────────────────
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

  // ── Post-round review ─────────────────────────────────────────────────────
  // Runs immediately on win. For deadlock (all attempts exhausted, no win),
  // the review also fires here so profile evolution is never skipped.
  // hintsUsed: how many hints were revealed for this round (each costs H_HINT = 150)
  const hintsUsed = roundRevealedHints.get(key)?.length ?? 0;

  if (isCorrect) {
    const allEvents = getIntelligenceEvents(roomId, roundId);
    runPostRoundReview(agent.name, roundId, allEvents, true, solveTimeMs, hintsUsed);
    emitRoundEnd({ roomId, roundId, winner: agent.name, secret: secretPrompt });
  } else if (agentState.completed) {
    // Agent exhausted all attempts without winning.
    // Wait 1500ms so the final attempt's broadcast-intelligence call (fire-and-forget)
    // has time to persist its event — including ZLE flags — before we read the store.
    setTimeout(() => {
      const allEvents   = getIntelligenceEvents(roomId, roundId);
      const hintsFinal  = roundRevealedHints.get(key)?.length ?? 0;
      runPostRoundReview(agent.name, roundId, allEvents, false, 0, hintsFinal);
      console.log(`[ORCHESTRATE] 📉 ${agent.name} post-round review (exhausted — ${allEvents.filter(e => e.agentName === agent.name).length} events, hints=${hintsFinal})`);
    }, 1_500);
  }

  // ── Deadlock check after any failure ─────────────────────────────────────
  if (!isCorrect) {
    setImmediate(() => checkAndRevealHint(roomId, roundId));
  }
}

// ── Reactive listener per agent ───────────────────────────────────────────────

/**
 * Register an agent for autonomous reactive participation in a round.
 *
 * Each agent:
 *  1. Fires an initial guess after a tiny jitter (50–300 ms)
 *  2. Subscribes to intel-update events on the ArenaEventBus
 *  3. On each intel-update, runs an Opportunity Assessment
 *     If "strike" → calls executeAgentAttempt (if not already guessing / completed)
 *  4. Unsubscribes when completed or when round ends
 */
function registerAgentReactiveLoop(
  roomId:       string,
  roundId:      string,
  agent:        AgentConfig,
  initialHints: string[],
): void {
  const agentProfile = getStrategyProfile(agent.name);

  // Fire typing indicator slightly before the initial guess
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

  // Initial guess — small jitter only, no artificial delay
  const entryJitterMs = randInt(JITTER_MIN_MS, JITTER_MAX_MS);
  setTimeout(() => {
    executeAgentAttempt(roomId, roundId, agent, initialHints);
  }, entryJitterMs);

  // Reactive listener — fires on every rival failure in the room
  const unsubscribeIntel = subscribeToIntel(roomId, roundId, (payload: IntelUpdatePayload) => {
    const agentState = getOrCreateAgentState(roomId, roundId, agent.name);
    if (agentState.completed || agentState.isGuessing) return;

    // Don't react to our own events
    if (payload.event.agentName === agent.name) return;

    // Skip correct guesses — round is about to end
    if (payload.event.isCorrect) return;

    // Opportunity Assessment
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

  // Post-round review: fires when any agent wins
  subscribeRoundEnd(roomId, roundId, (payload) => {
    unsubscribeIntel();
    const agentState = getOrCreateAgentState(roomId, roundId, agent.name);
    const won        = payload.winner === agent.name;
    if (!won) {
      // This agent didn't win — record round result for strategy evolution
      const allEvents = getIntelligenceEvents(roomId, roundId);
      runPostRoundReview(agent.name, roundId, allEvents, false, 0);
    }
  });
}

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body    = await request.json();
    const { roomId, roundId, hints = [] } = body as {
      roomId: string; roundId: string; hints?: string[];
    };

    if (!roomId || !roundId) {
      return NextResponse.json({ error: 'roomId and roundId are required' }, { status: 400 });
    }

    // Dedup — same round already registered
    if (orchestratingRooms.get(roomId) === roundId) {
      console.log(`[ORCHESTRATE] 🔒 Already active for round ${roundId}`);
      return NextResponse.json({ success: true, deduped: true });
    }

    const state = getGameState(roomId);
    if (!state || state.phase !== 'drawing' || state.roundId !== roundId) {
      console.log(`[ORCHESTRATE] ⚠️ Round ${roundId} not active`);
      return NextResponse.json({ success: false, reason: 'round_not_active' });
    }

    orchestratingRooms.set(roomId, roundId);
    const key = rk(roomId, roundId);
    console.log(`[ORCHESTRATE] 🔑 Lock acquired room=${roomId} round=${roundId}`);

    // Clean up previous round state for this room
    for (const [k] of roundAgentStates) {
      if (k.startsWith(`${roomId}::`) && k !== key) {
        roundAgentStates.delete(k);
        roundRevealedHints.delete(k);
        hintRevealInProgress.delete(k);
      }
    }

    // Pre-initialise agent states
    for (const agent of AGENT_REGISTRY) {
      getOrCreateAgentState(roomId, roundId, agent.name);
    }

    // Register all agents into the reactive loop
    for (const agent of AGENT_REGISTRY) {
      console.log(
        `[ORCHESTRATE] 📡 Registering ${agent.name} ` +
        `(style=${getStrategyProfile(agent.name).currentStyle} jitter=${JITTER_MIN_MS}–${JITTER_MAX_MS}ms)`,
      );
      registerAgentReactiveLoop(roomId, roundId, agent, hints);
    }

    // Auto-release lock after max window: MAX_ATTEMPTS attempts + buffer
    const lockTtlMs = MAX_ATTEMPTS * 30_000 + 20_000; // 30s per attempt max + buffer
    setTimeout(() => {
      if (orchestratingRooms.get(roomId) === roundId) {
        orchestratingRooms.delete(roomId);
        cleanupRound(roomId, roundId);
        // Run post-round review for any agents that didn't complete naturally
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

    return NextResponse.json({
      success:     true,
      scheduled:   AGENT_REGISTRY.length,
      maxAttempts: MAX_ATTEMPTS,
      model:       'autonomous-reactive-v5',
    });
  } catch (err: any) {
    console.error('[ORCHESTRATE] Error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
