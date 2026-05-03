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
import { getOrRefreshContext } from './news-context';
import { detectDomain } from './market-scorer';

// ── Provider response ─────────────────────────────────────────────────────────

interface ModelResponse {
  text:         string;
  inputTokens:  number;
  outputTokens: number;
  latencyMs:    number;
}

// ── Provider callers ──────────────────────────────────────────────────────────

// Per-call timeout: prevents a hung provider from blocking the entire round.
// Promise.allSettled in runAllAgentsOnRound collects all agents regardless of
// failures. 90 s accommodates slow providers (Gemini, xAI) under concurrent load:
// 5 markets × 6 agents = 30 simultaneous API calls which can saturate endpoints.
const AGENT_TIMEOUT_MS = 90_000;

async function callAnthropic(
  modelId:      string,
  systemPrompt: string,
  userMessage:  string,
  maxTokens:    number,
): Promise<ModelResponse> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: AGENT_TIMEOUT_MS });
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
  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}), timeout: AGENT_TIMEOUT_MS });
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

  const result = await Promise.race([
    model.generateContent({
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        // Cap thinking budget so reasoning doesn't consume the full token allowance.
        // thinkingBudget=8192 reserves the rest of the 32k window for JSON output.
        thinkingConfig: { thinkingBudget: 8192 },
      },
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Google API timeout after ${AGENT_TIMEOUT_MS}ms`)), AGENT_TIMEOUT_MS)
    ),
  ]);

  // Gemini 2.5 Pro is a thinking model: response.text() concatenates ALL parts
  // including thought=true parts, which pollutes the JSON with reasoning prose.
  // Always prefer non-thought parts as primary source; fall back to response.text()
  // only when there are no non-thought parts (non-thinking models).
  const candidate  = result.response.candidates?.[0];
  const allParts   = (candidate?.content?.parts ?? []) as any[];
  const nonThought = allParts.filter((p: any) => p.text && !p.thought);
  let text = nonThought.length > 0
    ? nonThought.map((p: any) => p.text ?? '').join('').trim()
    : '';
  if (!text) {
    // Non-thinking model or empty non-thought parts — use response.text()
    try { text = result.response.text().trim(); } catch { /* swallow */ }
  }
  if (!text) {
    // Last resort: concatenate all parts (catches thinking-only output)
    text = allParts.map((p: any) => p.text ?? '').join('').trim();
  }
  if (!text) {
    // Empty response — likely a safety block or token budget exhaustion.
    // Throw so runner logs this as an API error with diagnostics rather than
    // a silent parse error with raw="".
    const finishReason   = (candidate as any)?.finishReason ?? 'unknown';
    const safetyRatings  = JSON.stringify((candidate as any)?.safetyRatings ?? []);
    const candidateCount = result.response.candidates?.length ?? 0;
    throw new Error(
      `Gemini empty response — finishReason=${finishReason} ` +
      `candidates=${candidateCount} safety=${safetyRatings}`,
    );
  }

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
  // v2: role-based prompting (Manus §8.2). Null → falls back to strategy prompt.
  const role      = (agentDb.strategy_profile_json?.role as string | null) ?? null;
  const promptVer = role ? 'v2' : 'v1';
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
  const domain  = detectDomain(market.title, market.category);
  const newsCtx = await getOrRefreshContext(round.market_id, market.title, domain).catch(() => undefined);

  const ctx: MarketContext = {
    title:           market.title,
    description:     market.description ?? '',
    currentYesPrice: market.current_yes_price,
    volumeUsd:       market.volume_usd ?? 0,
    closeTime:       market.close_time,
    category:        market.category,
    recentSnapshots: snapshots.reverse(),
    newsContext:     newsCtx,
  };

  const systemPrompt = buildSystemPrompt(strategy, role);
  const userMessage  = buildUserMessage(ctx);

  // 4. Call model
  let response: ModelResponse;
  try {
    response = await callModel(provider, modelId, systemPrompt, userMessage, maxTokens);
  } catch (err: any) {
    const errorText = err?.message ?? String(err);
    console.error(`[FA/RUNNER] ${agentSlug} (${provider}/${modelId}) API error: ${errorText}`);

    // Wrap DB writes so a transient Supabase error never propagates out of
    // runAgentOnRound and causes Promise.allSettled to miss this agent's result.
    await faInsert('fa_submissions', [{
      round_id:        roundId,
      agent_id:        agentDb.id,
      probability_yes: 0.5,
      error_text:      errorText.slice(0, 2000),
    }]).catch(dbErr => console.warn(`[FA/RUNNER] ${agentSlug} submission insert failed:`, dbErr?.message));

    await faInsert('fa_audit_events', [{
      event_type:   'agent_error',
      entity_type:  'submission',
      entity_id:    roundId,
      actor:        agentSlug,
      payload_json: { error: errorText.slice(0, 500), model: modelId, provider },
    }]).catch(() => {});

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
    }]).catch(dbErr => console.warn(`[FA/RUNNER] ${agentSlug} parse-fail insert failed:`, dbErr?.message));

    return { success: false, agentSlug, error: 'Parse error', latencyMs: response.latencyMs, costUsd };
  }

  // 6. Persist submission — wrapped so a schema mismatch never silently kills the vote.
  let submissionId: string | undefined;
  try {
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
      // Diagnostic metadata — enables pre/post role-based Brier comparison.
      // prompt_version: 'v1' = legacy balanced monoculture, 'v2' = role-based.
      metadata_json:    { prompt_version: promptVer, role: role ?? 'none' },
    }], { returning: true });
    submissionId = Array.isArray(submissionRows) && submissionRows[0]
      ? (submissionRows[0] as any).id
      : undefined;
  } catch (dbErr: any) {
    console.error(`[FA/RUNNER] ${agentSlug} submission persist failed: ${dbErr?.message}`);
    // Return success=false so vote is not counted, but don't propagate —
    // Promise.allSettled must still collect this agent's result.
    return { success: false, agentSlug, error: `DB persist: ${dbErr?.message}`, latencyMs: response.latencyMs, costUsd };
  }

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
 * If pilotId + marketId are supplied, each successful call is logged to
 * fa_v2_ai_usage for cost tracking.
 */
export async function runAllAgentsOnRound(
  roundId:  string,
  pilotId?: string,
  marketId?: string,
  domain?:  string,
): Promise<SubmissionResult[]> {
  const agents = await faSelect<{ slug: string; id: string; model_id: string; strategy_profile_json: any }>(
    'fa_agents',
    'is_active=eq.true&select=slug,id,model_id,strategy_profile_json',
  );

  if (agents.length === 0) {
    console.warn('[FA/RUNNER] No active agents found');
    return [];
  }

  console.log(`[FA/RUNNER] Running ${agents.length} active agents on round ${roundId}`);

  // Promise.allSettled: collect every agent's result regardless of rejections.
  // One provider failure or DB error must not cause other agents' votes to be lost.
  const settled = await Promise.allSettled(
    agents.map(a => runAgentOnRound(a.slug, roundId)),
  );

  const results: SubmissionResult[] = settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : { success: false, agentSlug: agents[i].slug, error: String(s.reason) },
  );

  const succeeded = results.filter(r => r.success).length;
  console.log(`[FA/RUNNER] Round ${roundId}: ${succeeded}/${results.length} agents succeeded`);

  // Log per-call cost to fa_v2_ai_usage when running in a v2 pilot context
  if (pilotId && marketId) {
    const agentMap: Record<string, typeof agents[0]> = {};
    for (const a of agents) agentMap[a.slug] = a;

    const usageRows = results
      .filter(r => r.success && (r.costUsd ?? 0) > 0)
      .map(r => {
        const ag = agentMap[r.agentSlug];
        return {
          pilot_id:      pilotId,
          round_id:      roundId,
          market_id:     marketId,
          agent_id:      ag?.id ?? null,
          model_id:      ag?.model_id ?? r.agentSlug,
          role:          ag?.strategy_profile_json?.role ?? null,
          domain:        domain ?? null,
          input_tokens:  0,   // token breakdown not surfaced from SubmissionResult; cost stored
          output_tokens: 0,
          cost_usd:      r.costUsd ?? 0,
          latency_ms:    r.latencyMs ?? null,
        };
      });

    if (usageRows.length > 0) {
      await faInsert('fa_v2_ai_usage', usageRows).catch(e =>
        console.warn('[FA/RUNNER] ai_usage insert failed (non-fatal):', e?.message),
      );
    }
  }

  return results;
}
