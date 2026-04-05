/**
 * Multi-Provider Vision Dispatcher — hotfix 2026-04-05
 *
 * Key changes from initial version:
 *   • Anthropic: updated to Claude 4.x model IDs (3.x fully deprecated);
 *     switched from URL image source to base64 (Anthropic servers time out
 *     fetching fal.ai URLs)
 *   • Groq: updated to meta-llama/llama-4-scout-17b-16e-instruct
 *     (llama-3.2-11b-vision-preview decommissioned); switched to base64
 *     data-URL (Groq servers also time out on fal.ai URLs)
 *   • Gemini: updated to gemini-2.5-pro + gemini-2.5-flash;
 *     both now use inlineData (base64) — fileData.fileUri only works for
 *     URLs that Google's CDN can reach directly (fal.ai is unreliable);
 *     Pro uses maxOutputTokens:16384 because thinking tokens count against
 *     the output budget (1024 was entirely consumed by thinking)
 *   • downloadImageBase64 timeout raised 15s → 25s for slow CDN responses
 *   • CALL_TIMEOUT_MS raised to 55s (base64 download + inference can exceed 30s)
 *   • Shared downloadImageBase64() helper avoids duplicate fetches
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import Replicate from 'replicate';

// ── Agent registry ────────────────────────────────────────────────────────────

export interface AgentConfig {
  modelId:       string;
  provider:      'openai' | 'anthropic' | 'groq' | 'google' | 'replicate' | 'mistral';
  label:         string;
  providerLabel: string;
  envKey:        string | null;
  accentColor:   string;
  icon:          string;
}

export const BENCHMARK_AGENTS: AgentConfig[] = [
  // ── OpenAI ──────────────────────────────────────────────────────────────
  {
    modelId:       'gpt-4o',
    provider:      'openai',
    label:         'GPT-4o',
    providerLabel: 'OpenAI',
    envKey:        'OPENAI_API_KEY',
    accentColor:   '#10a37f',
    icon:          '🟢',
  },
  {
    modelId:       'gpt-4o-mini',
    provider:      'openai',
    label:         'GPT-4o Mini',
    providerLabel: 'OpenAI',
    envKey:        'OPENAI_API_KEY',
    accentColor:   '#34d399',
    icon:          '🟩',
  },
  // ── Anthropic (Claude 4.x — confirmed available 2026-04-05) ─────────────
  {
    modelId:       'claude-sonnet-4-5-20250929',
    provider:      'anthropic',
    label:         'Claude 4.5 Sonnet',
    providerLabel: 'Anthropic',
    envKey:        'ANTHROPIC_API_KEY',
    accentColor:   '#f97316',
    icon:          '🟠',
  },
  {
    modelId:       'claude-haiku-4-5-20251001',
    provider:      'anthropic',
    label:         'Claude 4.5 Haiku',
    providerLabel: 'Anthropic',
    envKey:        'ANTHROPIC_API_KEY',
    accentColor:   '#fbbf24',
    icon:          '🟡',
  },
  // ── Google (Gemini 2.5 — confirmed available 2026-04-05) ─────────────────
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
    modelId:       'gemini-2.5-flash',
    provider:      'google',
    label:         'Gemini 2.5 Flash',
    providerLabel: 'Google',
    envKey:        'GOOGLE_GENERATIVE_AI_API_KEY',
    accentColor:   '#60a5fa',
    icon:          '💙',
  },
  // ── Groq (Llama 4 Scout — confirmed available + vision-capable 2026-04-05) ─
  {
    modelId:       'meta-llama/llama-4-scout-17b-16e-instruct',
    provider:      'groq',
    label:         'Llama 4 Scout',
    providerLabel: 'Groq',
    envKey:        'GROQ_API_KEY',
    accentColor:   '#f59e0b',
    icon:          '⚡',
  },
  // ── Placeholder / Experimental ───────────────────────────────────────────
  {
    modelId:       'replicate-llava',
    provider:      'replicate',
    label:         'LLaVA 13B',
    providerLabel: 'Replicate',
    envKey:        'REPLICATE_API_TOKEN',
    accentColor:   '#8b5cf6',
    icon:          '🔮',
  },
  {
    modelId:       'pixtral-12b',
    provider:      'mistral',
    label:         'Pixtral 12B',
    providerLabel: 'Mistral',
    envKey:        'MISTRAL_API_KEY',
    accentColor:   '#06b6d4',
    icon:          '🌊',
  },
];

// ── Probe types ───────────────────────────────────────────────────────────────

export interface ProbeResult {
  modelId:      string;
  guess:        string;
  strategy:     string;
  latencyMs:    number;
  isKeyMissing: boolean;
  error?:       string;
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a visual puzzle solver specializing in English idioms.
Analyze the image carefully. It depicts a LITERAL scene that represents a common English idiom or expression.
Your task is to identify which idiom the image illustrates.

Respond ONLY with valid JSON (no markdown, no code blocks):
{"guess": "the idiom phrase", "strategy": "brief explanation of your visual reasoning (max 20 words)"}`;

// ── Image download helper ─────────────────────────────────────────────────────
// Used by providers whose servers cannot directly fetch fal.ai CDN URLs.
// Downloads the image via Vercel's outbound connection (which CAN reach fal.ai)
// and converts to base64 for inline embedding.

async function downloadImageBase64(imageUrl: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(imageUrl, { signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`Image download failed: HTTP ${res.status}`);
  const mimeType = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim();
  const base64   = Buffer.from(await res.arrayBuffer()).toString('base64');
  return { base64, mimeType };
}

// ── JSON extraction helper ────────────────────────────────────────────────────

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

// ── Provider implementations ──────────────────────────────────────────────────

async function probeOpenAI(modelId: string, imageUrl: string): Promise<{ guess: string; strategy: string }> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const resp = await client.chat.completions.create({
    model:  modelId,
    messages: [{ role: 'user', content: [
      { type: 'text',      text:      SYSTEM_PROMPT },
      { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
    ]}],
    max_tokens:      256,
    response_format: { type: 'json_object' },
  });
  return parseGuessResponse(resp.choices[0]?.message?.content ?? '{}');
}

async function probeAnthropic(modelId: string, imageUrl: string): Promise<{ guess: string; strategy: string }> {
  // Anthropic servers time out downloading fal.ai CDN URLs.
  // Pre-download the image and pass as base64 instead.
  const { base64, mimeType } = await downloadImageBase64(imageUrl);
  const validMime = (['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const).includes(
    mimeType as any,
  ) ? (mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp') : 'image/jpeg';

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model:      modelId,
    max_tokens: 256,
    messages:   [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: validMime, data: base64 } },
      { type: 'text',  text: SYSTEM_PROMPT },
    ]}],
  });
  const text = resp.content.find(b => b.type === 'text')?.text ?? '{}';
  return parseGuessResponse(text);
}

async function probeGroq(modelId: string, imageUrl: string): Promise<{ guess: string; strategy: string }> {
  // Groq servers time out downloading fal.ai CDN URLs.
  // Pre-download and embed as a base64 data-URL instead.
  const { base64, mimeType } = await downloadImageBase64(imageUrl);
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const resp = await client.chat.completions.create({
    model:      modelId,
    max_tokens: 256,
    messages:   [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: dataUrl } } as any,
      { type: 'text',      text: SYSTEM_PROMPT } as any,
    ]}],
  });
  return parseGuessResponse(resp.choices[0]?.message?.content ?? '{}');
}

async function probeGoogle(modelId: string, imageUrl: string): Promise<{ guess: string; strategy: string }> {
  // Both Pro and Flash use inlineData (base64) to avoid fileData URL-fetch failures.
  // fileData.fileUri only works for URLs that Google's CDN can reach directly; fal.ai
  // and other third-party hosts are unreliable. Pre-downloading on Vercel is safer.
  //
  // Gemini 2.5 Pro uses extended thinking by default — maxOutputTokens INCLUDES thinking
  // tokens (per Google docs), so 1024 is entirely consumed by thinking, leaving 0 for
  // the actual response. Use 16384 to give the model room to think AND respond.
  // Flash is a non-thinking model so it just benefits from extra headroom.
  const { base64, mimeType } = await downloadImageBase64(imageUrl);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const imagePart: any = { inlineData: { mimeType, data: base64 } };

  const isPro = /pro/i.test(modelId);
  const maxOutputTokens = isPro ? 16384 : 1024;

  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '');
  const model = genAI.getGenerativeModel({ model: modelId });

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [
      { text: SYSTEM_PROMPT },
      imagePart,
    ]}],
    generationConfig: { maxOutputTokens },
  });

  // Try text() first; if empty, walk parts[] for a non-thinking text part
  let rawText = result.response.text().trim();
  if (!rawText) {
    const parts = (result.response.candidates?.[0]?.content?.parts ?? []) as any[];
    rawText = parts.find((p: any) => p.text && !p.thought)?.text?.trim()
           ?? parts.find((p: any) => p.text)?.text?.trim()
           ?? '';
  }
  if (!rawText) throw new Error('Gemini returned empty response');
  return parseGuessResponse(rawText);
}

async function probeReplicate(imageUrl: string): Promise<{ guess: string; strategy: string }> {
  // Use the Replicate SDK with yorickvp/llava-13b.
  // Resolve the latest version dynamically via models.get() — hardcoded hashes become
  // stale when Replicate deprecates older versions (causes 422 "invalid version").
  // imageUrl must be a public HTTP(S) URL; fal.ai benchmark images are public URLs.
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

  // Get the latest published version hash dynamically
  const modelInfo = await replicate.models.get('yorickvp', 'llava-13b');
  const version = (modelInfo as any).latest_version?.id;
  if (!version) throw new Error('Could not resolve yorickvp/llava-13b latest version');

  const output = await replicate.run(
    `yorickvp/llava-13b:${version}` as `${string}/${string}:${string}`,
    {
      input: {
        image:      imageUrl,
        prompt:     "Identify the English idiom depicted in this image. Respond ONLY with valid JSON (no markdown): {\"guess\": \"<idiom phrase>\", \"strategy\": \"<brief reason>\"}",
        max_tokens: 512,
      },
    },
  );

  const out = Array.isArray(output) ? (output as string[]).join('') : String(output ?? '');
  return parseGuessResponse(out);
}

async function probeMistral(imageUrl: string): Promise<{ guess: string; strategy: string }> {
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      model:      'pixtral-12b-2409',
      max_tokens: 256,
      messages:   [{ role: 'user', content: [
        { type: 'text',      text:      SYSTEM_PROMPT },
        { type: 'image_url', image_url: { url: imageUrl } },
      ]}],
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Mistral API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return parseGuessResponse(data.choices?.[0]?.message?.content ?? '{}');
}

// ── Main dispatcher ───────────────────────────────────────────────────────────
// 55s per-call budget: up to 15s image download + up to 40s for inference
// (probe route maxDuration = 60s)

const CALL_TIMEOUT_MS = 55_000;

export async function dispatchProbe(modelId: string, imageUrl: string): Promise<ProbeResult> {
  const agent = BENCHMARK_AGENTS.find(a => a.modelId === modelId);
  if (!agent) {
    return { modelId, guess: '', strategy: '', latencyMs: 0, isKeyMissing: false, error: `Unknown modelId: ${modelId}` };
  }

  const isKeyMissing = agent.envKey !== null && !process.env[agent.envKey];
  if (isKeyMissing) {
    return { modelId, guess: '', strategy: '', latencyMs: 0, isKeyMissing: true };
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
    let result: { guess: string; strategy: string };
    switch (agent.provider) {
      case 'openai':    result = await withTimeout(probeOpenAI(modelId, imageUrl));    break;
      case 'anthropic': result = await withTimeout(probeAnthropic(modelId, imageUrl)); break;
      case 'groq':      result = await withTimeout(probeGroq(modelId, imageUrl));      break;
      case 'google':    result = await withTimeout(probeGoogle(modelId, imageUrl));    break;
      case 'replicate': result = await withTimeout(probeReplicate(imageUrl));          break;
      case 'mistral':
      default:
        result = await withTimeout(probeMistral(imageUrl));
        break;
    }
    return { modelId, ...result, latencyMs: Date.now() - t0, isKeyMissing: false };
  } catch (err: any) {
    return { modelId, guess: '', strategy: '', latencyMs: Date.now() - t0, isKeyMissing: false, error: err?.message ?? 'Unknown error' };
  }
}
