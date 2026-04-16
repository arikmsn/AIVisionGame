/**
 * Forecast Arena — Agent Runner
 *
 * Runs a single agent against a round's market context.
 * Calls Anthropic or OpenAI, parses output, persists to DB.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { faInsert, faSelect } from './db';
import { buildSystemPrompt, buildUserMessage, parseForecastOutput, type MarketContext } from './prompts';
import { FORECAST_AGENTS } from './agents';

// ── Cost estimates (per 1M tokens) ──────────────────────────────────────────

const COST_PER_M: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 0.80, output: 4.00 },
  'gpt-4o-mini':      { input: 0.15, output: 0.60 },
};

function estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
  const rates = COST_PER_M[modelId] ?? { input: 1.0, output: 3.0 };
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

// ── Provider callers ─────────────────────────────────────────────────────────

interface ModelResponse {
  text:         string;
  inputTokens:  number;
  outputTokens: number;
  latencyMs:    number;
}

async function callAnthropic(
  modelId: string,
  systemPrompt: string,
  userMessage: string,
): Promise<ModelResponse> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const start = Date.now();

  const response = await client.messages.create({
    model:      modelId,
    max_tokens: 1500,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userMessage }],
  });

  const latencyMs = Date.now() - start;
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('');

  return {
    text,
    inputTokens:  response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    latencyMs,
  };
}

async function callOpenAI(
  modelId: string,
  systemPrompt: string,
  userMessage: string,
): Promise<ModelResponse> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const start = Date.now();

  const response = await client.chat.completions.create({
    model:      modelId,
    max_tokens: 1500,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage },
    ],
  });

  const latencyMs = Date.now() - start;
  const text = response.choices[0]?.message?.content ?? '';

  return {
    text,
    inputTokens:  response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
    latencyMs,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface SubmissionResult {
  success:         boolean;
  submissionId?:   string;
  agentSlug:       string;
  probabilityYes?: number;
  action?:         string;
  rationaleShort?: string;
  latencyMs?:      number;
  costUsd?:        number;
  error?:          string;
}

export async function runAgentOnRound(
  agentSlug: string,
  roundId: string,
): Promise<SubmissionResult> {
  const agentConfig = FORECAST_AGENTS.find(a => a.slug === agentSlug);
  if (!agentConfig) {
    return { success: false, agentSlug, error: `Unknown agent: ${agentSlug}` };
  }

  // 1. Get agent DB record
  const agents = await faSelect<{ id: string; strategy_profile_json: any }>(
    'fa_agents',
    `slug=eq.${agentSlug}&select=id,strategy_profile_json`,
  );
  if (agents.length === 0) {
    return { success: false, agentSlug, error: `Agent ${agentSlug} not found in DB` };
  }
  const agentDbId = agents[0].id;
  const strategy = agents[0].strategy_profile_json?.strategy ?? agentConfig.strategy;

  // 2. Get round + market context
  const rounds = await faSelect<{
    id: string;
    market_id: string;
    market_yes_price_at_open: number;
    context_json: any;
  }>('fa_rounds', `id=eq.${roundId}&select=id,market_id,market_yes_price_at_open,context_json`);

  if (rounds.length === 0) {
    return { success: false, agentSlug, error: `Round ${roundId} not found` };
  }
  const round = rounds[0];

  const markets = await faSelect<{
    id: string; title: string; description: string; category: string;
    current_yes_price: number; volume_usd: number; close_time: string;
  }>('fa_markets', `id=eq.${round.market_id}&select=*`);

  if (markets.length === 0) {
    return { success: false, agentSlug, error: `Market for round ${roundId} not found` };
  }
  const market = markets[0];

  // Get recent snapshots
  const snapshots = await faSelect<{ timestamp: string; yes_price: number }>(
    'fa_market_snapshots',
    `market_id=eq.${round.market_id}&select=timestamp,yes_price&order=timestamp.desc&limit=5`,
  );

  // 3. Build prompt
  const ctx: MarketContext = {
    title:           market.title,
    description:     market.description ?? '',
    currentYesPrice: market.current_yes_price,
    volumeUsd:       market.volume_usd ?? 0,
    closeTime:       market.close_time,
    category:        market.category,
    recentSnapshots: snapshots.reverse(),
  };

  const systemPrompt = buildSystemPrompt(strategy);
  const userMessage = buildUserMessage(ctx);

  // 4. Call model
  let response: ModelResponse;
  try {
    if (agentConfig.provider === 'anthropic') {
      response = await callAnthropic(agentConfig.model_id, systemPrompt, userMessage);
    } else {
      response = await callOpenAI(agentConfig.model_id, systemPrompt, userMessage);
    }
  } catch (err: any) {
    const errorText = err?.message ?? String(err);
    console.error(`[FA/RUNNER] ${agentSlug} API error: ${errorText}`);

    // Insert error submission
    await faInsert('fa_submissions', [{
      round_id:    roundId,
      agent_id:    agentDbId,
      probability_yes: 0.5, // neutral default on error
      error_text:  errorText.slice(0, 2000),
    }]);

    await faInsert('fa_audit_events', [{
      event_type:   'agent_error',
      entity_type:  'submission',
      entity_id:    roundId,
      actor:        agentSlug,
      payload_json: { error: errorText.slice(0, 500), model: agentConfig.model_id },
    }]);

    return { success: false, agentSlug, error: errorText };
  }

  // 5. Parse output
  const parsed = parseForecastOutput(response.text);
  const costUsd = estimateCost(agentConfig.model_id, response.inputTokens, response.outputTokens);

  if (!parsed) {
    console.error(`[FA/RUNNER] ${agentSlug} parse error. Raw: ${response.text.slice(0, 300)}`);

    await faInsert('fa_submissions', [{
      round_id:        roundId,
      agent_id:        agentDbId,
      probability_yes: 0.5,
      raw_output_json: { raw: response.text.slice(0, 3000) },
      input_tokens:    response.inputTokens,
      output_tokens:   response.outputTokens,
      cost_usd:        costUsd,
      latency_ms:      response.latencyMs,
      error_text:      'Failed to parse structured output',
    }]);

    return { success: false, agentSlug, error: 'Parse error', latencyMs: response.latencyMs, costUsd };
  }

  // 6. Insert submission
  const submissionRows = await faInsert('fa_submissions', [{
    round_id:         roundId,
    agent_id:         agentDbId,
    probability_yes:  parsed.probability_yes,
    confidence:       parsed.confidence,
    action:           parsed.action,
    rationale_short:  parsed.rationale_short,
    rationale_full:   parsed.rationale_full,
    raw_context_json: { system: systemPrompt.slice(0, 500), user: userMessage.slice(0, 1000) },
    raw_output_json:  { raw: response.text.slice(0, 3000) },
    input_tokens:     response.inputTokens,
    output_tokens:    response.outputTokens,
    cost_usd:         costUsd,
    latency_ms:       response.latencyMs,
  }], { returning: true });

  const submissionId = Array.isArray(submissionRows) && submissionRows[0]
    ? (submissionRows[0] as any).id
    : undefined;

  // 7. Audit event
  await faInsert('fa_audit_events', [{
    event_type:   'agent_submission',
    entity_type:  'submission',
    entity_id:    submissionId ?? roundId,
    actor:        agentSlug,
    payload_json: {
      model:          agentConfig.model_id,
      probability:    parsed.probability_yes,
      action:         parsed.action,
      latency_ms:     response.latencyMs,
      cost_usd:       costUsd,
      input_tokens:   response.inputTokens,
      output_tokens:  response.outputTokens,
    },
  }]);

  console.log(
    `[FA/RUNNER] ${agentSlug} submitted: P(yes)=${parsed.probability_yes.toFixed(3)} ` +
    `action=${parsed.action} latency=${response.latencyMs}ms cost=$${costUsd.toFixed(5)}`,
  );

  return {
    success:        true,
    submissionId,
    agentSlug,
    probabilityYes: parsed.probability_yes,
    action:         parsed.action,
    rationaleShort: parsed.rationale_short,
    latencyMs:      response.latencyMs,
    costUsd,
  };
}

/**
 * Run all active agents on a round, in parallel.
 */
export async function runAllAgentsOnRound(roundId: string): Promise<SubmissionResult[]> {
  const agents = await faSelect<{ slug: string }>(
    'fa_agents',
    'is_active=eq.true&select=slug',
  );

  if (agents.length === 0) {
    console.warn('[FA/RUNNER] No active agents found');
    return [];
  }

  console.log(`[FA/RUNNER] Running ${agents.length} agents on round ${roundId}`);

  const results = await Promise.all(
    agents.map(a => runAgentOnRound(a.slug, roundId)),
  );

  const succeeded = results.filter(r => r.success).length;
  console.log(`[FA/RUNNER] Round ${roundId}: ${succeeded}/${results.length} agents succeeded`);

  return results;
}
