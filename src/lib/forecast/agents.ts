/**
 * Forecast Arena — Agent definitions
 *
 * Core league: 6 agents, one per top model from the main idiom arena.
 * Legacy agents (claude-haiku-4-5, gpt-4o-mini) are retained but set
 * is_active=false so they don't participate in run-round by default.
 */

import { FORECAST_MODEL_REGISTRY, type ForecastProvider } from './registry';

export interface ForecastAgentConfig {
  slug:           string;
  display_name:   string;
  model_id:       string;
  provider:       ForecastProvider | 'openai'; // openai covers legacy gpt-4o-mini
  prompt_version: string;
  strategy:       string;
  is_active:      boolean;
}

// ── Stable slug map for the 6 core league models ─────────────────────────────

const CORE_SLUG: Record<string, string> = {
  'claude-opus-4-6':              'opus_forecaster',
  'gpt-4.1':                      'gpt41_forecaster',
  'claude-sonnet-4-6':            'sonnet_forecaster',
  'grok-4.20-0309-non-reasoning': 'grok_forecaster',
  'gemini-2.5-pro':               'gemini_forecaster',
  'qwen/qwen2.5-vl-72b-instruct': 'qwen_forecaster',
};

const CORE_DISPLAY: Record<string, string> = {
  'claude-opus-4-6':              'Opus Forecaster',
  'gpt-4.1':                      'GPT-4.1 Forecaster',
  'claude-sonnet-4-6':            'Sonnet Forecaster',
  'grok-4.20-0309-non-reasoning': 'Grok Forecaster',
  'gemini-2.5-pro':               'Gemini Forecaster',
  'qwen/qwen2.5-vl-72b-instruct': 'Qwen Forecaster',
};

// ── Core League: 6 agents ────────────────────────────────────────────────────

export const CORE_FORECAST_AGENTS: ForecastAgentConfig[] = FORECAST_MODEL_REGISTRY.map(m => ({
  slug:           CORE_SLUG[m.modelId] ?? m.modelId.replace(/[^a-z0-9]/gi, '_').toLowerCase(),
  display_name:   CORE_DISPLAY[m.modelId] ?? `${m.displayName} Forecaster`,
  model_id:       m.modelId,
  provider:       m.provider,
  prompt_version: 'v1',
  strategy:       'balanced',
  is_active:      true,
}));

// ── Legacy agents (disabled — kept for historical data continuity) ───────────

export const LEGACY_FORECAST_AGENTS: ForecastAgentConfig[] = [
  {
    slug:           'fast_reactor',
    display_name:   'Fast Reactor (Legacy)',
    model_id:       'claude-haiku-4-5',
    provider:       'anthropic',
    prompt_version: 'v1',
    strategy:       'speed_first',
    is_active:      false,
  },
  {
    slug:           'text_analyst',
    display_name:   'Text Analyst (Legacy)',
    model_id:       'claude-haiku-4-5',
    provider:       'anthropic',
    prompt_version: 'v1',
    strategy:       'text_heavy',
    is_active:      false,
  },
  {
    slug:           'contrarian',
    display_name:   'Contrarian (Legacy)',
    model_id:       'gpt-4o-mini',
    provider:       'openai',
    prompt_version: 'v1',
    strategy:       'contrarian',
    is_active:      false,
  },
  {
    slug:           'consensus_guard',
    display_name:   'Consensus Guard (Legacy)',
    model_id:       'gpt-4o-mini',
    provider:       'openai',
    prompt_version: 'v1',
    strategy:       'anchored',
    is_active:      false,
  },
];

// ── Combined ──────────────────────────────────────────────────────────────────

/** All agents: core league first, then legacy (disabled). */
export const FORECAST_AGENTS: ForecastAgentConfig[] = [
  ...CORE_FORECAST_AGENTS,
  ...LEGACY_FORECAST_AGENTS,
];

/** Seed rows for fa_agents upsert. Idempotent on slug. */
export function agentSeedRows() {
  return FORECAST_AGENTS.map(a => ({
    slug:                  a.slug,
    display_name:          a.display_name,
    model_id:              a.model_id,
    provider:              a.provider,
    prompt_version:        a.prompt_version,
    strategy_profile_json: { strategy: a.strategy },
    is_active:             a.is_active,
  }));
}
