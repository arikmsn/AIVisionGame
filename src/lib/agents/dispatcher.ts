/**
 * Multi-Provider Vision Dispatcher — Arena v2.0
 *
 * 12-model roster per Section 5.4 of AI Vision Arena Spec v2.
 *
 * Providers: OpenAI, Anthropic, Google, Groq, Mistral, xAI, OpenRouter, DeepSeek
 *
 * Key design decisions:
 *   • Base64 image download for providers whose servers can't reach fal.ai
 *     (Anthropic, Groq, Google — all time out on fal.ai CDN)
 *   • Per-call 55s timeout budget: up to 25s image download + 30s inference
 *   • Shared downloadImageBase64() helper avoids duplicate fetches
 *   • Each provider function accepts modelId for multi-model support
 *   • ARENA_AGENTS is the 12-model roster; BENCHMARK_AGENTS is kept as alias
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import Replicate from 'replicate';

// ── Agent registry ────────────────────────────────────────────────────────────

export interface AgentConfig {
  modelId:       string;
  provider:      'openai' | 'anthropic' | 'groq' | 'google' | 'replicate' | 'mistral' | 'deepseek' | 'xai' | 'openrouter';
  label:         string;
  providerLabel: string;
  envKey:        string | null;
  accentColor:   string;
  icon:          string;
}

/**
 * The 12-model Arena roster — Section 5.4 of AI Vision Arena Spec v2.
 * Model IDs are pinned to specific snapshots per spec recommendation.
 */
export const ARENA_AGENTS: AgentConfig[] = [
  // ── Google ──────────────────────────────────────────────────────────────────
  {
    modelId:       'gemini-2.5-pro',
    provider:      'google',
    label:         'Gemini 2.5 Pro',
    providerLabel: 'Google',
    envKey:        'GOOGLE_GENERATIVE_AI_API_KEY',
    accentColor:   '#4285f4',
    icon:          '🔵',
  },
  {
    modelId:       'gemma-3-27b-it',
    provider:      'google',
    label:         'Gemma 3 27B',
    providerLabel: 'Google',
    envKey:        'GOOGLE_GENERATIVE_AI_API_KEY',
    accentColor:   '#34a853',
    icon:          '💚',
  },
  // ── Anthropic ───────────────────────────────────────────────────────────────
  {
    modelId:       'claude-opus-4-6',
    provider:      'anthropic',
    label:         'Claude Opus 4.6',
    providerLabel: 'Anthropic',
    envKey:        'ANTHROPIC_API_KEY',
    accentColor:   '#f97316',
    icon:          '🟠',
  },
  {
    modelId:       'claude-sonnet-4-6',
    provider:      'anthropic',
    label:         'Claude Sonnet 4.6',
    providerLabel: 'Anthropic',
    envKey:        'ANTHROPIC_API_KEY',
    accentColor:   '#fbbf24',
    icon:          '🟡',
  },
  // ── OpenAI ──────────────────────────────────────────────────────────────────
  {
    modelId:       'gpt-4.1',
    provider:      'openai',
    label:         'GPT-4.1',
    providerLabel: 'OpenAI',
    envKey:        'OPENAI_API_KEY',
    accentColor:   '#10a37f',
    icon:          '🟢',
  },
  // ── xAI ─────────────────────────────────────────────────────────────────────
  {
    modelId:       'grok-2-vision-1212',
    provider:      'xai',
    label:         'Grok-2 Vision',
    providerLabel: 'xAI',
    envKey:        'XAI_API_KEY',
    accentColor:   '#ef4444',
    icon:          '🔴',
  },
  // ── Groq (Meta Llama 4) ─────────────────────────────────────────────────────
  {
    modelId:       'meta-llama/llama-4-scout-17b-16e-instruct',
    provider:      'groq',
    label:         'Llama 4 Scout',
    providerLabel: 'Groq',
    envKey:        'GROQ_API_KEY',
    accentColor:   '#f59e0b',
    icon:          '⚡',
  },
  // ── Mistral ─────────────────────────────────────────────────────────────────
  {
    modelId:       'mistral-large-latest',
    provider:      'mistral',
    label:         'Mistral Large',
    providerLabel: 'Mistral',
    envKey:        'MISTRAL_API_KEY',
    accentColor:   '#06b6d4',
    icon:          '🌊',
  },
  {
    modelId:       'pixtral-large-latest',
    provider:      'mistral',
    label:         'Pixtral Large',
    providerLabel: 'Mistral',
    envKey:        'MISTRAL_API_KEY',
    accentColor:   '#0ea5e9',
    icon:          '🧊',
  },
  // ── OpenRouter ──────────────────────────────────────────────────────────────
  {
    modelId:       'qwen/qwen2.5-vl-72b-instruct',
    provider:      'openrouter',
    label:         'Qwen 2.5-VL 72B',
    providerLabel: 'OpenRouter',
    envKey:        'OPENROUTER_API_KEY',
    accentColor:   '#8b5cf6',
    icon:          '🔮',
  },
  {
    modelId:       'opengvlab/internvl3-78b',
    provider:      'openrouter',
    label:         'InternVL3-78B',
    providerLabel: 'OpenRouter',
    envKey:        'OPENROUTER_API_KEY',
    accentColor:   '#a855f7',
    icon:          '🟣',
  },
  // ── DeepSeek ────────────────────────────────────────────────────────────────
  {
    modelId:       'deepseek-vl2',
    provider:      'deepseek',
    label:         'DeepSeek-VL2',
    providerLabel: 'DeepSeek',
    envKey:        'DeepSeek_API_KEY',
    accentColor:   '#3b82f6',
    icon:          '💎',
  },
];

/** Backward-compatible alias — stats API and old benchmark page reference this */
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

/** Arena-specific response format (action/guess/confidence/reasoning) */
export interface ArenaProbeResult {
  modelId:      string;
  action:       'guess' | 'wait';
  guess:        string | null;
  confidence:   number;
  reasoning:    string;
  latencyMs:    number;
  isKeyMissing: boolean;
  error?:       string;
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

/** Parse legacy benchmark response: { guess, strategy } */
function parseGuessResponse(raw: string): { guess: string; strategy: string } {
  // Direct JSON
  try {
    const j = JSON.parse(raw.trim());
    if (j.guess) return { guess: String(j.guess), strategy: String(j.strategy || '') };
  } catch { /* fall through */ }

  // Markdown fence
  const fence = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fence) {
    try {
      const j = JSON.parse(fence[1]);
      if (j.guess) return { guess: String(j.guess), strategy: String(j.strategy || '') };
    } catch { /* fall through */ }
  }

  // First JSON object containing "guess"
  const objMatch = raw.match(/\{[^{}]*"guess"[^{}]*\}/);
  if (objMatch) {
    try {
      const j = JSON.parse(objMatch[0]);
      if (j.guess) return { guess: String(j.guess), strategy: String(j.strategy || '') };
    } catch { /* fall through */ }
  }

  // Regex field extraction
  const gm = raw.match(/"guess"\s*:\s*"([^"]+)"/);
  const sm = raw.match(/"strategy"\s*:\s*"([^"]+)"/);
  if (gm) return { guess: gm[1], strategy: sm?.[1] ?? '' };

  return { guess: raw.slice(0, 80).trim(), strategy: '' };
}

/** Parse arena response: { action, guess, confidence, reasoning } */
export function parseArenaResponse(raw: string): {
  action:     'guess' | 'wait';
  guess:      string | null;
  confidence: number;
  reasoning:  string;
} {
  const defaultResult = { action: 'guess' as const, guess: null, confidence: 0, reasoning: '' };

  // Try to find JSON in the response
  let json: any = null;

  // Direct JSON
  try {
    json = JSON.parse(raw.trim());
  } catch { /* fall through */ }

  // Markdown fence
  if (!json) {
    const fence = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (fence) {
      try { json = JSON.parse(fence[1]); } catch { /* fall through */ }
    }
  }

  // First JSON object containing "action"
  if (!json) {
    const objMatch = raw.match(/\{[^{}]*"action"[^{}]*\}/);
    if (objMatch) {
      try { json = JSON.parse(objMatch[0]); } catch { /* fall through */ }
    }
  }

  // Broader: any JSON object
  if (!json) {
    const anyObj = raw.match(/\{[\s\S]*?\}/);
    if (anyObj) {
      try { json = JSON.parse(anyObj[0]); } catch { /* fall through */ }
    }
  }

  if (!json) {
    // Last resort: treat entire response as a guess
    const trimmed = raw.slice(0, 100).trim();
    if (trimmed) {
      return { action: 'guess', guess: trimmed, confidence: 0.5, reasoning: 'Could not parse structured response' };
    }
    return defaultResult;
  }

  const action = json.action === 'wait' ? 'wait' : 'guess';
  const guess  = json.guess ? String(json.guess) : null;
  const confidence = typeof json.confidence === 'number'
    ? Math.min(1, Math.max(0, json.confidence))
    : 0.5;
  const reasoning = String(json.reasoning || '');

  return { action, guess, confidence, reasoning };
}

// ── Provider implementations ──────────────────────────────────────────────────

async function probeOpenAI(modelId: string, imageUrl: string, systemPrompt: string): Promise<string> {
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
  return resp.choices[0]?.message?.content ?? '{}';
}

async function probeAnthropic(modelId: string, imageUrl: string, systemPrompt: string): Promise<string> {
  const { base64, mimeType } = await downloadImageBase64(imageUrl);
  const validMime = (['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const).includes(
    mimeType as any,
  ) ? (mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp') : 'image/jpeg';

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model:      modelId,
    max_tokens: 512,
    messages:   [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: validMime, data: base64 } },
      { type: 'text',  text: systemPrompt },
    ]}],
  });
  return resp.content.find(b => b.type === 'text')?.text ?? '{}';
}

async function probeGroq(modelId: string, imageUrl: string, systemPrompt: string): Promise<string> {
  const { base64, mimeType } = await downloadImageBase64(imageUrl);
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const resp = await client.chat.completions.create({
    model:      modelId,
    max_tokens: 512,
    messages:   [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: dataUrl } } as any,
      { type: 'text',      text: systemPrompt } as any,
    ]}],
  });
  return resp.choices[0]?.message?.content ?? '{}';
}

async function probeGoogle(modelId: string, imageUrl: string, systemPrompt: string): Promise<string> {
  const { base64, mimeType } = await downloadImageBase64(imageUrl);
  const imagePart: any = { inlineData: { mimeType, data: base64 } };

  // Gemini Pro uses thinking → needs larger output budget.
  // Gemma + Flash are non-thinking → 1024 is enough.
  const isPro = /pro/i.test(modelId);
  const maxOutputTokens = isPro ? 16384 : 1024;

  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '');
  const model = genAI.getGenerativeModel({ model: modelId });

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [
      { text: systemPrompt },
      imagePart,
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
  return rawText;
}

async function probeXAI(modelId: string, imageUrl: string, systemPrompt: string): Promise<string> {
  // xAI API is OpenAI-compatible — https://api.x.ai/v1
  const client = new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: 'https://api.x.ai/v1' });
  const resp = await client.chat.completions.create({
    model:  modelId,
    messages: [{ role: 'user', content: [
      { type: 'text',      text:      systemPrompt },
      { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
    ]}],
    max_tokens: 512,
  });
  return resp.choices[0]?.message?.content ?? '{}';
}

async function probeOpenRouter(modelId: string, imageUrl: string, systemPrompt: string): Promise<string> {
  // OpenRouter is OpenAI-compatible — https://openrouter.ai/api/v1
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
  return resp.choices[0]?.message?.content ?? '{}';
}

/** Replicate model path mapping — owner/name for models.get() */
const REPLICATE_MODELS: Record<string, { owner: string; name: string }> = {
  'qwen2.5-vl-72b-instruct': { owner: 'lucataco',  name: 'qwen2.5-vl-72b-instruct' },
  'internvl3-78b':           { owner: 'cjwbw',      name: 'internvl3-78b' },
};

async function probeReplicate(modelId: string, imageUrl: string, systemPrompt: string): Promise<string> {
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

  const modelPath = REPLICATE_MODELS[modelId];
  if (!modelPath) throw new Error(`Unknown Replicate model: ${modelId}`);

  const modelInfo = await replicate.models.get(modelPath.owner, modelPath.name);
  const version = (modelInfo as any).latest_version?.id;
  if (!version) throw new Error(`Could not resolve ${modelPath.owner}/${modelPath.name} latest version`);

  const output = await replicate.run(
    `${modelPath.owner}/${modelPath.name}:${version}` as `${string}/${string}:${string}`,
    {
      input: {
        image:      imageUrl,
        prompt:     systemPrompt,
        max_tokens: 512,
      },
    },
  );

  return Array.isArray(output) ? (output as string[]).join('') : String(output ?? '');
}

async function probeMistral(modelId: string, imageUrl: string, systemPrompt: string): Promise<string> {
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
  return data.choices?.[0]?.message?.content ?? '{}';
}

async function probeDeepSeek(modelId: string, imageUrl: string, systemPrompt: string): Promise<string> {
  // DeepSeek API is OpenAI-compatible: https://api.deepseek.com
  // DeepSeek does NOT support image_url type — must use base64 data URL
  const { base64, mimeType } = await downloadImageBase64(imageUrl);
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${process.env.DeepSeek_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model:      modelId,
      max_tokens: 512,
      messages:   [{ role: 'user', content: [
        { type: 'text',      text:      systemPrompt },
        { type: 'image_url', image_url: { url: dataUrl } },
      ]}],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`DeepSeek API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '{}';
}

// ── Core dispatch (raw text response) ─────────────────────────────────────────

const CALL_TIMEOUT_MS = 55_000;

async function dispatchRaw(
  modelId:      string,
  imageUrl:     string,
  systemPrompt: string,
): Promise<{ raw: string; latencyMs: number; isKeyMissing: boolean; error?: string }> {
  const agent = ARENA_AGENTS.find(a => a.modelId === modelId);
  if (!agent) {
    return { raw: '', latencyMs: 0, isKeyMissing: false, error: `Unknown modelId: ${modelId}` };
  }

  const isKeyMissing = agent.envKey !== null && !process.env[agent.envKey];
  if (isKeyMissing) {
    return { raw: '', latencyMs: 0, isKeyMissing: true };
  }

  const t0 = Date.now();
  const withTimeout = <T>(p: Promise<T>): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${CALL_TIMEOUT_MS / 1000}s`)), CALL_TIMEOUT_MS),
      ),
    ]);

  try {
    let raw: string;
    switch (agent.provider) {
      case 'openai':      raw = await withTimeout(probeOpenAI(modelId, imageUrl, systemPrompt));      break;
      case 'anthropic':   raw = await withTimeout(probeAnthropic(modelId, imageUrl, systemPrompt));   break;
      case 'groq':        raw = await withTimeout(probeGroq(modelId, imageUrl, systemPrompt));        break;
      case 'google':      raw = await withTimeout(probeGoogle(modelId, imageUrl, systemPrompt));      break;
      case 'replicate':   raw = await withTimeout(probeReplicate(modelId, imageUrl, systemPrompt));   break;
      case 'mistral':     raw = await withTimeout(probeMistral(modelId, imageUrl, systemPrompt));     break;
      case 'deepseek':    raw = await withTimeout(probeDeepSeek(modelId, imageUrl, systemPrompt));    break;
      case 'xai':         raw = await withTimeout(probeXAI(modelId, imageUrl, systemPrompt));         break;
      case 'openrouter':  raw = await withTimeout(probeOpenRouter(modelId, imageUrl, systemPrompt));  break;
      default:            throw new Error(`Unknown provider: ${agent.provider}`);
    }
    return { raw, latencyMs: Date.now() - t0, isKeyMissing: false };
  } catch (err: any) {
    return { raw: '', latencyMs: Date.now() - t0, isKeyMissing: false, error: err?.message ?? 'Unknown error' };
  }
}

// ── Public API: legacy benchmark dispatch ─────────────────────────────────────

/**
 * Dispatch a probe using the legacy benchmark prompt.
 * Returns { guess, strategy } format for backward compatibility.
 */
export async function dispatchProbe(modelId: string, imageUrl: string): Promise<ProbeResult> {
  const { raw, latencyMs, isKeyMissing, error } = await dispatchRaw(modelId, imageUrl, SYSTEM_PROMPT);

  if (isKeyMissing) return { modelId, guess: '', strategy: '', latencyMs, isKeyMissing: true };
  if (error)        return { modelId, guess: '', strategy: '', latencyMs, isKeyMissing: false, error };

  const parsed = parseGuessResponse(raw);
  return { modelId, ...parsed, latencyMs, isKeyMissing: false };
}

// ── Public API: arena dispatch ────────────────────────────────────────────────

/**
 * Dispatch a probe using the arena prompt with context.
 * The system prompt + context JSON are combined into a single user message.
 */
export async function dispatchArenaProbe(
  modelId:      string,
  imageUrl:     string,
  systemPrompt: string,
  contextJson:  string,
): Promise<ArenaProbeResult> {
  // Combine system prompt + context into the user message
  const fullPrompt = `${systemPrompt}\n\n--- CURRENT STATE ---\n${contextJson}`;

  console.log(`[ARENA/DISPATCH] ${modelId} — sending probe (context: ${contextJson.length} chars)`);

  const { raw, latencyMs, isKeyMissing, error } = await dispatchRaw(modelId, imageUrl, fullPrompt);

  if (isKeyMissing) {
    console.log(`[ARENA/DISPATCH] ${modelId} — KEY MISSING`);
    return { modelId, action: 'wait', guess: null, confidence: 0, reasoning: '', latencyMs, isKeyMissing: true };
  }
  if (error) {
    console.log(`[ARENA/DISPATCH] ${modelId} — ERROR: ${error}`);
    return { modelId, action: 'wait', guess: null, confidence: 0, reasoning: '', latencyMs, isKeyMissing: false, error };
  }

  console.log(`[ARENA/DISPATCH] ${modelId} — response (${latencyMs}ms): ${raw.slice(0, 200)}`);
  const parsed = parseArenaResponse(raw);
  return { modelId, ...parsed, latencyMs, isKeyMissing: false };
}
