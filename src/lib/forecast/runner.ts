/**
 * Forecast Arena — Agent Runner
 *
 * Runs a single agent against a round's market context.
 * Supports all 5 providers used in the main idiom arena:
 *   anthropic, openai, xai (OpenAI-compat), google, openrouter (OpenAI-compat)
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { faInsert, faSelect } from './db';
import { buildSystemPrompt, buildUserMessage, parseForecastOutput, type MarketContext } from './prompts';
import { FORECAST_AGENTS } from './agents';
import { getModelConfig, estimateCost, type ForecastProvider } from './registry';

// ── Provider response ─────────────────────────────────────────────────────────

interface ModelResponse {
  text:         string;
  inputTokens:  number;
  outputTokens: number;
  latencyMs:    number;
}

// ── Provider callers ──────────────────────────────────────────────────────────

async function callAnthropic(
  modelId:      string,
  systemPrompt: string,
  userMessage:  string,
  maxTokens:    number,
): Promise<ModelResponse> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const start  = Date.now();

  const response = await client.messages.create({
    model:      modelId,
    max_tokens: maxTokens,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userMessage }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('');

  return {
    text,
    inputTokens:  response.usage?.input_tokens  ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    latencyMs:    Date.now() - start,
  };
}

async function callOpenAICompat(
  modelId:      string,
  systemPrompt: string,
  userMessage:  string,
  maxTokens:    number,
  apiKey:       string | undefined,
  baseURL?:     string,
): Promise<ModelResponse> {
  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  const start  = Date.now();

  const response = await client.chat.completions.create({
    model:      modelId,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage  },
    ],
  });

  return {
    text:         response.choices[0]?.message?.content ?? '',
    inputTokens:  response.usage?.prompt_tokens     ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
    latencyMs:    Date.now() - start,
  };
}

async function callGoogle(
  modelId:      string,
  systemPrompt: string,
  userMessage:  string,
  maxTokens:    number,
): Promise<ModelResponse> {
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '');
  // Pass system prompt via systemInstruction; force JSON MIME type so output is
  // always valid JSON (no preamble, no markdown fences from thinking models).
  const model = genAI.getGenerativeModel({
    model: modelId,
    systemInstruction: systemPrompt,
  });
  const start = Date.now();

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: {
      maxOutputTokens:  maxTokens,
      responseMimeType: 'application/json',
    },
  });

  // For thinking models, the JSON answer may be split across multiple parts.
  // Concatenate all non-thought text parts; fall back to the full text() response.
  const parts = (result.response.candidates?.[0]?.content?.parts ?? []) as any[];
  const nonThoughtParts = parts.filter((p: any) => p.text && !p.thought);
  let text = nonThoughtParts.length > 0
    ? nonThoughtParts.map((p: any) => p.text).join('')
    : (result.response.text?.() ?? '');
  text = text.trim();

  const meta = result.response.usageMetadata;
  return {
    text,
    inputTokens:  meta?.promptTokenCount     ?? 0,
    outputTokens: meta?.candidatesTokenCount ?? 0,
    latencyMs:    Date.now() - start,
  };
}

// ── Provider dispatch ─────────────────────────────────────────────────────────

async function callModel(
  provider:     ForecastProvider | string,
  modelId:      string,
  systemPrompt: string,
  userMessage:  string,
  maxTokens:    number,
): Promise<ModelResponse> {
  switch (provider) {
    case 'anthropic':
      return callAnthropic(modelId, systemPrompt, userMessage, maxTokens);

    case 'openai':
      return callOpenAICompat(
        modelId, systemPrompt, userMessage, maxTokens,
        process.env.OPENAI_API_KEY,
      );

    case 'xai':
      return callOpenAICompat(
        modelId, systemPrompt, userMessage, maxTokens,
        process.env.XAI_API_KEY,
        'https://api.x.ai/v1',
      );

    case 'openrouter':
      return callOpenAICompat(
        modelId, systemPrompt, userMessage, maxTokens,
        process.env.OPENROUTER_API_KEY,
        'https://openrouter.ai/api/v1',
      );

    case 'google':
      return callGoogle(modelId, systemPrompt, userMessage, maxTokens);

    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

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
  roundId:   string,
): Promise<SubmissionResult> {
  // 1. Get agent DB record (source of truth for model_id / provider)
  const agents = await faSelect<{
    id: string; model_id: string; provider: string; strategy_profile_json: any;
  }>('fa_agents', `slug=eq.${agentSlug}&select=id,model_id,provider,strategy_profile_json`);

  if (agents.length === 0) {
    return { success: false, agentSlug, error: `Agent ${agentSlug} not found in DB` };
  }
  const agentDb   = agents[0];
  const modelId   = agentDb.model_id;
  const provider  = agentDb.provider;
  const strategy  = agentDb.strategy_profile_json?.strategy ?? 'balanced';
  const maxTokens = getModelConfig(modelId)?.maxTokens ?? 1500;

  // 2. Get round + market context
  const rounds = await faSelect<{
    id: string; market_id: string; market_yes_price_at_open: number; context_json: any;
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

  const snapshots = await faSelect<{ timestamp: string; yes_price: number }>(
    'fa_market_snapshots',
    `market_id=eq.${round.market_id}&select=timestamp,yes_price&order=timestamp.desc&limit=5`,
  );

  // 3. Build prompts
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
  const userMessage  = buildUserMessage(ctx);

  // 4. Call model
  let response: ModelResponse;
  try {
    response = await callModel(provider, modelId, systemPrompt, userMessage, maxTokens);
  } catch (err: any) {
    const errorText = err?.message ?? String(err);
    console.error(`[FA/RUNNER] ${agentSlug} (${provider}/${modelId}) API error: ${errorText}`);

    await faInsert('fa_submissions', [{
      round_id:        roundId,
      agent_id:        agentDb.id,
      probability_yes: 0.5,
      error_text:      errorText.slice(0, 2000),
    }]);

    await faInsert('fa_audit_events', [{
      event_type:   'agent_error',
      entity_type:  'submission',
      entity_id:    roundId,
      actor:        agentSlug,
      payload_json: { error: errorText.slice(0, 500), model: modelId, provider },
    }]);

    return { success: false, agentSlug, error: errorText };
  }

  // 5. Parse output
  const parsed  = parseForecastOutput(response.text);
  const costUsd = estimateCost(modelId, response.inputTokens, response.outputTokens);

  if (!parsed) {
    console.error(`[FA/RUNNER] ${agentSlug} parse error. Raw: ${response.text.slice(0, 300)}`);

    await faInsert('fa_submissions', [{
      round_id:        roundId,
      agent_id:        agentDb.id,
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

  // 6. Persist submission
  const submissionRows = await faInsert('fa_submissions', [{
    round_id:         roundId,
    agent_id:         agentDb.id,
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
      model:         modelId,
      provider,
      probability:   parsed.probability_yes,
      action:        parsed.action,
      latency_ms:    response.latencyMs,
      cost_usd:      costUsd,
      input_tokens:  response.inputTokens,
      output_tokens: response.outputTokens,
    },
  }]);

  console.log(
    `[FA/RUNNER] ${agentSlug} (${provider}/${modelId}) ` +
    `P(yes)=${parsed.probability_yes.toFixed(3)} action=${parsed.action} ` +
    `latency=${response.latencyMs}ms cost=$${costUsd.toFixed(5)}`,
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
 * Run all active agents on a round in parallel.
 * Active agents are determined by fa_agents.is_active = true in the DB.
 * Toggle is_active in the DB to include/exclude any agent without a deploy.
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

  console.log(`[FA/RUNNER] Running ${agents.length} active agents on round ${roundId}`);

  const results = await Promise.all(
    agents.map(a => runAgentOnRound(a.slug, roundId)),
  );

  const succeeded = results.filter(r => r.success).length;
  console.log(`[FA/RUNNER] Round ${roundId}: ${succeeded}/${results.length} agents succeeded`);

  return results;
}
