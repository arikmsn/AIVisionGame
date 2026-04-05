/**
 * POST /api/arena/round
 *
 * Triggers a single arena round. Phase 1 entry point.
 *
 * Body (optional — uses random idiom if not provided):
 *   { idiomId?: number, imageUrl?: string }
 *
 * If imageUrl is not provided, generates a new image via fal.ai.
 * If idiomId is not provided, picks a random idiom from the bank.
 *
 * Response: full RoundResult JSON
 *
 * maxDuration = 300s (5 min) — warmup + up to 3 waves of 12 models at 55s each.
 * In practice rounds complete in 30-90s.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runArenaRound }              from '@/lib/arena/round-orchestrator';
import { persistArenaRound }          from '@/lib/db/arena-results';
import { BENCHMARK_IDIOMS }           from '@/lib/benchmark/idioms';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { idiomId, imageUrl: providedImageUrl, skipWarmup } = body;

    // ── Select idiom ────────────────────────────────────────────────────────
    let idiom;
    if (idiomId != null) {
      idiom = BENCHMARK_IDIOMS.find(i => i.id === idiomId);
      if (!idiom) {
        return NextResponse.json({ error: `Idiom ID ${idiomId} not found` }, { status: 400 });
      }
    } else {
      // Random idiom
      idiom = BENCHMARK_IDIOMS[Math.floor(Math.random() * BENCHMARK_IDIOMS.length)];
    }

    // ── Resolve image URL ───────────────────────────────────────────────────
    let imageUrl = providedImageUrl;
    if (!imageUrl) {
      // Generate image via fal.ai
      console.log(`[ARENA/ROUTE] Generating image for "${idiom.phrase}" via fal.ai...`);
      imageUrl = await generateImage(idiom.visualPrompt);
      console.log(`[ARENA/ROUTE] Image generated: ${imageUrl}`);
    }

    if (!imageUrl) {
      return NextResponse.json({ error: 'No image URL available' }, { status: 400 });
    }

    // ── Run the round ───────────────────────────────────────────────────────
    console.log(`[ARENA/ROUTE] Starting arena round: "${idiom.phrase}" (id=${idiom.id})`);

    const result = await runArenaRound({
      idiomId:     idiom.id,
      idiomPhrase: idiom.phrase,
      imageUrl,
      skipWarmup:  skipWarmup === true,
    });

    // ── Persist to DB ───────────────────────────────────────────────────────
    await persistArenaRound(result).catch(err => {
      console.error('[ARENA/ROUTE] DB persistence failed:', err?.message ?? err);
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[ARENA/ROUTE] Unexpected error:', err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}

// ── Image generation helper ─────────────────────────────────────────────────

async function generateImage(visualPrompt: string): Promise<string | null> {
  const falKey = process.env.FAL_KEY;
  if (!falKey) {
    console.error('[ARENA/ROUTE] FAL_KEY not set — cannot generate images');
    return null;
  }

  try {
    const res = await fetch('https://queue.fal.run/fal-ai/flux/schnell', {
      method:  'POST',
      headers: {
        'Authorization': `Key ${falKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        prompt:     visualPrompt,
        image_size: 'landscape_4_3',
        num_images: 1,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[ARENA/ROUTE] fal.ai error: HTTP ${res.status} — ${text.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    return data.images?.[0]?.url ?? null;
  } catch (err: any) {
    console.error('[ARENA/ROUTE] fal.ai generation failed:', err?.message);
    return null;
  }
}
