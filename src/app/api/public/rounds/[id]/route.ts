/**
 * GET /api/public/rounds/[id]
 * Public read-only round detail: round metadata + per-model results with guess text.
 * No auth required. Cached 1 hour.
 */
import { NextResponse } from 'next/server';

const MODEL_META: Record<string, { label: string; icon: string; accent: string }> = {
  'claude-opus-4-6':                           { label: 'Claude Opus 4.6',   icon: '🟠', accent: '#f97316' },
  'claude-sonnet-4-6':                         { label: 'Claude Sonnet 4.6', icon: '🟡', accent: '#fbbf24' },
  'gpt-4.1':                                   { label: 'GPT-4.1',           icon: '🟢', accent: '#10a37f' },
  'grok-4.20-0309-non-reasoning':              { label: 'Grok 4.20',         icon: '🔴', accent: '#ef4444' },
  'gemini-2.5-pro':                            { label: 'Gemini 2.5 Pro',    icon: '🔵', accent: '#4285f4' },
  'gemma-3-27b-it':                            { label: 'Gemma 3 27B',       icon: '💚', accent: '#34a853' },
  'meta-llama/llama-4-scout-17b-16e-instruct': { label: 'Llama 4 Scout',     icon: '⚡', accent: '#f59e0b' },
  'mistral-large-latest':                      { label: 'Mistral Large',     icon: '🌊', accent: '#06b6d4' },
  'pixtral-large-latest':                      { label: 'Pixtral Large',     icon: '🧊', accent: '#0ea5e9' },
  'qwen/qwen2.5-vl-72b-instruct':              { label: 'Qwen 2.5-VL 72B',   icon: '🔮', accent: '#8b5cf6' },
  'moonshotai/Kimi-K2.5':                      { label: 'Kimi K2.5',         icon: '🌙', accent: '#f472b6' },
};

function sfetch(path: string) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env vars not set');
  return fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
    next: { revalidate: 3600 },
    signal: AbortSignal.timeout(8_000),
  }).then(r => r.json());
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: 'Invalid round ID' }, { status: 400 });
    }

    const [roundRaw, playersRaw, guessesRaw] = await Promise.all([
      sfetch(`arena_rounds?id=eq.${id}&select=id,round_number,idiom_phrase,image_url,ground_truth`),
      sfetch(`arena_round_players?round_id=eq.${id}&select=model_id,final_score,dnf,attempts_used,first_attempt_action,mentions_standing,reasoning_text&order=final_score.desc`),
      sfetch(`arena_guesses?round_id=eq.${id}&select=model_id,attempt_num,guess_text,action,t_ms_from_start,is_correct,points_awarded&order=model_id.asc,attempt_num.asc`),
    ]);

    const round = (roundRaw as any[])[0];
    if (!round) return NextResponse.json({ error: 'Round not found' }, { status: 404 });

    // Build a map of model_id → first guess for that model
    const firstGuessMap = new Map<string, any>();
    for (const g of guessesRaw as any[]) {
      if (g.attempt_num === 1 && !firstGuessMap.has(g.model_id)) {
        firstGuessMap.set(g.model_id, g);
      }
    }

    const players = (playersRaw as any[]).map(p => {
      const firstGuess = firstGuessMap.get(p.model_id);
      const isCorrect = !p.dnf && (p.final_score ?? 0) > 0;
      return {
        model_id:          p.model_id,
        label:             MODEL_META[p.model_id]?.label ?? p.model_id,
        icon:              MODEL_META[p.model_id]?.icon  ?? '?',
        accent:            MODEL_META[p.model_id]?.accent ?? '#888',
        final_score:       p.final_score as number,
        dnf:               p.dnf as boolean,
        attempts_used:     p.attempts_used as number,
        is_correct:        isCorrect,
        first_guess_text:  (firstGuess?.guess_text as string | null) ?? null,
        first_guess_ms:    (firstGuess?.t_ms_from_start as number | null) ?? null,
        reasoning_snippet: (p.reasoning_text as string | null)?.trim().slice(0, 300) ?? null,
      };
    });

    return NextResponse.json({
      round_id:     round.id,
      round_number: round.round_number,
      idiom_phrase: round.idiom_phrase ?? round.ground_truth,
      image_url:    round.image_url,
      players,
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=300' },
    });
  } catch (err: any) {
    console.error('[public/rounds/id] error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal error' }, { status: 500 });
  }
}
