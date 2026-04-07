/**
 * Arena Round Orchestrator — Phase 1 (v2 — Independent Model Loops)
 *
 * Each model runs its own independent async loop. When a model responds,
 * its tMsFromStart is assigned at THAT exact moment — not when any wave
 * settles. Public guesses are pushed to the shared array immediately on
 * arrival, so faster models' guesses are visible to slower models mid-round.
 *
 * Architecture (replaces the broken wave-based approach):
 *   1. Warm up all models (5s timeout)
 *   2. Launch N independent model loops concurrently (Promise.allSettled)
 *   3. Each loop independently: query → receive → timestamp → score → push publicGuess
 *   4. Wrong/wait responses: wait INTER_ATTEMPT_DELAY_MS, re-query with updated context
 *   5. Round ends when all loops resolve (or per-call 55s timeout exhausts attempts)
 *
 * Key invariants:
 *   • tMsFromStart = Date.now() - tStart immediately after response arrives
 *   • publicGuesses written the instant a response is processed (no wave sync)
 *   • Server-assigned timestamps only — model-reported times are never used
 *   • Circuit breaker: MAX_API_CALLS_PER_MODEL prevents runaway cost from bugs
 */

import { ARENA_AGENTS, dispatchArenaProbe, type AgentConfig, type ArenaProbeResult } from '@/lib/agents/dispatcher';
import { warmupAllModels, type WarmupResult } from './warmup';
import { buildPhase1Context, buildTournamentContext, type PublicGuess } from './context';
import { ARENA_SYSTEM_PROMPT_PHASE1, ARENA_SYSTEM_PROMPT } from './prompt';
import { computeGuessScore, checkCorrect, MAX_ATTEMPTS } from './scoring';
import type { TournamentState } from './standings';
import { computePhase3Metrics, type Phase3Metrics, type GuessForMetrics } from './metrics';
import { estimateCostUsd } from './pricing';

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Pause between re-queries within a single model's loop.
 * Gives other models time to push public guesses so the next
 * context payload contains fresh information.
 */
const INTER_ATTEMPT_DELAY_MS = 2_000;

/**
 * Hard circuit breaker — prevents runaway API costs from bugs.
 * Each model may make at most this many dispatchArenaProbe calls per round.
 */
const MAX_API_CALLS_PER_MODEL = 3;

// ── Types ─────────────────────────────────────────────────────────────────────

/** Tournament context injected per-round in Phase 2 */
export interface TournamentRoundConfig {
  tournamentId:    string;
  roundNumber:     number;           // 1-indexed
  totalRounds:     number;
  tournamentState: TournamentState;  // snapshot BEFORE this round (updated after)
}

export interface RoundConfig {
  idiomId:      number;
  idiomPhrase:  string;
  imageUrl:     string;
  /** Override model roster (defaults to ARENA_AGENTS) */
  agents?:      AgentConfig[];
  /** Skip warmup for faster testing */
  skipWarmup?:  boolean;
  /** When set, enables Phase 2 tournament context and anonymous player IDs */
  tournament?:  TournamentRoundConfig;
}

export interface GuessRecord {
  modelId:             string;
  attempt:             number;
  wave:                number;  // same as attempt in independent-loop design; kept for DB schema compat
  action:              'guess' | 'wait';
  guessText:           string | null;
  confidence:          number;
  reasoning:           string;
  tMsFromStart:        number;  // assigned the instant this model's response arrived
  isCorrect:           boolean;
  pointsAwarded:       number;
  latencyMs:           number;
  priorGuessesVisible: number;
  error?:              string;
  isKeyMissing:        boolean;
}

export interface ModelRoundResult {
  modelId:          string;
  label:            string;
  icon:             string;
  attemptsUsed:     number;
  apiCallCount:     number;
  finalScore:       number;
  guesses:          GuessRecord[];
  warmupLatencyMs:  number | null;
  warmupOk:         boolean;
  bestGuess:        string | null;
  isCorrect:        boolean;
  reasoning:        string;
  /** Phase 2: anonymised player_id for this model (e.g. "player_7") */
  playerId?:        string;
  /** Phase 2: first-attempt JSON context payload sent to this model (for DB verification) */
  contextSentJson?: string;
  /** Phase 3: did the model produce zero valid guesses? */
  dnf:              boolean;
  /** Phase 3: action on first attempt ('guess'|'wait'|null if no call) */
  firstAttemptAction: 'guess' | 'wait' | null;
  /** Phase 3: did reasoning text mention tournament standing? */
  mentionsStanding: boolean;
  /** Phase 3: was the action rational given standing? null = indeterminate */
  standingActionRational: boolean | null;
  /** Phase 3: estimated API cost for this model this round (USD) */
  apiCostUsd:       number;
  /** Phase 3: total input tokens across all attempts */
  inputTokensTotal: number;
  /** Phase 3: total output tokens across all attempts */
  outputTokensTotal: number;
}

export interface RoundResult {
  roundId:        string;
  idiomPhrase:    string;
  imageUrl:       string;
  tStartIso:      string;
  tEndIso:        string;
  durationMs:     number;
  models:         ModelRoundResult[];
  publicGuesses:  PublicGuess[];
  warmupResults:  Record<string, WarmupResult>;
  winner:         { modelId: string; label: string; score: number; tMs: number } | null;
  /** Phase 2: tournament this round belongs to */
  tournamentId?:  string;
  /** Phase 2: 1-indexed round number within the tournament */
  roundNumber?:   number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Compute this model's 1-based rank from pre-round tournament stats (1=leader). */
function computeRankAtStart(modelId: string, state: TournamentState): number | undefined {
  const allStats = Object.values(state.stats);
  if (allStats.length === 0) return undefined;
  const sorted = [...allStats].sort((a, b) => b.totalScore - a.totalScore);
  const idx = sorted.findIndex(s => s.modelId === modelId);
  return idx >= 0 ? idx + 1 : undefined;
}

// ── Per-model independent loop ─────────────────────────────────────────────────

interface ModelLoopInput {
  agent:         AgentConfig;
  config:        RoundConfig;
  roundId:       string;
  tStart:        Date;
  publicGuesses: PublicGuess[];   // shared mutable array — read at each query, written on response
  warmupResult:  WarmupResult | undefined;
}

async function runModelLoop(input: ModelLoopInput): Promise<ModelRoundResult> {
  const { agent, config, roundId, tStart, publicGuesses, warmupResult } = input;

  const isKeyMissing = agent.envKey !== null && !process.env[agent.envKey];

  // ── Tournament mode ─────────────────────────────────────────────────────────
  const tournament = config.tournament ?? null;
  const playerId: string | undefined = tournament
    ? (tournament.tournamentState.playerIdMap[agent.modelId] ?? undefined)
    : undefined;

  let attemptsUsed      = 0;
  let apiCallCount      = 0;
  let hasCorrectGuess   = false;
  let totalScore        = 0;
  let contextSentJson: string | undefined;
  let inputTokensTotal  = 0;
  let outputTokensTotal = 0;
  const guesses: GuessRecord[] = [];
  const rankAtStart = tournament ? computeRankAtStart(agent.modelId, tournament.tournamentState) : undefined;

  // ── Key missing — short-circuit ─────────────────────────────────────────────
  if (isKeyMissing) {
    guesses.push({
      modelId:             agent.modelId,
      attempt:             0,
      wave:                0,
      action:              'wait',
      guessText:           null,
      confidence:          0,
      reasoning:           'API key not configured',
      tMsFromStart:        0,
      isCorrect:           false,
      pointsAwarded:       0,
      latencyMs:           0,
      priorGuessesVisible: 0,
      isKeyMissing:        true,
    });
    return assemble(agent, { attemptsUsed, apiCallCount, guesses, hasCorrectGuess, totalScore, playerId, contextSentJson, inputTokensTotal, outputTokensTotal, rankAtStart, roundNumber: tournament?.roundNumber, totalRounds: tournament?.totalRounds }, warmupResult);
  }

  // ── Independent query loop ──────────────────────────────────────────────────
  for (let attemptNum = 1; attemptNum <= MAX_ATTEMPTS; attemptNum++) {

    // Circuit breaker
    if (apiCallCount >= MAX_API_CALLS_PER_MODEL) {
      console.log(`[ARENA/LOOP] CIRCUIT BREAKER: ${agent.label} hit ${MAX_API_CALLS_PER_MODEL} calls — aborting`);
      break;
    }

    apiCallCount++;
    const priorGuessesVisible = publicGuesses.length;

    // ── Build context payload ───────────────────────────────────────────────
    const tElapsedMs = Date.now() - tStart.getTime();
    let ctxJson: string;
    let systemPrompt: string;

    if (tournament && playerId) {
      const ctx = buildTournamentContext({
        roundId,
        imageUrl:        config.imageUrl,
        modelId:         agent.modelId,
        attemptsUsed,
        tElapsedMs,
        publicGuesses,
        tournamentState: tournament.tournamentState,
        roundNumber:     tournament.roundNumber,
      });
      ctxJson      = JSON.stringify(ctx, null, 2);
      systemPrompt = ARENA_SYSTEM_PROMPT;
    } else {
      const ctx = buildPhase1Context({
        roundId,
        imageUrl:     config.imageUrl,
        modelId:      agent.modelId,
        attemptsUsed,
        tElapsedMs,
        publicGuesses,
      });
      ctxJson      = JSON.stringify(ctx, null, 2);
      systemPrompt = ARENA_SYSTEM_PROMPT_PHASE1;
    }

    // Capture first-attempt context for DB verification
    if (attemptNum === 1 && contextSentJson === undefined) {
      contextSentJson = ctxJson;
    }

    console.log(
      `[ARENA/LOOP] ${agent.label}${playerId ? ` (${playerId})` : ''} | attempt=${attemptNum} api_calls=${apiCallCount}/${MAX_API_CALLS_PER_MODEL}` +
      ` | prior_guesses=${priorGuessesVisible} | t=${tElapsedMs}ms`,
    );

    const probeResult = await dispatchArenaProbe(
      agent.modelId,
      config.imageUrl,
      systemPrompt,
      ctxJson,
    );

    // ── Timestamp assigned the instant THIS model's response arrives ────────
    const tMsFromStart = Date.now() - tStart.getTime();

    // ── Accumulate token usage for cost monitoring ──────────────────────────
    inputTokensTotal  += probeResult.inputTokens  ?? 0;
    outputTokensTotal += probeResult.outputTokens ?? 0;

    // ── Error / key missing ─────────────────────────────────────────────────
    if (probeResult.error || probeResult.isKeyMissing) {
      guesses.push({
        modelId:             agent.modelId,
        attempt:             attemptsUsed + 1,
        wave:                attemptNum,
        action:              'wait',
        guessText:           null,
        confidence:          0,
        reasoning:           probeResult.error ?? 'key_missing',
        tMsFromStart,
        isCorrect:           false,
        pointsAwarded:       0,
        latencyMs:           probeResult.latencyMs,
        priorGuessesVisible,
        error:               probeResult.error,
        isKeyMissing:        probeResult.isKeyMissing,
      });
      console.log(`[ARENA/LOOP] ${agent.label} | attempt=${attemptNum} | ERROR at t=${tMsFromStart}ms: ${probeResult.error ?? 'key_missing'}`);
      break; // errors are terminal — don't retry
    }

    // ── "wait" action ───────────────────────────────────────────────────────
    if (probeResult.action === 'wait') {
      attemptsUsed++;
      guesses.push({
        modelId:             agent.modelId,
        attempt:             attemptsUsed,
        wave:                attemptNum,
        action:              'wait',
        guessText:           null,
        confidence:          probeResult.confidence,
        reasoning:           probeResult.reasoning,
        tMsFromStart,
        isCorrect:           false,
        pointsAwarded:       0,
        latencyMs:           probeResult.latencyMs,
        priorGuessesVisible,
        isKeyMissing:        false,
      });
      console.log(
        `[ARENA/LOOP] ${agent.label} | attempt=${attemptNum} | WAIT at t=${tMsFromStart}ms` +
        ` | ${MAX_ATTEMPTS - attemptsUsed} attempts left | latency=${probeResult.latencyMs}ms`,
      );
      if (attemptsUsed >= MAX_ATTEMPTS) break;
      await sleep(INTER_ATTEMPT_DELAY_MS);
      continue;
    }

    // ── "guess" action ──────────────────────────────────────────────────────
    attemptsUsed++;
    const guessText = probeResult.guess ?? '';
    const isCorrect = checkCorrect(guessText, config.idiomPhrase);
    const points    = computeGuessScore(isCorrect, tMsFromStart, attemptsUsed);

    guesses.push({
      modelId:             agent.modelId,
      attempt:             attemptsUsed,
      wave:                attemptNum,
      action:              'guess',
      guessText,
      confidence:          probeResult.confidence,
      reasoning:           probeResult.reasoning,
      tMsFromStart,
      isCorrect,
      pointsAwarded:       points,
      latencyMs:           probeResult.latencyMs,
      priorGuessesVisible,
      isKeyMissing:        false,
    });
    totalScore += points;

    // Immediately broadcast to shared public guesses — visible to other loops at next query.
    // In tournament mode, use player_id so model names never appear in context payloads.
    if (guessText) {
      const publicModel = (tournament && playerId) ? playerId : agent.modelId;
      publicGuesses.push({ model: publicModel, guess: guessText, t_ms: tMsFromStart, attempt: attemptsUsed });
    }

    if (isCorrect) {
      hasCorrectGuess = true;
      console.log(
        `[ARENA/LOOP] ${agent.label} | attempt=${attemptNum} | CORRECT "${guessText}"` +
        ` | +${points}pts | t=${tMsFromStart}ms | latency=${probeResult.latencyMs}ms`,
      );
      break;
    }

    console.log(
      `[ARENA/LOOP] ${agent.label} | attempt=${attemptNum} | WRONG "${guessText}"` +
      ` | ${points}pts | t=${tMsFromStart}ms | ${MAX_ATTEMPTS - attemptsUsed} attempts left`,
    );

    if (attemptsUsed >= MAX_ATTEMPTS) break;
    await sleep(INTER_ATTEMPT_DELAY_MS);
  }

  return assemble(agent, { attemptsUsed, apiCallCount, guesses, hasCorrectGuess, totalScore, playerId: playerId ?? undefined, contextSentJson, inputTokensTotal, outputTokensTotal, rankAtStart }, warmupResult);
}

// ── Result assembly helper ────────────────────────────────────────────────────

function assemble(
  agent:        AgentConfig,
  state:        {
    attemptsUsed:     number;
    apiCallCount:     number;
    guesses:          GuessRecord[];
    hasCorrectGuess:  boolean;
    totalScore:       number;
    playerId?:        string;
    contextSentJson?: string;
    inputTokensTotal:  number;
    outputTokensTotal: number;
    rankAtStart?:      number;
    roundNumber?:      number;
    totalRounds?:      number;
  },
  warmupResult: WarmupResult | undefined,
): ModelRoundResult {
  const bestGuess = state.guesses.find(g => g.isCorrect)?.guessText
                 ?? state.guesses.filter(g => g.action === 'guess').pop()?.guessText
                 ?? null;
  const reasoning = state.guesses.map(g => g.reasoning).filter(Boolean).join(' | ');

  // Phase 3: derive behavioural metrics
  const guessesForMetrics: GuessForMetrics[] = state.guesses.map(g => ({
    attempt:      g.attempt,
    action:       g.action,
    isKeyMissing: g.isKeyMissing,
    error:        g.error,
  }));
  const metrics: Phase3Metrics = computePhase3Metrics(
    reasoning,
    guessesForMetrics,
    state.attemptsUsed,
    state.rankAtStart,
    state.roundNumber,
    state.totalRounds,
  );
  const apiCostUsd = estimateCostUsd(agent.modelId, state.inputTokensTotal, state.outputTokensTotal);

  return {
    modelId:                agent.modelId,
    label:                  agent.label,
    icon:                   agent.icon,
    attemptsUsed:           state.attemptsUsed,
    apiCallCount:           state.apiCallCount,
    finalScore:             state.totalScore,
    guesses:                state.guesses,
    warmupLatencyMs:        warmupResult?.latencyMs ?? null,
    warmupOk:               warmupResult?.ok ?? false,
    bestGuess,
    isCorrect:              state.hasCorrectGuess,
    reasoning,
    playerId:               state.playerId,
    contextSentJson:        state.contextSentJson,
    dnf:                    metrics.dnf,
    firstAttemptAction:     metrics.firstAttemptAction,
    mentionsStanding:       metrics.mentionsStanding,
    standingActionRational: metrics.standingActionRational,
    apiCostUsd,
    inputTokensTotal:       state.inputTokensTotal,
    outputTokensTotal:      state.outputTokensTotal,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run a single arena round.
 *
 * Launches all model loops concurrently. Each loop independently queries its
 * model, timestamps responses on arrival, and broadcasts guesses immediately.
 * Round completes when all loops resolve.
 */
export async function runArenaRound(config: RoundConfig): Promise<RoundResult> {
  const agents  = config.agents ?? ARENA_AGENTS;
  const roundId = crypto.randomUUID();
  const tStart  = new Date();

  console.log(`\n${'='.repeat(80)}`);
  console.log(`[ARENA/ROUND] Starting round ${roundId}`);
  console.log(`[ARENA/ROUND] Idiom: "${config.idiomPhrase}" | Image: ${config.imageUrl.slice(0, 60)}...`);
  console.log(`[ARENA/ROUND] Models: ${agents.length} | Max attempts: ${MAX_ATTEMPTS} | Inter-attempt delay: ${INTER_ATTEMPT_DELAY_MS}ms`);
  console.log(`${'='.repeat(80)}\n`);

  // ── Step 1: Warm-up ─────────────────────────────────────────────────────────
  let warmupMap = new Map<string, WarmupResult>();
  if (!config.skipWarmup) {
    console.log('[ARENA/ROUND] Phase: WARMUP');
    warmupMap = await warmupAllModels(agents);
  } else {
    console.log('[ARENA/ROUND] Phase: WARMUP (skipped)');
  }

  // ── Step 2: Shared public guesses (written immediately by each model loop) ──
  const publicGuesses: PublicGuess[] = [];

  // ── Step 3: Launch all model loops concurrently — no waves ──────────────────
  console.log(`\n[ARENA/ROUND] Launching ${agents.length} independent model loops`);

  const loopPromises = agents.map(agent =>
    runModelLoop({ agent, config, roundId, tStart, publicGuesses, warmupResult: warmupMap.get(agent.modelId) }),
  );

  const settled = await Promise.allSettled(loopPromises);

  // ── Step 4: Assemble results ────────────────────────────────────────────────
  const tEnd       = new Date();
  const durationMs = tEnd.getTime() - tStart.getTime();

  const models: ModelRoundResult[] = settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    // Should never happen — runModelLoop catches all errors internally
    const agent = agents[i];
    console.error(`[ARENA/ROUND] Loop for ${agent?.label} rejected unexpectedly:`, r.reason);
    return {
      modelId:                agent?.modelId ?? 'unknown',
      label:                  agent?.label   ?? 'Unknown',
      icon:                   agent?.icon    ?? '?',
      attemptsUsed:           0,
      apiCallCount:           0,
      finalScore:             0,
      guesses:                [],
      warmupLatencyMs:        null,
      warmupOk:               false,
      bestGuess:              null,
      isCorrect:              false,
      reasoning:              `Loop rejected: ${r.reason?.message ?? 'unknown'}`,
      dnf:                    true,
      firstAttemptAction:     null,
      mentionsStanding:       false,
      standingActionRational: null,
      apiCostUsd:             0,
      inputTokensTotal:       0,
      outputTokensTotal:      0,
    };
  });

  // Sort by score descending
  models.sort((a, b) => b.finalScore - a.finalScore);

  // Determine winner
  const winner = models.length > 0 && models[0].finalScore > 0
    ? {
        modelId: models[0].modelId,
        label:   models[0].label,
        score:   models[0].finalScore,
        tMs:     models[0].guesses.find(g => g.isCorrect)?.tMsFromStart ?? 0,
      }
    : null;

  // ── Step 5: Log summary ─────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`[ARENA/ROUND] ROUND COMPLETE | Duration: ${durationMs}ms | "${config.idiomPhrase}"`);
  for (const m of models) {
    const correctGuess = m.guesses.find(g => g.isCorrect);
    const status       = m.isCorrect ? `CORRECT @ t=${correctGuess?.tMsFromStart}ms` : 'NO_CORRECT';
    const guessStr     = m.bestGuess ? `"${m.bestGuess}"` : '(none)';
    console.log(
      `  ${m.icon} ${m.label.padEnd(22)} | ${String(m.finalScore).padStart(6)}pts | ` +
      `${m.attemptsUsed}/${MAX_ATTEMPTS} att | ${status.padEnd(26)} | ${guessStr}`,
    );
  }
  if (winner) console.log(`[ARENA/ROUND] Winner: ${winner.label} (+${winner.score}pts @ t=${winner.tMs}ms)`);
  else        console.log('[ARENA/ROUND] No winner this round');
  console.log(`${'─'.repeat(80)}\n`);

  const warmupResults: Record<string, WarmupResult> = {};
  for (const [k, v] of warmupMap) warmupResults[k] = v;

  return {
    roundId,
    idiomPhrase:   config.idiomPhrase,
    imageUrl:      config.imageUrl,
    tStartIso:     tStart.toISOString(),
    tEndIso:       tEnd.toISOString(),
    durationMs,
    models,
    publicGuesses,
    warmupResults,
    winner,
    tournamentId:  config.tournament?.tournamentId,
    roundNumber:   config.tournament?.roundNumber,
  };
}
