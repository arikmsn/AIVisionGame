/**
 * Arena Round Orchestrator — Phase 1
 *
 * Runs a single arena round end-to-end:
 *   1. Select idiom + image
 *   2. Warm up all 12 models (5s timeout)
 *   3. Wave 1: query all models simultaneously (Promise.allSettled)
 *   4. Wave 2: re-query models that chose "wait" or guessed wrong (with updated public_guesses)
 *   5. Wave 3: final re-query for remaining models
 *   6. Score all guesses, write results to DB
 *
 * Key constraints (from spec):
 *   • All model calls originate from same server tick (Promise.allSettled)
 *   • Server-assigned timestamps only (never trust model-reported times)
 *   • Each model gets personalised context (their own attempts, model name)
 *   • Guesses broadcast to public_guesses between waves
 *   • Comprehensive logging per model query (request, response, latency, timestamp)
 */

import { ARENA_AGENTS, dispatchArenaProbe, type AgentConfig, type ArenaProbeResult } from '@/lib/agents/dispatcher';
import { warmupAllModels, type WarmupResult } from './warmup';
import { buildPhase1Context, type PublicGuess } from './context';
import { ARENA_SYSTEM_PROMPT_PHASE1 } from './prompt';
import { computeGuessScore, checkCorrect, MAX_ATTEMPTS, T_MAX_MS } from './scoring';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RoundConfig {
  idiomId:      number;
  idiomPhrase:  string;
  imageUrl:     string;
  /** Override model roster (defaults to all 12 ARENA_AGENTS) */
  agents?:      AgentConfig[];
  /** Skip warmup for faster testing */
  skipWarmup?:  boolean;
}

export interface GuessRecord {
  modelId:       string;
  attempt:       number;
  wave:          number;
  action:        'guess' | 'wait';
  guessText:     string | null;
  confidence:    number;
  reasoning:     string;
  tMsFromStart:  number;
  isCorrect:     boolean;
  pointsAwarded: number;
  latencyMs:     number;
  priorGuessesVisible: number;
  error?:        string;
  isKeyMissing:  boolean;
}

export interface ModelRoundResult {
  modelId:          string;
  label:            string;
  icon:             string;
  attemptsUsed:     number;
  apiCallCount:     number;       // hard count of dispatchArenaProbe calls (circuit breaker metric)
  finalScore:       number;
  guesses:          GuessRecord[];
  warmupLatencyMs:  number | null;
  warmupOk:         boolean;
  bestGuess:        string | null;
  isCorrect:        boolean;
  reasoning:        string;
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
}

// ── Per-model state tracking ──────────────────────────────────────────────────

/**
 * HARD CIRCUIT BREAKER — prevents runaway API costs from bugs.
 * If any single model exceeds this many API calls in one round, its loop is
 * aborted immediately. This is a safety net on top of the 3-attempt limit.
 */
const MAX_API_CALLS_PER_MODEL = 3;

interface ModelState {
  agent:           AgentConfig;
  attemptsUsed:    number;
  apiCallCount:    number;      // hard counter: every dispatchArenaProbe increments this
  guesses:         GuessRecord[];
  done:            boolean;     // true when: correct guess, all attempts used, error, key_missing, or breaker tripped
  hasCorrectGuess: boolean;
  totalScore:      number;
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

/**
 * Run a single arena round.
 *
 * This is the Phase 1 entry point. It orchestrates warm-up, 3 query waves,
 * scoring, and result assembly. The round runs synchronously (no real-time
 * WebSocket — that comes in Phase 2).
 */
export async function runArenaRound(config: RoundConfig): Promise<RoundResult> {
  const agents    = config.agents ?? ARENA_AGENTS;
  const roundId   = crypto.randomUUID();
  const tStart    = new Date();

  console.log(`\n${'='.repeat(80)}`);
  console.log(`[ARENA/ROUND] Starting round ${roundId}`);
  console.log(`[ARENA/ROUND] Idiom: "${config.idiomPhrase}" | Image: ${config.imageUrl.slice(0, 60)}...`);
  console.log(`[ARENA/ROUND] Models: ${agents.length} | Max attempts: ${MAX_ATTEMPTS}`);
  console.log(`${'='.repeat(80)}\n`);

  // ── Step 1: Warm-up ─────────────────────────────────────────────────────────

  let warmupMap = new Map<string, WarmupResult>();

  if (!config.skipWarmup) {
    console.log('[ARENA/ROUND] Phase: WARMUP');
    warmupMap = await warmupAllModels(agents);
  } else {
    console.log('[ARENA/ROUND] Phase: WARMUP (skipped)');
  }

  // ── Step 2: Initialise model state ──────────────────────────────────────────

  const publicGuesses: PublicGuess[] = [];

  const modelStates = new Map<string, ModelState>();
  for (const agent of agents) {
    const warmup = warmupMap.get(agent.modelId);
    const isKeyMissing = agent.envKey !== null && !process.env[agent.envKey];

    modelStates.set(agent.modelId, {
      agent,
      attemptsUsed:    0,
      apiCallCount:    0,
      guesses:         [],
      done:            isKeyMissing, // immediately done if no key
      hasCorrectGuess: false,
      totalScore:      0,
    });

    // If key is missing, record a placeholder guess
    if (isKeyMissing) {
      modelStates.get(agent.modelId)!.guesses.push({
        modelId:      agent.modelId,
        attempt:      0,
        wave:         0,
        action:       'wait',
        guessText:    null,
        confidence:   0,
        reasoning:    'API key not configured',
        tMsFromStart: 0,
        isCorrect:    false,
        pointsAwarded: 0,
        latencyMs:    0,
        priorGuessesVisible: 0,
        isKeyMissing: true,
      });
    }
  }

  // ── Step 3: Run up to 3 waves ───────────────────────────────────────────────

  for (let wave = 1; wave <= MAX_ATTEMPTS; wave++) {
    const activeModels = [...modelStates.values()].filter(m => !m.done);

    if (activeModels.length === 0) {
      console.log(`[ARENA/ROUND] Wave ${wave}: no active models remaining, ending early`);
      break;
    }

    console.log(`\n[ARENA/ROUND] Wave ${wave}: querying ${activeModels.length} models`);
    const waveStartMs = Date.now() - tStart.getTime();

    // Build per-model context and dispatch simultaneously
    // CIRCUIT BREAKER: skip models that have already hit the API call cap
    const safeActiveModels = activeModels.filter(state => {
      if (state.apiCallCount >= MAX_API_CALLS_PER_MODEL) {
        console.log(`[ARENA/ROUND] CIRCUIT BREAKER: ${state.agent.label} hit ${MAX_API_CALLS_PER_MODEL} API calls — aborting`);
        state.done = true;
        return false;
      }
      return true;
    });

    if (safeActiveModels.length === 0) {
      console.log(`[ARENA/ROUND] Wave ${wave}: all remaining models hit circuit breaker, ending`);
      break;
    }

    const probePromises = safeActiveModels.map(async (state) => {
      // Increment API call counter BEFORE the call (counts the attempt even if it fails)
      state.apiCallCount++;

      const ctx = buildPhase1Context({
        roundId,
        imageUrl:       config.imageUrl,
        modelId:        state.agent.modelId,
        attemptsUsed:   state.attemptsUsed,
        tElapsedMs:     Date.now() - tStart.getTime(),
        publicGuesses,
      });

      const contextJson = JSON.stringify(ctx, null, 2);

      console.log(`[ARENA/ROUND] Wave ${wave} | ${state.agent.label} | api_calls=${state.apiCallCount}/${MAX_API_CALLS_PER_MODEL} | attempts_used=${state.attemptsUsed} | prior_guesses=${publicGuesses.length}`);

      return dispatchArenaProbe(
        state.agent.modelId,
        config.imageUrl,
        ARENA_SYSTEM_PROMPT_PHASE1,
        contextJson,
      );
    });

    // All model calls originate from same server tick (Promise.allSettled)
    const results = await Promise.allSettled(probePromises);

    // Process wave results
    for (let i = 0; i < safeActiveModels.length; i++) {
      const state  = safeActiveModels[i];
      const result = results[i];

      let probeResult: ArenaProbeResult;
      if (result.status === 'fulfilled') {
        probeResult = result.value;
      } else {
        // Promise rejected (shouldn't happen — dispatchArenaProbe catches internally)
        probeResult = {
          modelId:      state.agent.modelId,
          action:       'wait',
          guess:        null,
          confidence:   0,
          reasoning:    '',
          latencyMs:    0,
          isKeyMissing: false,
          error:        result.reason?.message ?? 'Unknown dispatch error',
        };
      }

      // Server-assigned timestamp (spec §5.2: NEVER trust model-reported timestamps)
      const tMsFromStart = Date.now() - tStart.getTime();

      // Handle errors
      if (probeResult.error || probeResult.isKeyMissing) {
        const guessRecord: GuessRecord = {
          modelId:       state.agent.modelId,
          attempt:       state.attemptsUsed + 1,
          wave,
          action:        'wait',
          guessText:     null,
          confidence:    0,
          reasoning:     probeResult.error ?? 'key_missing',
          tMsFromStart,
          isCorrect:     false,
          pointsAwarded: 0,
          latencyMs:     probeResult.latencyMs,
          priorGuessesVisible: publicGuesses.length,
          error:         probeResult.error,
          isKeyMissing:  probeResult.isKeyMissing,
        };
        state.guesses.push(guessRecord);
        state.done = true;
        console.log(`[ARENA/ROUND] Wave ${wave} | ${state.agent.label} | ERROR: ${probeResult.error ?? 'key_missing'}`);
        continue;
      }

      // Handle "wait" action
      if (probeResult.action === 'wait') {
        state.attemptsUsed++;
        const guessRecord: GuessRecord = {
          modelId:       state.agent.modelId,
          attempt:       state.attemptsUsed,
          wave,
          action:        'wait',
          guessText:     null,
          confidence:    probeResult.confidence,
          reasoning:     probeResult.reasoning,
          tMsFromStart,
          isCorrect:     false,
          pointsAwarded: 0,
          latencyMs:     probeResult.latencyMs,
          priorGuessesVisible: publicGuesses.length,
          isKeyMissing:  false,
        };
        state.guesses.push(guessRecord);

        if (state.attemptsUsed >= MAX_ATTEMPTS) {
          state.done = true;
          console.log(`[ARENA/ROUND] Wave ${wave} | ${state.agent.label} | WAIT (all attempts used)`);
        } else {
          console.log(`[ARENA/ROUND] Wave ${wave} | ${state.agent.label} | WAIT (${MAX_ATTEMPTS - state.attemptsUsed} attempts left) | confidence=${probeResult.confidence} | "${probeResult.reasoning.slice(0, 60)}"`);
        }
        continue;
      }

      // Handle "guess" action
      state.attemptsUsed++;
      const guessText = probeResult.guess ?? '';
      const isCorrect = checkCorrect(guessText, config.idiomPhrase);
      const points    = computeGuessScore(isCorrect, tMsFromStart, state.attemptsUsed);

      const guessRecord: GuessRecord = {
        modelId:       state.agent.modelId,
        attempt:       state.attemptsUsed,
        wave,
        action:        'guess',
        guessText,
        confidence:    probeResult.confidence,
        reasoning:     probeResult.reasoning,
        tMsFromStart,
        isCorrect,
        pointsAwarded: points,
        latencyMs:     probeResult.latencyMs,
        priorGuessesVisible: publicGuesses.length,
        isKeyMissing:  false,
      };
      state.guesses.push(guessRecord);
      state.totalScore += points;

      // Add to public guesses (broadcast to other models in next wave)
      publicGuesses.push({
        model:   state.agent.modelId,
        guess:   guessText,
        t_ms:    tMsFromStart,
        attempt: state.attemptsUsed,
      });

      if (isCorrect) {
        state.hasCorrectGuess = true;
        state.done = true; // correct guess → stop querying
        console.log(
          `[ARENA/ROUND] Wave ${wave} | ${state.agent.label} | CORRECT "${guessText}" | ` +
          `+${points}pts | ${tMsFromStart}ms | confidence=${probeResult.confidence} | ${probeResult.latencyMs}ms latency`,
        );
      } else {
        if (state.attemptsUsed >= MAX_ATTEMPTS) {
          state.done = true;
          console.log(
            `[ARENA/ROUND] Wave ${wave} | ${state.agent.label} | WRONG "${guessText}" (final attempt) | ` +
            `${points}pts | ${tMsFromStart}ms | confidence=${probeResult.confidence}`,
          );
        } else {
          console.log(
            `[ARENA/ROUND] Wave ${wave} | ${state.agent.label} | WRONG "${guessText}" | ` +
            `${points}pts | ${tMsFromStart}ms | ${MAX_ATTEMPTS - state.attemptsUsed} attempts left | confidence=${probeResult.confidence}`,
          );
        }
      }
    }

    console.log(`[ARENA/ROUND] Wave ${wave} complete | ${publicGuesses.length} total public guesses`);
  }

  // ── Step 4: Assemble results ────────────────────────────────────────────────

  const tEnd       = new Date();
  const durationMs = tEnd.getTime() - tStart.getTime();

  const models: ModelRoundResult[] = [...modelStates.values()].map(state => {
    const warmup      = warmupMap.get(state.agent.modelId);
    const bestGuess   = state.guesses.find(g => g.isCorrect)?.guessText
                     ?? state.guesses.filter(g => g.action === 'guess').pop()?.guessText
                     ?? null;
    const reasoning   = state.guesses.filter(g => g.reasoning).map(g => g.reasoning).join(' | ');

    return {
      modelId:          state.agent.modelId,
      label:            state.agent.label,
      icon:             state.agent.icon,
      attemptsUsed:     state.attemptsUsed,
      apiCallCount:     state.apiCallCount,
      finalScore:       state.totalScore,
      guesses:          state.guesses,
      warmupLatencyMs:  warmup?.latencyMs ?? null,
      warmupOk:         warmup?.ok ?? false,
      bestGuess,
      isCorrect:        state.hasCorrectGuess,
      reasoning,
    };
  });

  // Sort by score descending for display
  models.sort((a, b) => b.finalScore - a.finalScore);

  // Determine winner (highest score, ties broken by earliest correct guess time)
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
  console.log(`[ARENA/ROUND] ROUND COMPLETE`);
  console.log(`[ARENA/ROUND] Duration: ${durationMs}ms | Idiom: "${config.idiomPhrase}"`);
  console.log(`[ARENA/ROUND] Results:`);
  for (const m of models) {
    const status = m.isCorrect ? 'CORRECT' : m.finalScore < 0 ? 'WRONG' : 'NO_GUESS';
    const guessStr = m.bestGuess ? `"${m.bestGuess}"` : '(none)';
    console.log(
      `  ${m.icon} ${m.label.padEnd(22)} | ${String(m.finalScore).padStart(5)}pts | ${String(m.apiCallCount).padStart(1)}/${MAX_API_CALLS_PER_MODEL} calls | ${String(m.attemptsUsed).padStart(1)} att | ${status.padEnd(8)} | ${guessStr}`,
    );
  }
  if (winner) {
    console.log(`[ARENA/ROUND] Winner: ${winner.label} (+${winner.score}pts at ${winner.tMs}ms)`);
  } else {
    console.log(`[ARENA/ROUND] No winner this round`);
  }
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
  };
}
