/**
 * Forecast Arena — Model Registry
 *
 * Single source of truth for all models that can participate in the Forecast Arena.
 * The 6 core league models match the top models from the main idiom arena.
 * Uses the same provider clients and env keys already configured project-wide.
 */

export type ForecastProvider = 'anthropic' | 'openai' | 'xai' | 'google' | 'openrouter';

export interface ForecastModelConfig {
  /** Exact model string passed to the provider API */
  modelId: string;
  /** Provider client to use */
  provider: ForecastProvider;
  /** Human-readable model name */
  displayName: string;
  /** Company / provider label */
  providerLabel: string;
  /** Env var key for the API key */
  envKey: string;
  /** Accent color for UI */
  accentColor: string;
  /** USD per 1 million input tokens */
  costPerMInput: number;
  /** USD per 1 million output tokens */
  costPerMOutput: number;
  /** max_tokens passed on each call */
  maxTokens: number;
  /** Sampling temperature */
  temperature: number;
}

// ── Core League: 6 models matching the main idiom arena top-6 ────────────────

export const FORECAST_MODEL_REGISTRY: ForecastModelConfig[] = [
  {
    modelId:        'claude-opus-4-6',
    provider:       'anthropic',
    displayName:    'Claude Opus 4.6',
    providerLabel:  'Anthropic',
    envKey:         'ANTHROPIC_API_KEY',
    accentColor:    '#f97316',
    costPerMInput:  15.00,
    costPerMOutput: 75.00,
    maxTokens:      1500,
    temperature:    0.3,
  },
  {
    modelId:        'gpt-4.1',
    provider:       'openai',
    displayName:    'GPT-4.1',
    providerLabel:  'OpenAI',
    envKey:         'OPENAI_API_KEY',
    accentColor:    '#10a37f',
    costPerMInput:  2.00,
    costPerMOutput: 8.00,
    maxTokens:      1500,
    temperature:    0.3,
  },
  {
    modelId:        'claude-sonnet-4-6',
    provider:       'anthropic',
    displayName:    'Claude Sonnet 4.6',
    providerLabel:  'Anthropic',
    envKey:         'ANTHROPIC_API_KEY',
    accentColor:    '#fbbf24',
    costPerMInput:  3.00,
    costPerMOutput: 15.00,
    maxTokens:      1500,
    temperature:    0.3,
  },
  {
    modelId:        'grok-4.20-0309-non-reasoning',
    provider:       'xai',
    displayName:    'Grok 4.20',
    providerLabel:  'xAI',
    envKey:         'XAI_API_KEY',
    accentColor:    '#ef4444',
    costPerMInput:  5.00,
    costPerMOutput: 15.00,
    maxTokens:      1500,
    temperature:    0.3,
  },
  {
    modelId:        'gemini-2.5-pro',
    provider:       'google',
    displayName:    'Gemini 2.5 Pro',
    providerLabel:  'Google',
    envKey:         'GOOGLE_GENERATIVE_AI_API_KEY',
    accentColor:    '#4285f4',
    costPerMInput:  1.25,
    costPerMOutput: 10.00,
    maxTokens:      32768, // thinking model: 32k total; thinkingBudget capped at 8k in callGoogle
    temperature:    0.3,
  },
  {
    modelId:        'qwen/qwen2.5-vl-72b-instruct',
    provider:       'openrouter',
    displayName:    'Qwen 2.5-VL 72B',
    providerLabel:  'Alibaba / OpenRouter',
    envKey:         'OPENROUTER_API_KEY',
    accentColor:    '#8b5cf6',
    costPerMInput:  0.40,
    costPerMOutput: 0.40,
    maxTokens:      1500,
    temperature:    0.3,
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getModelConfig(modelId: string): ForecastModelConfig | undefined {
  return FORECAST_MODEL_REGISTRY.find(m => m.modelId === modelId);
}

/**
 * Cost estimate based on registry rates.
 * Falls back to $1/$3 per M tokens for unknown models.
 */
export function estimateCost(
  modelId:      string,
  inputTokens:  number,
  outputTokens: number,
): number {
  const m = getModelConfig(modelId);
  const inputRate  = m?.costPerMInput  ?? 1.0;
  const outputRate = m?.costPerMOutput ?? 3.0;
  return (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000;
}
