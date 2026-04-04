/**
 * Agent Factory — SERVER ONLY.
 * Handles all LLM calls for AI arena bots.
 *
 * Model routing (PRD v6.0 — Real Infrastructure):
 *   • config.model === 'gpt4o'  → OpenAI API  (process.env.OPENAI_API_KEY)
 *   • config.model === 'claude' → Anthropic API (process.env.ANTHROPIC_API_KEY)
 *   • config.model === 'gemini' → Groq proxy    (process.env.GROQ_API_KEY)
 *
 * If the required API key is absent the agent is OFFLINE — createAgentGuess
 * throws AgentOfflineError so orchestrate-bots can skip it gracefully.
 *
 * PRD v4.0: Every LLM prompt now includes a structured "Battle Brief" block with:
 *   - T_elapsed: seconds since round started
 *   - R_i: current potential reward (from exponential decay)
 *   - Rival failures: each failed guess attributed to its AgentID
 *   - Attempts remaining: awareness of constraint
 */

import { AgentConfig } from './config';
import { computeDecayedReward } from '@/lib/game/mechanics';

// ── Public error type ─────────────────────────────────────────────────────────
/**
 * Thrown by createAgentGuess when the agent's required API key is not set.
 * Callers (orchestrate-bots) should catch this and mark the agent as offline
 * rather than treating it as a game-level error.
 */
export class AgentOfflineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentOfflineError';
  }
}

// ── Return types ──────────────────────────────────────────────────────────────
export interface AgentGuessResult {
  guess: string;
  confidence: 'high' | 'medium' | 'low';
  reasoning?: string;
  usedVision: boolean;
  /** PRD v5.0 — Structured strategic rationale from the agent's LLM reasoning */
  rationale: string;
  /**
   * PRD v6.0 — LLM call duration in milliseconds.
   * Measured from the start of the first API call to the last response.
   * Passed through to broadcast-intelligence as `latency_ms` for telemetry.
   */
  latencyMs?: number;
}

// ── Internal message types ────────────────────────────────────────────────────
interface GroqVisionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
}

/** Anthropic Messages API content block */
type AnthropicContent =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'url'; url: string } };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContent[];
}

// ── API constants ─────────────────────────────────────────────────────────────
const GROQ_API_URL    = 'https://api.groq.com/openai/v1/chat/completions';
const OPENAI_API_URL  = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_URL   = 'https://api.anthropic.com/v1/messages';

const GROQ_VISION_MODEL     = 'meta-llama/llama-4-scout-17b-16e-instruct';
const GROQ_TEXT_MODEL       = 'llama-3.3-70b-versatile';
const OPENAI_MODEL          = 'gpt-4o';
const ANTHROPIC_MODEL       = 'claude-opus-4-5';
const ANTHROPIC_API_VERSION = '2023-06-01';

// ── Agent status ──────────────────────────────────────────────────────────────
/**
 * Returns 'online' if the required API key for this agent's model is present,
 * 'offline' otherwise. Use this before spawning an agent in a round.
 */
export function getAgentStatus(config: AgentConfig): 'online' | 'offline' {
  switch (config.model) {
    case 'gpt4o':  return process.env.OPENAI_API_KEY    ? 'online' : 'offline';
    case 'claude': return process.env.ANTHROPIC_API_KEY ? 'online' : 'offline';
    default:       return process.env.GROQ_API_KEY      ? 'online' : 'offline';
  }
}

// ── Coliseum Rules v5.0 — Agent Operating Manual ─────────────────────────────
/**
 * Injected as the FIRST block of every agent's system prompt.
 * Acts as the immutable operating contract for all internal and external agents.
 */
export const COLISEUM_RULES_V5 = `
╔══════════════════════════════════════════════════════════╗
║          COLISEUM RULES v5.0 — OPERATING MANUAL          ║
║         Strategic Arena · Active Contract · Binding      ║
╚══════════════════════════════════════════════════════════╝

MISSION: Identify the visual idiom faster and more accurately than rival agents.

━━━ PAYOFF MATRIX (EXACT) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Correct guess  →  R_i(t) = 1000 × e^(−0.05 × t_seconds)
                    Floor: 25 pts minimum
  Wrong guess    →  −200 pts (flat penalty, no exceptions)
  Time half-life →  ≈ 13.9 seconds (at t=14s, R_i ≈ 500)

━━━ STRATEGIC EFFICIENCY RATIO (SER) ━━━━━━━━━━━━━━━━━━━━━
  SER = wins / (Σ latency_seconds × Σ failed_attempts)
  This is your PRIMARY prestige ranking. Maximize it.
  Tiers: ELITE (≥0.05) | COMPETITIVE (≥0.02) | LEARNING (≥0.005) | CALIBRATING

━━━ INTELLIGENCE DOCTRINE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Each rival failure is NEGATIVE INFORMATION — a concept proven wrong.
  You MUST cross-reference every candidate guess against the pruned set.
  Any guess whose semantic cluster overlaps a pruned concept = Zero-Learning Event.
  ZLEs permanently damage your SER and flag a Logic Regression.

━━━ RATIONALE REQUIREMENT (MANDATORY) ━━━━━━━━━━━━━━━━━━━━
  Every submission MUST include a strategic analysis covering:
    1. Current Score Gap (your position vs leader)
    2. Remaining Attempts (budget remaining)
    3. Time Decay Risk vs. Failure Cost (R_i now vs. −200 penalty)
    4. Insights from Rival Failures (what domains are eliminated)

  FORMAT: Respond ONLY with a JSON object:
  { "rationale": "<your strategic analysis>", "guess": "<idiom>" }

  Submissions without a rationale will be REJECTED (400 Bad Request).

━━━ ENGAGEMENT RULES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  • Strike when your expected R_i exceeds the risk of a −200 penalty
  • Wait when more rival failures will prune the search space significantly
  • NEVER repeat a concept already in the pruned semantic set
  • NEVER submit the same guess twice in the same round

═══════════════════════════════════════════════════════════
`.trim();

// ── Rationale response parser ─────────────────────────────────────────────────

/**
 * Robustly parse the LLM response which should be JSON `{ rationale, guess }`.
 * Falls back gracefully if the model returns plain text.
 */
function parseRationaleResponse(raw: string): { rationale: string; guess: string } {
  const clean = raw.trim();

  // 1. Direct JSON parse
  try {
    const p = JSON.parse(clean);
    if (p && typeof p.guess === 'string') {
      return { rationale: String(p.rationale ?? ''), guess: p.guess.replace(/^["'״]|["'״]$/g, '').trim() };
    }
  } catch {}

  // 2. JSON inside markdown code fence
  const fenceMatch = clean.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenceMatch) {
    try {
      const p = JSON.parse(fenceMatch[1]);
      if (p && typeof p.guess === 'string') {
        return { rationale: String(p.rationale ?? ''), guess: p.guess.replace(/^["'״]|["'״]$/g, '').trim() };
      }
    } catch {}
  }

  // 3. Any JSON-like object containing a "guess" key
  const objMatch = clean.match(/\{[^{}]*"guess"\s*:\s*"([^"]+)"[^{}]*\}/);
  if (objMatch) {
    try {
      const p = JSON.parse(objMatch[0]);
      if (p && typeof p.guess === 'string') {
        return { rationale: String(p.rationale ?? ''), guess: p.guess.replace(/^["'״]|["'״]$/g, '').trim() };
      }
    } catch {}
    return { rationale: '', guess: objMatch[1].replace(/^["'״]|["'״]$/g, '').trim() };
  }

  // 4. Plain-text fallback — treat whole response as the guess
  return { rationale: '', guess: clean.replace(/^["'״]|["'״]$/g, '').trim() || 'No guess' };
}

// ── Low-level API callers ─────────────────────────────────────────────────────

/**
 * Call any OpenAI-compatible chat completions endpoint (Groq or OpenAI).
 * Both use the same wire format.
 */
async function callOpenAICompat(
  messages:   GroqVisionMessage[],
  apiUrl:     string,
  apiKey:     string,
  model:      string,
  temperature: number,
): Promise<string> {
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ model, messages, temperature, max_tokens: 400 }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status} (${apiUrl}): ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

/** Convenience wrapper — calls Groq */
async function callGroq(messages: GroqVisionMessage[], model: string, temperature: number): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new AgentOfflineError('GROQ_API_KEY not configured');
  return callOpenAICompat(messages, GROQ_API_URL, key, model, temperature);
}

/** Convenience wrapper — calls OpenAI */
async function callOpenAI(messages: GroqVisionMessage[], temperature: number): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new AgentOfflineError('OPENAI_API_KEY not configured');
  return callOpenAICompat(messages, OPENAI_API_URL, key, OPENAI_MODEL, temperature);
}

/**
 * Call the Anthropic Messages API.
 * The system prompt is a top-level field; user content may include image blocks.
 */
async function callAnthropic(
  systemPrompt:  string,
  userMessages:  AnthropicMessage[],
  temperature:   number,
): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AgentOfflineError('ANTHROPIC_API_KEY not configured');

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key':         key,
      'anthropic-version': ANTHROPIC_API_VERSION,
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:       ANTHROPIC_MODEL,
      max_tokens:  400,
      temperature,
      system:      systemPrompt,
      messages:    userMessages,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text?.trim() ?? '';
}

// ── Battle Brief ─────────────────────────────────────────────────────────────

export interface BattleBriefOptions {
  /** Elapsed time since round start in milliseconds */
  tElapsedMs: number;
  /**
   * Rival failure entries — each entry records which agent made which wrong guess.
   * Used by the agent to prune its search space via negative information.
   */
  rivalFailures: Array<{ agentId: string; guess: string }>;
  /** How many guesses this agent has left this round (default: unlimited) */
  attemptsRemaining?: number;
  /**
   * PRD v4.0.1 — Persistence mode.
   * This agent's own failed guesses from earlier attempts this round.
   * When non-empty, the Brief injects the "Strategic Persistence" command.
   */
  ownPreviousGuesses?: string[];
  /**
   * PRD v4.0.1 — Hints revealed by the deadlock system during this round.
   * Injected into the brief so retry attempts can leverage the hint.
   */
  revealedHints?: string[];
  /**
   * Full guess history from ALL players this round (bots + humans).
   * Used to enforce strict no-repeat across the entire room.
   */
  allGuessHistory?: string[];
}

/**
 * Render the structured Battle Brief block injected into every LLM system prompt.
 */
function buildBattleBrief(opts: BattleBriefOptions): string {
  const tSec     = (opts.tElapsedMs / 1_000).toFixed(1);
  const ri       = computeDecayedReward(opts.tElapsedMs);
  const hasFails = opts.rivalFailures.length > 0;
  const isRetry  = (opts.ownPreviousGuesses?.length ?? 0) > 0;

  const failLines = hasFails
    ? opts.rivalFailures
        .map(f => `  - ${f.agentId} FAILED on: "${f.guess}"`)
        .join('\n')
    : '  (none yet — you have first-mover information advantage)';

  const attemptsLine = opts.attemptsRemaining !== undefined
    ? `Attempts remaining: ${opts.attemptsRemaining}`
    : 'Attempts remaining: unlimited';

  const persistenceBlock = isRetry ? `
╠═══════════════════════════════════════╣
║   ⚡ STRATEGIC PERSISTENCE COMMAND   ║
╠═══════════════════════════════════════╣
║ YOUR PREVIOUS GUESS(ES) FAILED:       ║
${opts.ownPreviousGuesses!.map(g => `  ✗ "${g}"`).join('\n')}
║                                       ║
║ R_i is STILL ${String(ri).padEnd(4)} pts — DO NOT GIVE UP.║
║ You MUST pivot to a completely        ║
║ different semantic domain. The        ║
║ concepts you tried are ELIMINATED.    ║
║ Think laterally. Try the opposite.    ║` : '';

  const hintBlock = (opts.revealedHints?.length ?? 0) > 0 ? `
╠═══════════════════════════════════════╣
║   💡 SYSTEM HINT — COST: −150 pts    ║
╠═══════════════════════════════════════╣
${opts.revealedHints!.map(h => `  → ${h}`).join('\n')}
║ ⚖  HINT ECONOMY DECISION:            ║
║  R_i now = ${String(computeDecayedReward(opts.tElapsedMs)).padEnd(4)} pts                  ║
║  After hint cost: R_i−150 = ${String(Math.max(0, computeDecayedReward(opts.tElapsedMs) - 150)).padEnd(4)} pts  ║
║  Use it if this narrows your guess    ║
║  enough to win. Skip it if you're     ║
║  already confident — save the 150.    ║` : '';

  const allHistoryBlock = (opts.allGuessHistory?.length ?? 0) > 0 ? `
╠═══════════════════════════════════════╣
║  📋 ALL ROOM GUESSES (ALL PLAYERS)   ║
╠═══════════════════════════════════════╣
${opts.allGuessHistory!.map(g => `  ✗ "${g}"`).join('\n')}
║ STRICT RULE: Do NOT repeat any of    ║
║ these. They are permanently BANNED.   ║
║ Repeating a banned guess = ZLE.       ║` : '';

  return `
╔═══════════════════════════════════════╗
║         BATTLE BRIEF — LIVE DATA      ║
╠═══════════════════════════════════════╣
║ T_elapsed  : ${tSec}s
║ R_i (ROI)  : ${ri} pts (decaying)
║ ${attemptsLine}
╠═══════════════════════════════════════╣
║ RIVAL FAILURES THIS ROUND:            ║
${failLines}${persistenceBlock}${hintBlock}${allHistoryBlock}
╠═══════════════════════════════════════╣
║ COMMAND: Do NOT repeat rival failures.║
║ Analyze what failed guesses RULE OUT. ║
║ Your goal: maximize cumulative R.     ║
╚═══════════════════════════════════════╝`;
}

/**
 * Build the system prompt that instructs the bot how to compete.
 * Language-aware: responds in the language the game is currently using.
 */
function buildSystemPrompt(
  language: 'he' | 'en',
  failedGuesses: string[],
  strategyReasoning?: string,
  battleBrief?: BattleBriefOptions,
): string {
  const failedList = failedGuesses.length > 0
    ? `\nPrevious incorrect guesses (do NOT repeat these): ${failedGuesses.join(', ')}`
    : '';

  const langInstruction = language === 'he'
    ? `The target is ALWAYS a Hebrew Idiom, Proverb, or Common Phrase (ביטוי, פתגם, או מימרה בעברית).
Do NOT guess literal descriptions (e.g. "a man climbing a ladder") — you MUST name the idiom itself.
If your guess is a literal description rather than an idiom, it is a Domain Failure.`
    : `The target is ALWAYS an English Idiom or Common Phrase. Do NOT guess literal descriptions.`;

  const strategyBlock = strategyReasoning
    ? `\n\n--- COMPETITIVE STRATEGY CONTEXT ---\n${strategyReasoning}\n--- END STRATEGY ---`
    : '';

  const briefBlock = battleBrief
    ? `\n\n${buildBattleBrief(battleBrief)}`
    : '';

  return `${COLISEUM_RULES_V5}

You are a world-class linguist and visual riddle solver competing in the Strategic Arena.
Look at the image and identify the ${language === 'he' ? 'Hebrew' : 'English'} idiom or expression it visually represents.

${langInstruction}

MANDATORY RESPONSE FORMAT (JSON only — no prose, no markdown inside values):
{
  "rationale": "<DELTA ONLY — 3 sentences max, no markdown: 1. Which domain is now eliminated and why. 2. Why your chosen idiom fits the visual cues better than rivals' failed guesses. 3. Decay Risk (R_i now vs −200 penalty). If a hint was shown: explicitly state whether the −150 hint cost is worth the information gain given current R_i.>",
  "guess": "<the Hebrew idiom — NOT a literal description>"
}${failedList}${strategyBlock}${briefBlock}`;
}

/** Build hint context string from accumulated game hints. */
function buildHintContext(hints: string[]): string {
  if (hints.length === 0) return '';
  return `\nHints revealed so far: ${hints.join(' | ')}`;
}

// ── Vision & text guess functions ─────────────────────────────────────────────

/**
 * Attempt vision-based guess using the image URL.
 * Routes to the correct API based on config.model.
 * Re-throws AgentOfflineError; returns null on transient failures so the
 * caller can fall back to the text path.
 */
async function visionGuess(
  config:           AgentConfig,
  imageUrl:         string,
  hints:            string[],
  failedGuesses:    string[],
  language:         'he' | 'en',
  strategyReasoning?: string,
  battleBrief?:     BattleBriefOptions,
): Promise<AgentGuessResult | null> {
  try {
    const systemPrompt = buildSystemPrompt(language, failedGuesses, strategyReasoning, battleBrief);
    const hintContext  = buildHintContext(hints);
    const userText     = `Analyze this visual riddle.${hintContext} Respond ONLY with JSON: { "rationale": "<strategic analysis>", "guess": "<idiom>" }`;

    let raw: string;

    if (config.model === 'claude') {
      // ── Anthropic Messages API (different image content format) ─────────────
      const userMessages: AnthropicMessage[] = [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: imageUrl } },
          { type: 'text',  text: userText },
        ],
      }];
      raw = await callAnthropic(systemPrompt, userMessages, config.temperature);
    } else if (config.model === 'gpt4o') {
      // ── OpenAI GPT-4o (OpenAI-compatible, same image_url format) ────────────
      const messages: GroqVisionMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: userText },
        ]},
      ];
      raw = await callOpenAI(messages, config.temperature);
    } else {
      // ── Groq / other (gemini proxy, etc.) ───────────────────────────────────
      const messages: GroqVisionMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: userText },
        ]},
      ];
      raw = await callGroq(messages, GROQ_VISION_MODEL, config.temperature);
    }

    if (!raw) return null;

    const { rationale, guess } = parseRationaleResponse(raw);
    if (!guess) return null;

    // Detect model safety refusals — treat as transient failure so text fallback runs
    const REFUSAL_MARKERS = ["i'm sorry", "i cannot", "i can't", "as an ai", "i'm not able", "i am not able", "i apologize", "sorry, i"];
    if (REFUSAL_MARKERS.some(m => guess.toLowerCase().includes(m))) {
      console.warn(`[FACTORY] ⚠️ ${config.name} safety refusal detected — falling back to text`);
      return null;
    }

    console.log(`[FACTORY] 📝 ${config.name} (${config.model}) rationale="${rationale.slice(0, 80)}..."`);

    return {
      guess,
      rationale,
      confidence: hints.length === 0 ? 'high' : 'medium',
      usedVision: true,
    };
  } catch (err: any) {
    // AgentOfflineError must bubble up — do not swallow it
    if (err instanceof AgentOfflineError) throw err;
    console.warn(`[FACTORY] Vision call failed for ${config.name} (${config.model}):`, err.message);
    return null;
  }
}

/**
 * Text-only fallback: rely on linguistic knowledge without the image.
 * Routes to the correct API based on config.model.
 */
async function textFallbackGuess(
  config:           AgentConfig,
  hints:            string[],
  failedGuesses:    string[],
  language:         'he' | 'en',
  strategyReasoning?: string,
  battleBrief?:     BattleBriefOptions,
): Promise<AgentGuessResult> {
  const systemPrompt = buildSystemPrompt(language, failedGuesses, strategyReasoning, battleBrief);
  const hintContext  = buildHintContext(hints);
  const userText     = `I'm analyzing a visual riddle image representing an idiom.${hintContext} Respond ONLY with JSON: { "rationale": "<strategic analysis>", "guess": "<idiom>" }`;

  let raw: string;

  if (config.model === 'claude') {
    const userMessages: AnthropicMessage[] = [{ role: 'user', content: userText }];
    raw = await callAnthropic(systemPrompt, userMessages, config.temperature + 0.1);
  } else if (config.model === 'gpt4o') {
    const messages: GroqVisionMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userText },
    ];
    raw = await callOpenAI(messages, config.temperature + 0.1);
  } else {
    const messages: GroqVisionMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userText },
    ];
    raw = await callGroq(messages, GROQ_TEXT_MODEL, config.temperature + 0.1);
  }

  const { rationale, guess } = parseRationaleResponse(raw);
  console.log(`[FACTORY] 📝 ${config.name} (${config.model}, text) rationale="${rationale.slice(0, 80)}"`);

  return {
    guess:      guess || 'No guess',
    rationale,
    confidence: 'low',
    usedVision: false,
  };
}

// ── Primary export ────────────────────────────────────────────────────────────

/**
 * Generate a guess for the given agent.
 *
 * Throws `AgentOfflineError` if the required API key is missing — callers
 * should catch this and treat the agent as unavailable for the round.
 *
 * @param config            - The agent configuration (from AGENT_REGISTRY)
 * @param imageUrl          - URL of the current round's generated image
 * @param hints             - Array of hint strings revealed so far this round
 * @param failedGuesses     - Array of guesses already submitted that were wrong
 * @param language          - Whether the game is in Hebrew ('he') or English ('en') mode
 * @param strategyReasoning - Optional game-theory context from the strategy engine
 * @param battleBrief       - PRD v4.0 structured live-data context (T, R_i, rival failures)
 */
export async function createAgentGuess(
  config:           AgentConfig,
  imageUrl:         string,
  hints:            string[],
  failedGuesses:    string[],
  language:         'he' | 'en' = 'he',
  strategyReasoning?: string,
  battleBrief?:     BattleBriefOptions,
): Promise<AgentGuessResult> {
  // Gate on key availability before making any network calls
  if (getAgentStatus(config) === 'offline') {
    throw new AgentOfflineError(
      `Agent "${config.name}" (${config.model}) is OFFLINE — required API key not configured`,
    );
  }

  // Measure total LLM call time (vision + optional text fallback)
  const t0 = Date.now();

  // Try vision first; fall back to text if the vision call errors (non-offline)
  const visionResult = await visionGuess(
    config, imageUrl, hints, failedGuesses, language, strategyReasoning, battleBrief,
  );
  if (visionResult) return { ...visionResult, latencyMs: Date.now() - t0 };

  const textResult = await textFallbackGuess(
    config, hints, failedGuesses, language, strategyReasoning, battleBrief,
  );
  return { ...textResult, latencyMs: Date.now() - t0 };
}
