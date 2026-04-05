/**
 * Multi-Provider Vision Dispatcher
 *
 * Sends an image to a vision-capable AI model and asks it to identify
 * the English idiom depicted. Each provider uses its own SDK.
 *
 * Supported providers:
 *   openai    – GPT-4o, GPT-4o Mini           (openai SDK)
 *   anthropic – Claude 3.5 Sonnet, Haiku      (@anthropic-ai/sdk)
 *   groq      – Llama 3.2 Vision              (groq-sdk)
 *   google    – Gemini 1.5 Pro/Flash          (@google/generative-ai)
 *   replicate – LLaVA 13B                     (REST API)
 *   mistral   – Pixtral 12B                   (REST API — OpenAI-compat)
 *   mock      – Always returns a random guess  (no key needed, for UI testing)
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';

// ── Agent registry ────────────────────────────────────────────────────────────

export interface AgentConfig {
  modelId:       string;
  provider:      'openai' | 'anthropic' | 'groq' | 'google' | 'replicate' | 'mistral' | 'mock';
  label:         string;
  providerLabel: string;
  envKey:        string | null;
  accentColor:   string;
  icon:          string;
}

export const BENCHMARK_AGENTS: AgentConfig[] = [
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
  {
    modelId:       'claude-3-5-sonnet-20241022',
    provider:      'anthropic',
    label:         'Claude 3.5 Sonnet',
    providerLabel: 'Anthropic',
    envKey:        'ANTHROPIC_API_KEY',
    accentColor:   '#f97316',
    icon:          '🟠',
  },
  {
    modelId:       'claude-3-haiku-20240307',
    provider:      'anthropic',
    label:         'Claude 3 Haiku',
    providerLabel: 'Anthropic',
    envKey:        'ANTHROPIC_API_KEY',
    accentColor:   '#fbbf24',
    icon:          '🟡',
  },
  {
    modelId:       'gemini-1.5-pro-latest',
    provider:      'google',
    label:         'Gemini 1.5 Pro',
    providerLabel: 'Google',
    envKey:        'GOOGLE_GENERATIVE_AI_API_KEY',
    accentColor:   '#4285f4',
    icon:          '🔵',
  },
  {
    modelId:       'gemini-1.5-flash-latest',
    provider:      'google',
    label:         'Gemini 1.5 Flash',
    providerLabel: 'Google',
    envKey:        'GOOGLE_GENERATIVE_AI_API_KEY',
    accentColor:   '#60a5fa',
    icon:          '💙',
  },
  {
    modelId:       'llama-3.2-11b-vision-preview',
    provider:      'groq',
    label:         'Llama 3.2 Vision',
    providerLabel: 'Groq',
    envKey:        'GROQ_API_KEY',
    accentColor:   '#f59e0b',
    icon:          '⚡',
  },
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
  {
    modelId:       'mock-agent',
    provider:      'mock',
    label:         'Mock Agent',
    providerLabel: 'Test',
    envKey:        null,
    accentColor:   '#6b7280',
    icon:          '🤖',
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

// ── JSON extraction helper ────────────────────────────────────────────────────

function parseGuessResponse(raw: string): { guess: string; strategy: string } {
  // Try direct JSON parse
  try {
    const j = JSON.parse(raw.trim());
    if (j.guess) return { guess: String(j.guess), strategy: String(j.strategy || '') };
  } catch { /* fall through */ }

  // Extract JSON block from markdown fences
  const fenceMatch = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenceMatch) {
    try {
      const j = JSON.parse(fenceMatch[1]);
      if (j.guess) return { guess: String(j.guess), strategy: String(j.strategy || '') };
    } catch { /* fall through */ }
  }

  // Find first JSON object in text
  const jsonMatch = raw.match(/\{[^{}]*"guess"[^{}]*\}/);
  if (jsonMatch) {
    try {
      const j = JSON.parse(jsonMatch[0]);
      if (j.guess) return { guess: String(j.guess), strategy: String(j.strategy || '') };
    } catch { /* fall through */ }
  }

  // Regex fallback for guess field
  const guessMatch = raw.match(/"guess"\s*:\s*"([^"]+)"/);
  const stratMatch = raw.match(/"strategy"\s*:\s*"([^"]+)"/);
  if (guessMatch) {
    return {
      guess:    guessMatch[1],
      strategy: stratMatch?.[1] ?? '',
    };
  }

  // Last resort: treat the whole response as the guess
  return { guess: raw.slice(0, 80).trim(), strategy: '' };
}

// ── Per-provider dispatch functions ──────────────────────────────────────────

async function probeOpenAI(modelId: string, imageUrl: string): Promise<{ guess: string; strategy: string }> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.chat.completions.create({
    model:  modelId,
    messages: [{
      role:    'user',
      content: [
        { type: 'text',      text:      SYSTEM_PROMPT },
        { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
      ],
    }],
    max_tokens:      256,
    response_format: { type: 'json_object' },
  });
  return parseGuessResponse(response.choices[0]?.message?.content ?? '{}');
}

async function probeAnthropic(modelId: string, imageUrl: string): Promise<{ guess: string; strategy: string }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model:      modelId,
    max_tokens: 256,
    messages:   [{
      role:    'user',
      content: [
        { type: 'image', source: { type: 'url', url: imageUrl } },
        { type: 'text',  text: SYSTEM_PROMPT },
      ],
    }],
  });
  const text = response.content.find(b => b.type === 'text')?.text ?? '{}';
  return parseGuessResponse(text);
}

async function probeGroq(modelId: string, imageUrl: string): Promise<{ guess: string; strategy: string }> {
  const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const response = await client.chat.completions.create({
    model:      modelId,
    max_tokens: 256,
    messages:   [{
      role:    'user',
      content: [
        { type: 'image_url', image_url: { url: imageUrl } },
        { type: 'text',      text: SYSTEM_PROMPT },
      ] as any,
    }],
  });
  return parseGuessResponse(response.choices[0]?.message?.content ?? '{}');
}

async function probeGoogle(modelId: string, imageUrl: string): Promise<{ guess: string; strategy: string }> {
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '');
  const model = genAI.getGenerativeModel({ model: modelId });

  // Gemini requires inline base64 for external image URLs
  const imageRes  = await fetch(imageUrl, { signal: AbortSignal.timeout(10_000) });
  const mimeType  = (imageRes.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim();
  const imageData = Buffer.from(await imageRes.arrayBuffer()).toString('base64');

  const result = await model.generateContent({
    contents: [{
      role:  'user',
      parts: [
        { text: SYSTEM_PROMPT },
        { inlineData: { mimeType, data: imageData } },
      ],
    }],
    generationConfig: { maxOutputTokens: 256 },
  });
  return parseGuessResponse(result.response.text());
}

async function probeReplicate(imageUrl: string): Promise<{ guess: string; strategy: string }> {
  const token = process.env.REPLICATE_API_TOKEN;
  // LLaVA 13B — stable model version hash
  const VERSION = 'a305f1a671c330654f9b058dbe22e08ba2fb7a56ef5cbf394fedb8e9c28f7427';

  // Submit prediction
  const submitRes = await fetch('https://api.replicate.com/v1/predictions', {
    method:  'POST',
    headers: {
      'Authorization': `Token ${token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      version: VERSION,
      input:   { image: imageUrl, prompt: SYSTEM_PROMPT, max_new_tokens: 256 },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!submitRes.ok) throw new Error(`Replicate submit ${submitRes.status}`);
  const { id: predId, urls } = await submitRes.json();

  // Poll for result (max 25s)
  const pollUrl  = urls?.get ?? `https://api.replicate.com/v1/predictions/${predId}`;
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    const pollRes = await fetch(pollUrl, {
      headers: { 'Authorization': `Token ${token}` },
      signal:  AbortSignal.timeout(5_000),
    });
    const pred = await pollRes.json();
    if (pred.status === 'succeeded') {
      const output = Array.isArray(pred.output) ? pred.output.join('') : String(pred.output ?? '');
      return parseGuessResponse(output);
    }
    if (pred.status === 'failed') throw new Error('Replicate prediction failed');
  }
  throw new Error('Replicate prediction timed out');
}

async function probeMistral(imageUrl: string): Promise<{ guess: string; strategy: string }> {
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model:      'pixtral-12b-2409',
      max_tokens: 256,
      messages:   [{
        role:    'user',
        content: [
          { type: 'text',      text:      SYSTEM_PROMPT },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      }],
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Mistral API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return parseGuessResponse(data.choices?.[0]?.message?.content ?? '{}');
}

const MOCK_GUESSES = [
  'Piece of cake', 'Barking up the wrong tree', 'Spill the beans',
  'Break a leg', 'Hit the nail on the head', 'Elephant in the room',
  'Raining cats and dogs', 'Bite the bullet', 'On thin ice', 'Wild goose chase',
];

function probeMock(): { guess: string; strategy: string } {
  const g = MOCK_GUESSES[Math.floor(Math.random() * MOCK_GUESSES.length)];
  return { guess: g, strategy: 'Mock agent — no real analysis performed' };
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

const CALL_TIMEOUT_MS = 30_000;

export async function dispatchProbe(modelId: string, imageUrl: string): Promise<ProbeResult> {
  const agent = BENCHMARK_AGENTS.find(a => a.modelId === modelId);
  if (!agent) {
    return { modelId, guess: '', strategy: '', latencyMs: 0, isKeyMissing: false, error: `Unknown modelId: ${modelId}` };
  }

  // Check key
  const isKeyMissing = agent.envKey !== null && !process.env[agent.envKey];
  if (isKeyMissing && agent.provider !== 'mock') {
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
      case 'mistral':   result = await withTimeout(probeMistral(imageUrl));            break;
      case 'mock':
      default:
        await new Promise(r => setTimeout(r, 600 + Math.random() * 1400)); // fake latency
        result = probeMock();
        break;
    }

    return { modelId, ...result, latencyMs: Date.now() - t0, isKeyMissing: false };
  } catch (err: any) {
    return {
      modelId,
      guess:        '',
      strategy:     '',
      latencyMs:    Date.now() - t0,
      isKeyMissing: false,
      error:        err?.message ?? 'Unknown error',
    };
  }
}
