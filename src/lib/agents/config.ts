/**
 * Agent configuration — pure data, safe to import in both client and server code.
 * No SDK imports here. All model execution lives in factory.ts (server-only).
 */

export interface AgentConfig {
  /** Unique stable ID for this agent — used as React key and Pusher actor identifier */
  id: string;
  /** Display name shown in the leaderboard and chat feed */
  name: string;
  /** Which underlying model family this agent maps to */
  model: 'gpt4o' | 'claude' | 'gemini';
  /** Emoji or short icon label rendered in agent badge */
  icon: string;
  /** CSS hex color for border glow, badge outline, and victory flash */
  accentColor: string;
  /**
   * Min/max think time in seconds.
   * Lower-bound agents guess aggressively; higher-bound agents wait and exploit failures.
   */
  thinkTimeRange: [number, number];
  /** Sampling temperature passed to the underlying LLM */
  temperature: number;
  /** One-line description rendered on hover over the agent badge */
  description: string;
  /** Multi-sentence agent bio shown on the landing page "Machines are Ready" card */
  bio?: string;
  /** Developer / creator attribution shown on the landing page */
  developer?: string;
}

export const AGENT_REGISTRY: AgentConfig[] = [
  {
    id: 'gpt4o-arena',
    name: 'GPT-4o',
    model: 'gpt4o',
    icon: '🧠',
    accentColor: '#10a37f',
    thinkTimeRange: [4, 8],
    temperature: 0.3,
    description: 'Fast visual reasoner — guesses early with high confidence',
    bio: 'Strikes fast and confidently. Analyzes visual cues with precision, prioritizing first-mover advantage before rivals can prune the search space.',
    developer: 'OpenAI',
  },
  {
    id: 'claude-arena',
    name: 'Claude',
    model: 'claude',
    icon: '⚡',
    accentColor: '#D946EF',
    thinkTimeRange: [7, 12],
    temperature: 0.5,
    description: 'Patient analyst — waits for context, exploits failed guesses',
    bio: 'Observes before striking. Converts every rival failure into negative information, narrowing the idiom space before committing to a high-confidence guess.',
    developer: 'Anthropic',
  },
];

/** Quickly look up an agent config by its stable id */
export function getAgentById(id: string): AgentConfig | undefined {
  return AGENT_REGISTRY.find(a => a.id === id);
}

/** Returns true if the given player name is a registered agent */
export function isAgentPlayer(name: string): boolean {
  return AGENT_REGISTRY.some(a => a.name === name);
}

/** Returns the agent config whose name matches, or undefined */
export function getAgentByName(name: string): AgentConfig | undefined {
  return AGENT_REGISTRY.find(a => a.name === name);
}

// ── Shared types — safe to import on client and server ──────────────────────

export type RiskProfile = 'aggressive' | 'defensive' | 'balanced';

/**
 * A single intelligence event recorded when any player (human or bot) guesses.
 * Broadcast via Pusher `intelligence-update` and consumed by AnalyticsTerminal.
 */
export interface IntelligenceEvent {
  /** Round identifier — correlates events to a specific image */
  roundId: string;
  /** Name of the player or agent who made this guess */
  agentName: string;
  /** The guess text (Hebrew or English) */
  guess: string;
  /** Whether the guess was correct */
  isCorrect: boolean;
  /** Tokenized semantic concepts extracted from the guess — used for pruning */
  semanticCluster: string[];
  /** Absolute timestamp (ms since epoch) */
  timestamp: number;
  /** Milliseconds from round start to this guess */
  solveTimeMs: number;
  /** Agent's risk profile at the time of guessing; null for human players */
  riskProfile: RiskProfile | null;
  /**
   * PRD v4.0 — Zero-Learning Event flag.
   * True when this agent's semantic cluster overlaps concepts already pruned by
   * a rival's prior failure — meaning the agent ignored available negative info.
   */
  zeroLearning?: boolean;
  /**
   * PRD v4.0 — Potential reward R_i at the moment this guess was submitted.
   * Computed via computeDecayedReward(solveTimeMs) from mechanics.ts.
   */
  potentialReward?: number;
  /**
   * PRD v4.0.1 — Which attempt number this was for this agent within the round.
   * 1 = first attempt, 2 = first retry, 3 = second retry, etc.
   * Used to compute the Improvement Curve in the Research tab.
   */
  attemptNumber?: number;
  /**
   * PRD v5.0 — Strategic Rationale.
   * The agent's explicit game-theoretic reasoning before committing to this guess.
   * Required for all AI agents (external agents without it receive HTTP 400).
   * Displayed in the Analytics Terminal FEED and stored in the DB.
   */
  rationale?: string;
  /**
   * PRD v6.0 — Agent Think Time telemetry.
   * • Internal bots:      LLM API call duration measured in factory.ts
   * • External agents:    Processing time supplied by the agent in the request body
   * Stored in the `guesses` Supabase table for comparative latency analysis.
   * Displayed in the FEED tab of the Analytics Terminal.
   */
  latency_ms?: number;
}
