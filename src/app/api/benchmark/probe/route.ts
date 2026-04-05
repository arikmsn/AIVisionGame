/**
 * POST /api/benchmark/probe
 *
 * Calls a single AI model with a benchmark image and returns its guess.
 * The phrase is used server-side ONLY to compute isCorrect — it is never
 * forwarded to the model.
 *
 * Body: { modelId: string, imageUrl: string, phrase: string }
 *
 * Response: ProbeResult with isCorrect added
 */

import { NextRequest, NextResponse } from 'next/server';
import { dispatchProbe } from '@/lib/agents/dispatcher';

export const maxDuration = 60;

/** Normalise a string for comparison: lowercase, strip punctuation/articles */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[''""".,!?;:()\-–—\/\\]/g, '')
    .replace(/\b(a|an|the)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True if the guess contains all the significant words of the phrase. */
function checkCorrect(guess: string, phrase: string): boolean {
  const gNorm = normalise(guess);
  const pNorm = normalise(phrase);

  // Empty or trivial guess is never correct
  if (!gNorm || gNorm.length < 2) return false;

  // Exact match after normalisation
  if (gNorm === pNorm) return true;
  if (gNorm.includes(pNorm)) return true;
  if (pNorm.includes(gNorm) && gNorm.length > 4) return true;

  // All significant words of phrase appear in guess
  // Guard: only match non-empty guess words to avoid empty-string wildcard
  const pWords = pNorm.split(' ').filter(w => w.length > 2);
  const gWords = gNorm.split(' ').filter(w => w.length > 0);
  const matched = pWords.filter(pw => gWords.some(gw => gw === pw || gw.includes(pw) || pw.includes(gw)));
  return matched.length === pWords.length && pWords.length > 0;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { modelId, imageUrl, phrase } = body;

    if (!modelId || !imageUrl) {
      return NextResponse.json({ error: 'modelId and imageUrl are required' }, { status: 400 });
    }

    console.log(`[BENCHMARK/PROBE] ${modelId} → "${phrase}"`);

    const result = await dispatchProbe(modelId, imageUrl);

    const isCorrect = !result.isKeyMissing && !result.error
      ? checkCorrect(result.guess, phrase ?? '')
      : false;

    console.log(
      `[BENCHMARK/PROBE] ${modelId} | guess="${result.guess}" | correct=${isCorrect} | ${result.latencyMs}ms` +
      (result.error ? ` | ERROR: ${result.error}` : '') +
      (result.isKeyMissing ? ' | KEY_MISSING' : ''),
    );

    return NextResponse.json({ ...result, isCorrect });
  } catch (err: any) {
    console.error('[BENCHMARK/PROBE] Unexpected error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
