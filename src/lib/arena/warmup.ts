/**
 * Warm-up Ping System — Section 5.2 of AI Vision Arena Spec v2
 *
 * Pre-round warm-up (T-10s to T-5s):
 *   Send tiny dummy payload to each of 12 model endpoints ("Reply 'ok'")
 *   This wakes cold endpoints (especially Replicate 3-8s cold start).
 *   Models that don't respond within 5s are marked inactive for this round.
 *   Measure each model's warm-up latency, store as baseline.
 */

import type { AgentConfig } from '@/lib/agents/dispatcher';

const WARMUP_TIMEOUT_MS = 5_000;

export interface WarmupResult {
  modelId:    string;
  latencyMs:  number;
  ok:         boolean;
  error?:     string;
}

// ── Provider-specific warmup implementations ──────────────────────────────────

async function warmupOpenAI(agent: AgentConfig): Promise<void> {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  await client.chat.completions.create({
    model:      agent.modelId,
    messages:   [{ role: 'user', content: 'Reply with exactly: ok' }],
    max_tokens: 4,
  });
}

async function warmupAnthropic(agent: AgentConfig): Promise<void> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  await client.messages.create({
    model:      agent.modelId,
    max_tokens: 4,
    messages:   [{ role: 'user', content: 'Reply with exactly: ok' }],
  });
}

async function warmupGoogle(agent: AgentConfig): Promise<void> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '');
  const model = genAI.getGenerativeModel({ model: agent.modelId });
  await model.generateContent({
    contents:         [{ role: 'user', parts: [{ text: 'Reply with exactly: ok' }] }],
    generationConfig: { maxOutputTokens: 4 },
  });
}

async function warmupGroq(agent: AgentConfig): Promise<void> {
  const { default: Groq } = await import('groq-sdk');
  const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  await client.chat.completions.create({
    model:      agent.modelId,
    max_tokens: 4,
    messages:   [{ role: 'user', content: 'Reply with exactly: ok' }],
  });
}

async function warmupMistral(agent: AgentConfig): Promise<void> {
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model:      agent.modelId,
      max_tokens: 4,
      messages:   [{ role: 'user', content: 'Reply with exactly: ok' }],
    }),
    signal: AbortSignal.timeout(WARMUP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Mistral warmup HTTP ${res.status}`);
}

async function warmupReplicate(): Promise<void> {
  // Replicate cold starts are model-specific (GPU load). We can only verify
  // the API is reachable — actual model warm-up requires a full prediction.
  const res = await fetch('https://api.replicate.com/v1/models', {
    headers: { 'Authorization': `Bearer ${process.env.REPLICATE_API_TOKEN}` },
    signal:  AbortSignal.timeout(WARMUP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Replicate warmup HTTP ${res.status}`);
}

async function warmupXAI(agent: AgentConfig): Promise<void> {
  // xAI is OpenAI-compatible
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: 'https://api.x.ai/v1' });
  await client.chat.completions.create({
    model:      agent.modelId,
    messages:   [{ role: 'user', content: 'Reply with exactly: ok' }],
    max_tokens: 4,
  });
}

async function warmupOpenRouter(agent: AgentConfig): Promise<void> {
  // OpenRouter is OpenAI-compatible
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({
    apiKey:         process.env.OPENROUTER_API_KEY,
    baseURL:        'https://openrouter.ai/api/v1',
    defaultHeaders: { 'HTTP-Referer': 'https://ai-vision-game.vercel.app' },
  });
  await client.chat.completions.create({
    model:      agent.modelId,
    messages:   [{ role: 'user', content: 'Reply with exactly: ok' }],
    max_tokens: 4,
  });
}

async function warmupTogether(agent: AgentConfig): Promise<void> {
  // Together AI is OpenAI-compatible
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({
    apiKey:  process.env.TOGETHER_API_KEY,
    baseURL: 'https://api.together.xyz/v1',
  });
  await client.chat.completions.create({
    model:      agent.modelId,
    messages:   [{ role: 'user', content: 'Reply with exactly: ok' }],
    max_tokens: 4,
  });
}

// ── Single model ping ─────────────────────────────────────────────────────────

async function pingModel(agent: AgentConfig): Promise<WarmupResult> {
  // Skip if API key is missing
  if (agent.envKey && !process.env[agent.envKey]) {
    return { modelId: agent.modelId, latencyMs: 0, ok: false, error: 'key_missing' };
  }

  const t0 = Date.now();
  try {
    await Promise.race([
      warmupByProvider(agent),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Warmup timeout (${WARMUP_TIMEOUT_MS}ms)`)), WARMUP_TIMEOUT_MS),
      ),
    ]);
    const latencyMs = Date.now() - t0;
    console.log(`[ARENA/WARMUP] ${agent.label} (${agent.modelId}): ${latencyMs}ms OK`);
    return { modelId: agent.modelId, latencyMs, ok: true };
  } catch (err: any) {
    const latencyMs = Date.now() - t0;
    console.log(`[ARENA/WARMUP] ${agent.label} (${agent.modelId}): ${latencyMs}ms FAIL — ${err?.message}`);
    return { modelId: agent.modelId, latencyMs, ok: false, error: err?.message ?? 'Unknown error' };
  }
}

function warmupByProvider(agent: AgentConfig): Promise<void> {
  switch (agent.provider) {
    case 'openai':      return warmupOpenAI(agent);
    case 'anthropic':   return warmupAnthropic(agent);
    case 'google':      return warmupGoogle(agent);
    case 'groq':        return warmupGroq(agent);
    case 'mistral':     return warmupMistral(agent);
    case 'replicate':   return warmupReplicate();
    case 'xai':         return warmupXAI(agent);
    case 'openrouter':  return warmupOpenRouter(agent);
    case 'together':    return warmupTogether(agent);
    default:            throw new Error(`Unknown provider: ${agent.provider}`);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Warm up all arena models in parallel.
 * Returns a Map of modelId → WarmupResult.
 */
export async function warmupAllModels(
  agents: AgentConfig[],
): Promise<Map<string, WarmupResult>> {
  console.log(`[ARENA/WARMUP] Warming up ${agents.length} models...`);
  const t0 = Date.now();

  const results = await Promise.allSettled(agents.map(a => pingModel(a)));

  const map = new Map<string, WarmupResult>();
  for (const r of results) {
    if (r.status === 'fulfilled') {
      map.set(r.value.modelId, r.value);
    }
  }

  const okCount  = [...map.values()].filter(r => r.ok).length;
  const totalMs  = Date.now() - t0;
  console.log(`[ARENA/WARMUP] Done in ${totalMs}ms — ${okCount}/${agents.length} models warm`);

  return map;
}
