/**
 * Multi-Provider Vision Dispatcher — Arena v2.0 / Phase 3
 *
 * Changes in Phase 3:
 *   • Token usage tracking: every provider returns { text, inputTokens, outputTokens }
 *   • Kimi K2.5 (Together AI): max_tokens 2048→3072, single retry on any error
 *   • Raw response logging when reasoning field is empty after parsing
 *   • ArenaProbeResult gains inputTokens / outputTokens for cost monitoring
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import Replicate from 'replicate';

// ── Agent registry ────────────────────────────────────────────────────────────

export interface AgentConfig {
  modelId:       string;
  provider:      'openai' | 'anthropic' | 'groq' | 'google' | 'replicate' | 'mistral' | 'xai' | 'openrouter' | 'together';
  label:         string;
  providerLabel: string;
  envKey:        string | null;
  accentColor:   string;
  icon:          string;
}

export const ARENA_AGENTS: AgentConfig[] = [
  { modelId: 'gemini-2.5-pro',                            provider: 'google',    label: 'Gemini 2.5 Pro',    providerLabel: 'Google',     envKey: 'GOOGLE_GENERATIVE_AI_API_KEY', accentColor: '#4285f4', icon: '🔵' },
  { modelId: 'gemma-3-27b-it',                            provider: 'google',    label: 'Gemma 3 27B',       providerLabel: 'Google',     envKey: 'GOOGLE_GENERATIVE_AI_API_KEY', accentColor: '#34a853', icon: '💚' },
  { modelId: 'claude-opus-4-6',                           provider: 'anthropic', label: 'Claude Opus 4.6',   providerLabel: 'Anthropic',  envKey: 'ANTHROPIC_API_KEY',            accentColor: '#f97316', icon: '🟠' },
  { modelId: 'claude-sonnet-4-6',                         provider: 'anthropic', label: 'Claude Sonnet 4.6', providerLabel: 'Anthropic',  envKey: 'ANTHROPIC_API_KEY',            accentColor: '#fbbf24', icon: '🟡' },
  { modelId: 'gpt-4.1',                                   provider: 'openai',    label: 'GPT-4.1',           providerLabel: 'OpenAI',     envKey: 'OPENAI_API_KEY',               accentColor: '#10a37f', icon: '🟢' },
  { modelId: 'grok-4.20-0309-non-reasoning',              provider: 'xai',       label: 'Grok 4.20',         providerLabel: 'xAI',        envKey: 'XAI_API_KEY',                  accentColor: '#ef4444', icon: '🔴' },
  { modelId: 'meta-llama/llama-4-scout-17b-16e-instruct', provider: 'groq',      label: 'Llama 4 Scout',     providerLabel: 'Groq',       envKey: 'GROQ_API_KEY',                 accentColor: '#f59e0b', icon: '⚡' },
  { modelId: 'mistral-large-latest',                      provider: 'mistral',   label: 'Mistral Large',     providerLabel: 'Mistral',    envKey: 'MISTRAL_API_KEY',              accentColor: '#06b6d4', icon: '🌊' },
  { modelId: 'pixtral-large-latest',                      provider: 'mistral',   label: 'Pixtral Large',     providerLabel: 'Mistral',    envKey: 'MISTRAL_API_KEY',              accentColor: '#0ea5e9', icon: '🧊' },
  { modelId: 'qwen/qwen2.5-vl-72b-instruct',              provider: 'openrouter',label: 'Qwen 2.5-VL 72B',   providerLabel: 'OpenRouter',  envKey: 'OPENROUTER_API_KEY',           accentColor: '#8b5cf6', icon: '🔮' },
  { modelId: 'moonshotai/Kimi-K2.5',                      provider: 'together',  label: 'Kimi K2.5',         providerLabel: 'Together AI', envKey: 'TOGETHER_API_KEY',             accentColor: '#f472b6', icon: '🌙' },
];

/** Backward-compatible alias */
export const BENCHMARK_AGENTS: AgentConfig[] = ARENA_AGENTS;

// ── Probe types ───────────────────────────────────────────────────────────────

export interface ProbeResult {
  modelId:      string;
  guess:        string;
  strategy:     string;
  latencyMs:    number;
  isKeyMissing: boolean;
  error?:       string;
}

export interface ArenaProbeResult {
  modelId:      string;
  action:       'guess' | 'wait';
  guess:        string | null;
  confidence:   number;
  reasoning:    string;
  latencyMs:    number;
  isKeyMissing: boolean;
  error?:       string;
  /** Phase 3: token counts for cost monitoring */
  inputTokens:  number;
  outputTokens: number;
}

// ── Internal provider response ────────────────────────────────────────────────

interface ProviderResponse {
  text:         string;
  inputTokens:  number;
  outputTokens: number;
}

// ── System prompt (legacy benchmark) ─────────────────────────────────────────

const SYSTEM_PROMPT = `You are a visual puzzle solver specializing in English idioms.
Analyze the image carefully. It depicts a LITERAL scene that represents a common English idiom or expression.
Your task is to identify which idiom the image illustrates.

Respond ONLY with valid JSON (no markdown, no code blocks):
{"guess": "the idiom phrase", "strategy": "brief explanation of your visual reasoning (max 20 words)"}`;

// ── Image download helper ─────────────────────────────────────────────────────

async function downloadImageBase64(imageUrl: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(imageUrl, { signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`Image download failed: HTTP ${res.status}`);
  const mimeType = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim();
  const base64   = Buffer.from(await res.arrayBuffer()).toString('base64');
  return { base64, mimeType };
}

// ── JSON extraction helpers ───────────────────────────────────────────────────

function parseGuessResponse(raw: string): { guess: string; strategy: string } {
  try { const j = JSON.parse(raw.trim()); if (j.guess) return { guess: String(j.guess), strategy: String(j.strategy || '') }; } catch { /* fall through */ }
  const fence = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fence) { try { const j = JSON.parse(fence[1]); if (j.guess) return { guess: String(j.guess), strategy: String(j.strategy || '') }; } catch { /* fall through */ } }
  const obj = raw.match(/\{[^{}]*"guess"[^{}]*\}/);
  if (obj) { try { const j = JSON.parse(obj[0]); if (j.guess) return { guess: String(j.guess), strategy: String(j.strategy || '') }; } catch { /* fall through */ } }
  const gm = raw.match(/"guess"\s*:\s*"([^"]+)"/);
  const sm = raw.match(/"strategy"\s*:\s*"([^"]+)"/);
  if (gm) return { guess: gm[1], strategy: sm?.[1] ?? '' };
  return { guess: raw.slice(0, 80).trim(), strategy: '' };
}

export function parseArenaResponse(raw: string): {
  action:     'guess' | 'wait';
  guess:      string | null;
  confidence: number;
  reasoning:  string;
} {
  let json: any = null;
  try { json = JSON.parse(raw.trim()); } catch { /* fall through */ }
  if (!json) { const f = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/); if (f) { try { json = JSON.parse(f[1]); } catch { /* */ } } }
  if (!json) { const f = raw.match(/\{[^{}]*"action"[^{}]*\}/);           if (f) { try { json = JSON.parse(f[0]); } catch { /* */ } } }
  if (!json) { const f = raw.match(/\{[\s\S]*?\}/);                        if (f) { try { json = JSON.parse(f[0]); } catch { /* */ } } }

  if (!json) {
    const guessMatch  = raw.match(/"guess"\s*:\s*"([^"]+)"/);
    const actionMatch = raw.match(/"action"\s*:\s*"(\w+)"/);
    const confMatch   = raw.match(/"confidence"\s*:\s*([\d.]+)/);
    const reasonMatch = raw.match(/"reasoning"\s*:\s*"([^"\\]+)"/);
    if (guessMatch) {
      return {
        action:     actionMatch?.[1] === 'wait' ? 'wait' : 'guess',
        guess:      guessMatch[1],
        confidence: confMatch ? parseFloat(confMatch[1]) : 0.5,
        reasoning:  reasonMatch?.[1] ?? 'Partial JSON — fields extracted via regex',
      };
    }
    const trimmed = raw.slice(0, 100).trim();
    if (trimmed) return { action: 'guess', guess: trimmed, confidence: 0.5, reasoning: 'Could not parse structured response' };
    return { action: 'guess', guess: null, confidence: 0, reasoning: '' };
  }

  return {
    action:     json.action === 'wait' ? 'wait' : 'guess',
    guess:      json.guess  ? String(json.guess) : null,
    confidence: typeof json.confidence === 'number' ? Math.min(1, Math.max(0, json.confidence)) : 0.5,
    reasoning:  String(json.reasoning || ''),
  };
}

// ── Provider implementations ──────────────────────────────────────────────────

async function probeOpenAI(modelId: string, imageUrl: string, systemPrompt: string): Promise<ProviderResponse> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const resp = await client.chat.completions.create({
    model:  modelId,
    messages: [{ role: 'user', content: [
      { type: 'text',      text:      systemPrompt },
      { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
    ]}],
    max_tokens:      512,
    response_format: { type: 'json_object' },
  });
  return {
    text:         resp.choices[0]?.message?.content ?? '{}',
    inputTokens:  resp.usage?.prompt_tokens     ?? 0,
    outputTokens: resp.usage?.completion_tokens ?? 0,
  };
}

async function probeAnthropic(modelId: string, imageUrl: string, systemPrompt: string): Promise<ProviderResponse> {
  const { base64, mimeType } = await downloadImageBase64(imageUrl);
  const validMime = (['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const).includes(mimeType as any)
    ? (mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp')
    : 'image/jpeg';
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model:      modelId,
    max_tokens: 512,
    messages:   [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: validMime, data: base64 } },
      { type: 'text',  text: systemPrompt },
    ]}],
  });
  return {
    text:         resp.content.find(b => b.type === 'text')?.text ?? '{}',
    inputTokens:  resp.usage.input_tokens  ?? 0,
    outputTokens: resp.usage.output_tokens ?? 0,
  };
}

async function probeGroq(modelId: string, imageUrl: string, systemPrompt: string): Promise<ProviderResponse> {
  const { base64, mimeType } = await downloadImageBase64(imageUrl);
  const dataUrl = `data:${mimeType};base64,${base64}`;
  const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const resp = await client.chat.completions.create({
    model:      modelId,
    max_tokens: 512,
    messages:   [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: dataUrl } } as any,
      { type: 'text',      text: systemPrompt }          as any,
    ]}],
  });
  return {
    text:         resp.choices[0]?.message?.content ?? '{}',
    inputTokens:  resp.usage?.prompt_tokens     ?? 0,
    outputTokens: resp.usage?.completion_tokens ?? 0,
  };
}

async function probeGoogle(modelId: string, imageUrl: string, systemPrompt: string): Promise<ProviderResponse> {
  const { base64, mimeType } = await downloadImageBase64(imageUrl);
  const isPro          = /pro/i.test(modelId);
  const maxOutputTokens = isPro ? 16384 : 1024;
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '');
  const model = genAI.getGenerativeModel({ model: modelId });
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [
      { text: systemPrompt },
      { inlineData: { mimeType, data: base64 } },
    ]}],
    generationConfig: { maxOutputTokens },
  });
  let rawText = result.response.text().trim();
  if (!rawText) {
    const parts = (result.response.candidates?.[0]?.content?.parts ?? []) as any[];
    rawText = parts.find((p: any) => p.text && !p.thought)?.text?.trim()
           ?? parts.find((p: any) => p.text)?.text?.trim()
           ?? '';
  }
  if (!rawText) throw new Error('Gemini returned empty response');
  const meta = result.response.usageMetadata;
  return {
    text:         rawText,
    inputTokens:  meta?.promptTokenCount     ?? 0,
    outputTokens: meta?.candidatesTokenCount ?? 0,
  };
}

async function probeXAI(modelId: string, imageUrl: string, systemPrompt: string): Promise<ProviderResponse> {
  const client = new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: 'https://api.x.ai/v1' });
  const resp = await client.chat.completions.create({
    model:  modelId,
    messages: [{ role: 'user', content: [
      { type: 'text',      text:      systemPrompt },
      { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
    ]}],
    max_tokens: 512,
  });
  return {
    text:         resp.choices[0]?.message?.content ?? '{}',
    inputTokens:  resp.usage?.prompt_tokens     ?? 0,
    outputTokens: resp.usage?.completion_tokens ?? 0,
  };
}

async function probeOpenRouter(modelId: string, imageUrl: string, systemPrompt: string): Promise<ProviderResponse> {
  const client = new OpenAI({
    apiKey:         process.env.OPENROUTER_API_KEY,
    baseURL:        'https://openrouter.ai/api/v1',
    defaultHeaders: { 'HTTP-Referer': 'https://ai-vision-game.vercel.app' },
  });
  const resp = await client.chat.completions.create({
    model:  modelId,
    messages: [{ role: 'user', content: [
      { type: 'text',      text:      systemPrompt },
      { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
    ]}],
    max_tokens: 512,
  });
  return {
    text:         resp.choices[0]?.message?.content ?? '{}',
    inputTokens:  resp.usage?.prompt_tokens     ?? 0,
    outputTokens: resp.usage?.completion_tokens ?? 0,
  };
}

async function probeTogether(modelId: string, imageUrl: string, systemPrompt: string): Promise<ProviderResponse> {
  // Together AI servers cannot reach fal.ai CDN URLs — must send base64.
  // Phase 3 Fix A: max_tokens bumped 2048→3072 to capture full reasoning for Kimi K2.5.
  const { base64, mimeType } = await downloadImageBase64(imageUrl);
  const dataUrl = `data:${mimeType};base64,${base64}`;
  const client  = new OpenAI({ apiKey: process.env.TOGETHER_API_KEY, baseURL: 'https://api.together.xyz/v1' });
  const resp = await client.chat.completions.create({
    model:  modelId,
    messages: [{ role: 'user', content: [
      { type: 'text',      text:      systemPrompt },
      { type: 'image_url', image_url: { url: dataUrl } },
    ]}],
    max_tokens: 3072, // Fix A: was 2048, bumped to capture full tournament-aware reasoning
  });
  return {
    text:         resp.choices[0]?.message?.content ?? '{}',
    inputTokens:  resp.usage?.prompt_tokens     ?? 0,
    outputTokens: resp.usage?.completion_tokens ?? 0,
  };
}

const REPLICATE_MODELS: Record<string, { owner: string; name: string; promptPrefix?: string; maxTokensKey?: string }> = {
  'qwen2.5-vl-72b-instruct': { owner: 'lucataco', name: 'qwen2.5-vl-72b-instruct' },
  'internvl3-78b':            { owner: 'cjwbw',    name: 'internvl3-78b' },
};

async function probeReplicate(modelId: string, imageUrl: string, systemPrompt: string): Promise<ProviderResponse> {
  const replicate  = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
  const modelPath  = REPLICATE_MODELS[modelId];
  if (!modelPath) throw new Error(`Unknown Replicate model: ${modelId}`);
  const modelInfo  = await replicate.models.get(modelPath.owner, modelPath.name);
  const version    = (modelInfo as any).latest_version?.id;
  if (!version) throw new Error(`Could not resolve ${modelPath.owner}/${modelPath.name} latest version`);
  const promptText   = (modelPath.promptPrefix ?? '') + systemPrompt;
  const maxTokensKey = modelPath.maxTokensKey ?? 'max_tokens';
  const output = await replicate.run(
    `${modelPath.owner}/${modelPath.name}:${version}` as `${string}/${string}:${string}`,
    { input: { image: imageUrl, prompt: promptText, [maxTokensKey]: 512 } },
  );
  return { text: Array.isArray(output) ? (output as string[]).join('') : String(output ?? ''), inputTokens: 0, outputTokens: 0 };
}

async function probeMistral(modelId: string, imageUrl: string, systemPrompt: string): Promise<ProviderResponse> {
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      model:      modelId,
      max_tokens: 512,
      messages:   [{ role: 'user', content: [
        { type: 'text',      text:      systemPrompt },
        { type: 'image_url', image_url: { url: imageUrl } },
      ]}],
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Mistral API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return {
    text:         data.choices?.[0]?.message?.content ?? '{}',
    inputTokens:  data.usage?.prompt_tokens     ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}

// ── Core dispatch ─────────────────────────────────────────────────────────────

const CALL_TIMEOUT_MS = 55_000;

/**
 * True if the error is an HTTP 429 rate-limit / quota-exceeded response.
 * All providers surface 429 as a thrown Error with the status code in the message.
 */
function is429(err: any): boolean {
  const msg: string = err?.message ?? '';
  return (
    msg.includes('429') ||
    msg.toLowerCase().includes('rate limit') ||
    msg.toLowerCase().includes('rate_limit') ||
    msg.toLowerCase().includes('quota') ||
    msg.toLowerCase().includes('too many requests')
  );
}

/**
 * How long to wait before the first 429 retry, per provider (ms).
 * Groq's on-demand TPM window is 1 minute → need a longer backoff.
 * Google/Mistral per-minute quotas recover faster.
 */
const RATE_LIMIT_BACKOFF_MS: Partial<Record<AgentConfig['provider'], number>> = {
  groq:    35_000,  // Groq on-demand TPM resets each minute
  google:  12_000,  // Google per-minute quota; shorter window
  mistral: 12_000,  // Mistral rate-limit window
};

/** Max 429 retries per call (second retry doubles the first delay). */
const MAX_429_RETRIES = 2;

/** Providers that get one retry on ANY error (infra-flaky providers). */
const FLAKY_PROVIDERS = new Set<AgentConfig['provider']>(['together']);

interface RawDispatchResult {
  raw:          string;
  latencyMs:    number;
  isKeyMissing: boolean;
  error?:       string;
  inputTokens:  number;
  outputTokens: number;
}

async function dispatchRaw(
  modelId:      string,
  imageUrl:     string,
  systemPrompt: string,
): Promise<RawDispatchResult> {
  const agent = ARENA_AGENTS.find(a => a.modelId === modelId);
  if (!agent) return { raw: '', latencyMs: 0, isKeyMissing: false, error: `Unknown modelId: ${modelId}`, inputTokens: 0, outputTokens: 0 };

  const isKeyMissing = agent.envKey !== null && !process.env[agent.envKey];
  if (isKeyMissing) return { raw: '', latencyMs: 0, isKeyMissing: true, inputTokens: 0, outputTokens: 0 };

  const t0 = Date.now();
  const withTimeout = <T>(p: Promise<T>): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${CALL_TIMEOUT_MS / 1000}s`)), CALL_TIMEOUT_MS),
      ),
    ]);

  const callProvider = (): Promise<ProviderResponse> => {
    switch (agent.provider) {
      case 'openai':     return withTimeout(probeOpenAI(modelId, imageUrl, systemPrompt));
      case 'anthropic':  return withTimeout(probeAnthropic(modelId, imageUrl, systemPrompt));
      case 'groq':       return withTimeout(probeGroq(modelId, imageUrl, systemPrompt));
      case 'google':     return withTimeout(probeGoogle(modelId, imageUrl, systemPrompt));
      case 'replicate':  return withTimeout(probeReplicate(modelId, imageUrl, systemPrompt));
      case 'mistral':    return withTimeout(probeMistral(modelId, imageUrl, systemPrompt));
      case 'xai':        return withTimeout(probeXAI(modelId, imageUrl, systemPrompt));
      case 'openrouter': return withTimeout(probeOpenRouter(modelId, imageUrl, systemPrompt));
      case 'together':   return withTimeout(probeTogether(modelId, imageUrl, systemPrompt));
      default:           throw new Error(`Unknown provider: ${agent.provider}`);
    }
  };

  try {
    let providerResp: ProviderResponse | undefined;
    let lastErr: any;

    // ── 429 retry loop (all providers) ──────────────────────────────────────
    const baseBackoff = RATE_LIMIT_BACKOFF_MS[agent.provider] ?? 10_000;
    for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
      try {
        providerResp = await callProvider();
        break; // success
      } catch (err: any) {
        lastErr = err;
        const shouldRetry429 = is429(err) && attempt < MAX_429_RETRIES;
        if (shouldRetry429) {
          const delay = baseBackoff * (attempt + 1); // 1× then 2× the base backoff
          console.warn(
            `[DISPATCHER] ${agent.label} 429 rate-limit (attempt ${attempt + 1}/${MAX_429_RETRIES + 1}) — ` +
            `retrying in ${delay / 1000}s. Error: ${err.message.slice(0, 120)}`,
          );
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        // ── Non-429 error: flaky-provider single retry ───────────────────
        if (!is429(err) && FLAKY_PROVIDERS.has(agent.provider) && attempt === 0) {
          console.log(`[DISPATCHER] ${agent.label} non-429 error — flaky provider retry in 3s: ${err.message.slice(0, 80)}`);
          await new Promise(r => setTimeout(r, 3_000));
          try {
            providerResp = await callProvider();
            break;
          } catch (retryErr: any) {
            lastErr = retryErr;
          }
        }
        break; // no more retries
      }
    }

    if (providerResp) {
      return {
        raw:          providerResp.text,
        latencyMs:    Date.now() - t0,
        isKeyMissing: false,
        inputTokens:  providerResp.inputTokens,
        outputTokens: providerResp.outputTokens,
      };
    }
    throw lastErr;
  } catch (err: any) {
    return { raw: '', latencyMs: Date.now() - t0, isKeyMissing: false, error: err?.message ?? 'Unknown error', inputTokens: 0, outputTokens: 0 };
  }
}

// ── Public API: legacy benchmark dispatch ─────────────────────────────────────

export async function dispatchProbe(modelId: string, imageUrl: string): Promise<ProbeResult> {
  const { raw, latencyMs, isKeyMissing, error } = await dispatchRaw(modelId, imageUrl, SYSTEM_PROMPT);
  if (isKeyMissing) return { modelId, guess: '', strategy: '', latencyMs, isKeyMissing: true };
  if (error)        return { modelId, guess: '', strategy: '', latencyMs, isKeyMissing: false, error };
  const parsed = parseGuessResponse(raw);
  return { modelId, ...parsed, latencyMs, isKeyMissing: false };
}

// ── Public API: arena dispatch ────────────────────────────────────────────────

export async function dispatchArenaProbe(
  modelId:      string,
  imageUrl:     string,
  systemPrompt: string,
  contextJson:  string,
): Promise<ArenaProbeResult> {
  const fullPrompt = `${systemPrompt}\n\n--- CURRENT STATE ---\n${contextJson}`;

  console.log(`[ARENA/DISPATCH] ${modelId} — sending probe (context: ${contextJson.length} chars)`);

  const { raw, latencyMs, isKeyMissing, error, inputTokens, outputTokens } =
    await dispatchRaw(modelId, imageUrl, fullPrompt);

  if (isKeyMissing) {
    console.log(`[ARENA/DISPATCH] ${modelId} — KEY MISSING`);
    return { modelId, action: 'wait', guess: null, confidence: 0, reasoning: '', latencyMs, isKeyMissing: true, inputTokens: 0, outputTokens: 0 };
  }
  if (error) {
    console.log(`[ARENA/DISPATCH] ${modelId} — ERROR: ${error}`);
    return { modelId, action: 'wait', guess: null, confidence: 0, reasoning: '', latencyMs, isKeyMissing: false, error, inputTokens, outputTokens };
  }

  console.log(`[ARENA/DISPATCH] ${modelId} — response (${latencyMs}ms): ${raw.slice(0, 200)}`);

  const parsed = parseArenaResponse(raw);

  // Phase 3 Fix A: log raw response when reasoning is empty or regex-fallback
  // so qualitative data is never silently lost (critical for Kimi K2.5 analysis)
  if (!parsed.reasoning || parsed.reasoning === 'Partial JSON — fields extracted via regex') {
    console.warn(
      `[ARENA/DISPATCH] ${modelId} — EMPTY/PARTIAL reasoning captured.\n` +
      `[ARENA/RAW] ${modelId}: ${raw.slice(0, 1200)}`,
    );
  }

  return { modelId, ...parsed, latencyMs, isKeyMissing: false, inputTokens, outputTokens };
}
