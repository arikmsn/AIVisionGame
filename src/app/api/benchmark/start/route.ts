/**
 * POST /api/benchmark/start
 *
 * Starts a new benchmark round:
 *   1. Picks a random English idiom (optionally filtered by difficulty)
 *   2. Generates an image via fal.ai fast-lightning-sdxl
 *   3. Returns the image URL and idiom metadata
 *
 * The phrase is returned so the UI can later check correctness.
 * The phrase is NOT given to agents — they receive only the image URL.
 *
 * Body (all optional):
 *   { difficulty?: "easy" | "medium" | "hard" }
 */

import { NextRequest, NextResponse } from 'next/server';
import { pickRandomIdiom, pickIdiomByDifficulty, type IdiomDifficulty } from '@/lib/benchmark/idioms';

export const maxDuration = 60;

const FAL_KEY          = process.env.FAL_KEY;
const TIMEOUT_MS       = 50_000;
const POLL_INTERVAL_MS = 1_200;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_RETRIES      = 3;

async function fetchRetry(url: string, opts: RequestInit, attempt = 1): Promise<Response> {
  try {
    return await fetch(url, { ...opts, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err: any) {
    const isNet = err?.message?.includes('EAI_AGAIN') || err?.message?.includes('fetch failed');
    if (isNet && attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 1000 * attempt));
      return fetchRetry(url, opts, attempt + 1);
    }
    throw err;
  }
}

async function generateImage(visualPrompt: string): Promise<string> {
  if (!FAL_KEY) throw new Error('FAL_KEY not configured');

  // Submit to fal.ai queue
  const submitRes = await fetchRetry('https://queue.fal.run/fal-ai/fast-lightning-sdxl', {
    method:  'POST',
    headers: { 'Authorization': `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ prompt: visualPrompt, image_size: { width: 512, height: 512 } }),
  });
  if (!submitRes.ok) throw new Error(`fal.ai submit ${submitRes.status}`);

  const { request_id, id } = await submitRes.json();
  const requestId = request_id || id;
  if (!requestId) throw new Error('fal.ai returned no request_id');

  // Poll for completion
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const statusRes = await fetchRetry(
      `https://queue.fal.run/fal-ai/fast-lightning-sdxl/requests/${requestId}/status`,
      { headers: { 'Authorization': `Key ${FAL_KEY}` } },
    );
    if (!statusRes.ok) throw new Error(`fal.ai status ${statusRes.status}`);

    const { status } = await statusRes.json();
    if (status === 'COMPLETED') {
      const resultRes = await fetchRetry(
        `https://queue.fal.run/fal-ai/fast-lightning-sdxl/requests/${requestId}`,
        { headers: { 'Authorization': `Key ${FAL_KEY}` } },
      );
      const result = await resultRes.json();
      const url = result.images?.[0]?.url || result.image?.url;
      if (!url) throw new Error('fal.ai returned no image URL');
      return url;
    }
    if (status === 'FAILED') throw new Error('fal.ai image generation failed');
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error('fal.ai request timed out');
}

export async function POST(request: NextRequest) {
  try {
    let body: Record<string, any> = {};
    try { body = await request.json(); } catch { /* empty body OK */ }

    const difficulty = body.difficulty as IdiomDifficulty | undefined;
    const idiom = difficulty ? pickIdiomByDifficulty(difficulty) : pickRandomIdiom();

    console.log(`[BENCHMARK/START] Generating image for "${idiom.phrase}" (${idiom.difficulty})`);

    const imageUrl = await generateImage(idiom.visualPrompt);

    console.log(`[BENCHMARK/START] ✅ Image ready for "${idiom.phrase}"`);

    return NextResponse.json({
      imageUrl,
      phrase:       idiom.phrase,
      hint:         idiom.hint,
      difficulty:   idiom.difficulty,
      idiomId:      idiom.id,
      visualPrompt: idiom.visualPrompt,
    });
  } catch (err: any) {
    console.error('[BENCHMARK/START] Error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
