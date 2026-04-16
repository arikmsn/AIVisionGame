/**
 * Forecast Arena — Agent definitions
 *
 * 4 agents with different strategies, using cheap models (claude-haiku-4-5, gpt-4o-mini).
 */

export interface ForecastAgentConfig {
  slug:          string;
  display_name:  string;
  model_id:      string;
  provider:      'anthropic' | 'openai';
  prompt_version: string;
  strategy:      string;
}

export const FORECAST_AGENTS: ForecastAgentConfig[] = [
  {
    slug:          'fast_reactor',
    display_name:  'Fast Reactor',
    model_id:      'claude-haiku-4-5',
    provider:      'anthropic',
    prompt_version: 'v1',
    strategy:      'speed_first',
  },
  {
    slug:          'text_analyst',
    display_name:  'Text Analyst',
    model_id:      'claude-haiku-4-5',
    provider:      'anthropic',
    prompt_version: 'v1',
    strategy:      'text_heavy',
  },
  {
    slug:          'contrarian',
    display_name:  'Contrarian',
    model_id:      'gpt-4o-mini',
    provider:      'openai',
    prompt_version: 'v1',
    strategy:      'contrarian',
  },
  {
    slug:          'consensus_guard',
    display_name:  'Consensus Guard',
    model_id:      'gpt-4o-mini',
    provider:      'openai',
    prompt_version: 'v1',
    strategy:      'anchored',
  },
];

/** Seed agents into fa_agents table */
export function agentSeedRows() {
  return FORECAST_AGENTS.map(a => ({
    slug:                  a.slug,
    display_name:          a.display_name,
    model_id:              a.model_id,
    provider:              a.provider,
    prompt_version:        a.prompt_version,
    strategy_profile_json: { strategy: a.strategy },
    is_active:             true,
  }));
}
