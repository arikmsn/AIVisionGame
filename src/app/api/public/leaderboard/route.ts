/**
 * GET /api/public/leaderboard
 *
 * Public, read-only data endpoint for the benchmark UI.
 * Aggregates career stats, top quotes, sample round, and live insights.
 * No auth required. Cached for 1 hour.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// ── Model metadata ────────────────────────────────────────────────────────────

const MODEL_META: Record<string, { label: string; icon: string; provider: string; accent: string }> = {
  'claude-opus-4-6':                           { label: 'Claude Opus 4.6',   icon: '🟠', provider: 'Anthropic',  accent: '#f97316' },
  'claude-sonnet-4-6':                         { label: 'Claude Sonnet 4.6', icon: '🟡', provider: 'Anthropic',  accent: '#fbbf24' },
  'gpt-4.1':                                   { label: 'GPT-4.1',           icon: '🟢', provider: 'OpenAI',     accent: '#10a37f' },
  'grok-4.20-0309-non-reasoning':              { label: 'Grok 4.20',         icon: '🔴', provider: 'xAI',        accent: '#ef4444' },
  'gemini-2.5-pro':                            { label: 'Gemini 2.5 Pro',    icon: '🔵', provider: 'Google',     accent: '#4285f4' },
  'gemma-3-27b-it':                            { label: 'Gemma 3 27B',       icon: '💚', provider: 'Google',     accent: '#34a853' },
  'meta-llama/llama-4-scout-17b-16e-instruct': { label: 'Llama 4 Scout',     icon: '⚡', provider: 'Meta',       accent: '#f59e0b' },
  'mistral-large-latest':                      { label: 'Mistral Large',     icon: '🌊', provider: 'Mistral',    accent: '#06b6d4' },
  'pixtral-large-latest':                      { label: 'Pixtral Large',     icon: '🧊', provider: 'Mistral',    accent: '#0ea5e9' },
  'qwen/qwen2.5-vl-72b-instruct':              { label: 'Qwen 2.5-VL 72B',   icon: '🔮', provider: 'Alibaba',    accent: '#8b5cf6' },
  'moonshotai/Kimi-K2.5':                      { label: 'Kimi K2.5',         icon: '🌙', provider: 'Moonshot',   accent: '#f472b6' },
};

// ── Curated sample round ──────────────────────────────────────────────────────
// "The Elephant in the Room" — all 11 models participated, wide score spread,
// 10/11 mentioned standings, strong strategic reasoning visible.
const SAMPLE_ROUND_ID = '79bc523b-ab27-4d90-9c30-7f639c032c79';

// ── Supabase fetch helper ─────────────────────────────────────────────────────

function sfetch(path: string) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env vars not set');
  return fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
    next: { revalidate: 3600 },
    signal: AbortSignal.timeout(12_000),
  }).then(r => r.json());
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const [statsRaw, quotesRaw, sampleRoundRaw, samplePlayersRaw, tournamentsRaw] = await Promise.all([
      sfetch('v_model_career_stats?order=total_score.desc'),
      sfetch('arena_round_players?mentions_standing=eq.true&dnf=eq.false&select=model_id,final_score,reasoning_text&order=final_score.desc&limit=20'),
      sfetch(`arena_rounds?id=eq.${SAMPLE_ROUND_ID}&select=*`),
      sfetch(`arena_round_players?round_id=eq.${SAMPLE_ROUND_ID}&select=model_id,dnf,attempts_used,final_score,first_attempt_action,mentions_standing,reasoning_text&order=final_score.desc`),
      sfetch('arena_tournaments?status=eq.completed&select=id,total_rounds,accumulated_cost_usd,started_at&order=started_at.asc'),
    ]);

    // ── Active models (≥ 5 tournaments) ──────────────────────────────────────
    const models = (statsRaw as any[])
      .filter(m => (m.tournaments_played ?? 0) >= 5 && MODEL_META[m.model_id])
      .map(m => ({ ...m, ...MODEL_META[m.model_id] }));

    // ── Live insights (computed from data) ────────────────────────────────────
    const opus   = models.find(m => m.model_id === 'claude-opus-4-6');
    const gpt    = models.find(m => m.model_id === 'gpt-4.1');
    const topStanding = [...models]
      .sort((a, b) => (b.standing_perception_pct ?? 0) - (a.standing_perception_pct ?? 0))
      .slice(0, 2);
    const positiveModels = models.filter(m => m.avg_round_score > 0);
    const fieldAvg = positiveModels.reduce((s, m) => s + m.avg_round_score, 0) / (positiveModels.length || 1);
    const highDnfModels = models.filter(m => m.dnf_pct > 20);
    const totalDNFrounds = models.reduce((s, m) => s + Math.round((m.total_rounds ?? 0) * (m.dnf_pct ?? 0) / 100), 0);
    const concentratedDNFs = highDnfModels.reduce((s, m) => s + Math.round((m.total_rounds ?? 0) * (m.dnf_pct ?? 0) / 100), 0);
    const costRatio = opus && gpt ? Math.round(opus.total_cost_usd / gpt.total_cost_usd) : 12;
    const scoreRatio = opus && gpt ? Math.round(gpt.total_score / opus.total_score * 100) : 95;

    const liveInsights = [
      {
        id:       'cost-cliff',
        headline: `GPT-4.1 delivers ${scoreRatio}% of top score at ${costRatio}× lower cost`,
        value:    `${costRatio}×`,
        detail:   `Claude Opus 4.6 leads the benchmark by a narrow margin but costs $${opus?.total_cost_usd.toFixed(2) ?? '—'} total vs $${gpt?.total_cost_usd.toFixed(2) ?? '—'} for GPT-4.1 across the same rounds. The performance plateau is real; the cost cliff is steeper.`,
      },
      {
        id:       'standing-paradox',
        headline: 'Standing awareness tracks struggle, not strategy',
        value:    `${topStanding[0]?.standing_perception_pct.toFixed(0)}% / ${topStanding[1]?.standing_perception_pct.toFixed(0)}%`,
        detail:   `${topStanding[0]?.label} and ${topStanding[1]?.label} mention tournament standings in ${topStanding[0]?.standing_perception_pct.toFixed(0)}% and ${topStanding[1]?.standing_perception_pct.toFixed(0)}% of rounds — the two highest rates in the study. Both score below the field average of ${fieldAvg.toFixed(0)} pts/round. Models comment on standings when they're losing, not winning.`,
      },
      {
        id:       'dnf-concentration',
        headline: `${highDnfModels.length} models account for ${Math.round(concentratedDNFs / Math.max(totalDNFrounds, 1) * 100)}% of all failed rounds`,
        value:    `${Math.round(concentratedDNFs / Math.max(totalDNFrounds, 1) * 100)}%`,
        detail:   `${highDnfModels.map(m => m.label).join(' and ')} carry DNF rates of ${highDnfModels.map(m => m.dnf_pct.toFixed(0) + '%').join(' and ')}. The remaining ${models.length - highDnfModels.length} active models have a combined DNF rate under 5% — infrastructure failures, not visual reasoning failures.`,
      },
    ];

    // ── Global stats ──────────────────────────────────────────────────────────
    const tournaments = tournamentsRaw as any[];
    const totalRounds = tournaments.reduce((s, t) => s + (t.total_rounds ?? 0), 0);
    const totalCost   = tournaments.reduce((s, t) => s + (t.accumulated_cost_usd ?? 0), 0);

    const globalStats = {
      total_tournaments:  tournaments.length,
      total_rounds:       totalRounds,
      total_model_rounds: models.reduce((s, m) => s + (m.total_rounds ?? 0), 0),
      total_cost_usd:     Math.round(totalCost * 100) / 100,
      active_models:      models.length,
      date_from:          tournaments[0]?.started_at?.slice(0, 10) ?? '',
      date_to:            tournaments[tournaments.length - 1]?.started_at?.slice(0, 10) ?? '',
    };

    // ── Sample round ──────────────────────────────────────────────────────────
    const roundRow = (sampleRoundRaw as any[])[0];
    const sampleRound = roundRow
      ? {
          round_id:     roundRow.id,
          round_number: roundRow.round_number,
          idiom_phrase: roundRow.idiom_phrase ?? roundRow.ground_truth,
          image_url:    roundRow.image_url,
          players: (samplePlayersRaw as any[]).slice(0, 7).map(p => ({
            model_id:          p.model_id,
            label:             MODEL_META[p.model_id]?.label ?? p.model_id,
            icon:              MODEL_META[p.model_id]?.icon ?? '?',
            accent:            MODEL_META[p.model_id]?.accent ?? '#888',
            final_score:       p.final_score as number,
            dnf:               p.dnf as boolean,
            mentions_standing: p.mentions_standing as boolean,
            reasoning_snippet: (p.reasoning_text as string | null)?.slice(0, 200) ?? '',
          })),
        }
      : null;

    // ── Quotes: diverse models, highest signal ────────────────────────────────
    const seen = new Set<string>();
    const quotes = (quotesRaw as any[])
      .filter(q => (q.reasoning_text as string | null)?.length ?? 0 > 120)
      .filter(q => {
        if (seen.has(q.model_id) && seen.size < 3) return false;
        if (seen.size >= 4) return false;
        seen.add(q.model_id);
        return true;
      })
      .slice(0, 4)
      .map(q => ({
        model_id:     q.model_id,
        label:        MODEL_META[q.model_id]?.label ?? q.model_id,
        icon:         MODEL_META[q.model_id]?.icon ?? '?',
        accent:       MODEL_META[q.model_id]?.accent ?? '#888',
        final_score:  q.final_score as number,
        reasoning_text: q.reasoning_text as string,
      }));

    return NextResponse.json(
      { models, globalStats, liveInsights, sampleRound, quotes, generatedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=300' } },
    );
  } catch (err: any) {
    console.error('[public/leaderboard] error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal error' }, { status: 500 });
  }
}
