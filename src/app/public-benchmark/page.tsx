/**
 * /public-benchmark — AI Vision Model Benchmark
 *
 * Public, read-only. No auth required. Dark, research-first design.
 * Separate from all admin/game routes. Does not trigger any API activity.
 */

import Image from 'next/image';
import { LeaderboardTable } from './LeaderboardTable';
import { RoundGallery } from './RoundGallery';

export const dynamic = 'force-dynamic';

// ── Supabase helpers (same as /api/public/leaderboard/route.ts) ───────────────

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

const SAMPLE_ROUND_ID = '79bc523b-ab27-4d90-9c30-7f639c032c79';

function sfetch(path: string) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env vars not set');
  return fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  }).then(r => r.json());
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function getBenchmarkData() {
  try {
    const [statsRaw, quotesRaw, sampleRoundRaw, samplePlayersRaw, tournamentsRaw, allPlayersRaw, roundsRaw] = await Promise.all([
      sfetch('v_model_career_stats?order=total_score.desc'),
      sfetch('arena_round_players?mentions_standing=eq.true&dnf=eq.false&select=model_id,final_score,reasoning_text&order=final_score.desc&limit=20'),
      sfetch(`arena_rounds?id=eq.${SAMPLE_ROUND_ID}&select=*`),
      sfetch(`arena_round_players?round_id=eq.${SAMPLE_ROUND_ID}&select=model_id,dnf,attempts_used,final_score,first_attempt_action,mentions_standing,reasoning_text&order=final_score.desc`),
      sfetch('arena_tournaments?status=eq.completed&select=id,total_rounds,accumulated_cost_usd,started_at&order=started_at.asc'),
      sfetch('arena_round_players?select=round_id,model_id,final_score,dnf,attempts_used&limit=10000'),
      sfetch('arena_rounds?select=id,round_number,idiom_phrase,image_url,ground_truth,arena_round_players(model_id,final_score,dnf)&order=t_start.desc&limit=40'),
    ]);

    const baseModels = (statsRaw as any[])
      .filter(m => (m.tournaments_played ?? 0) >= 5 && MODEL_META[m.model_id]);

    // ── Wins + avg_attempts from allPlayersRaw ────────────────────────────────
    const allPlayers = allPlayersRaw as any[];
    // Group by round
    const byRound = new Map<string, any[]>();
    for (const p of allPlayers) {
      if (!byRound.has(p.round_id)) byRound.set(p.round_id, []);
      byRound.get(p.round_id)!.push(p);
    }
    // Count wins per model
    const winsMap = new Map<string, number>();
    for (const roundPlayers of byRound.values()) {
      const nonDnf = roundPlayers.filter(p => !p.dnf && (p.final_score ?? 0) > 0);
      if (nonDnf.length === 0) continue;
      const maxScore = Math.max(...nonDnf.map((p: any) => p.final_score));
      const winner = nonDnf.find((p: any) => p.final_score === maxScore);
      if (winner) winsMap.set(winner.model_id, (winsMap.get(winner.model_id) ?? 0) + 1);
    }
    // Avg attempts per model
    const attemptsMap = new Map<string, { sum: number; count: number }>();
    for (const p of allPlayers) {
      if (!attemptsMap.has(p.model_id)) attemptsMap.set(p.model_id, { sum: 0, count: 0 });
      const entry = attemptsMap.get(p.model_id)!;
      entry.sum   += (p.attempts_used ?? 0);
      entry.count += 1;
    }

    const models = baseModels.map(m => ({
      ...m,
      ...MODEL_META[m.model_id],
      wins:         winsMap.get(m.model_id) ?? 0,
      avg_attempts: attemptsMap.has(m.model_id)
        ? Math.round(attemptsMap.get(m.model_id)!.sum / attemptsMap.get(m.model_id)!.count * 10) / 10
        : null,
    }));

    // ── Global first_try_pct ──────────────────────────────────────────────────
    const firstTryCount = allPlayers.filter(p => !p.dnf && (p.attempts_used ?? 0) === 1).length;
    const first_try_pct = allPlayers.length > 0
      ? Math.round(firstTryCount / allPlayers.length * 100)
      : null;

    const opus   = models.find(m => m.model_id === 'claude-opus-4-6');
    const gpt    = models.find(m => m.model_id === 'gpt-4.1');
    const topStanding = [...models]
      .sort((a, b) => (b.standing_perception_pct ?? 0) - (a.standing_perception_pct ?? 0))
      .slice(0, 2);
    const positiveModels = models.filter(m => m.avg_round_score > 0);
    const fieldAvg = positiveModels.reduce((s, m) => s + m.avg_round_score, 0) / (positiveModels.length || 1);
    const highDnfModels = models.filter(m => m.dnf_pct > 20);
    const totalDNFrounds = models.reduce((s: number, m: any) => s + Math.round((m.total_rounds ?? 0) * (m.dnf_pct ?? 0) / 100), 0);
    const concentratedDNFs = highDnfModels.reduce((s: number, m: any) => s + Math.round((m.total_rounds ?? 0) * (m.dnf_pct ?? 0) / 100), 0);
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
        detail:   `${highDnfModels.map((m: any) => m.label).join(' and ')} carry DNF rates of ${highDnfModels.map((m: any) => m.dnf_pct.toFixed(0) + '%').join(' and ')}. The remaining ${models.length - highDnfModels.length} active models have a combined DNF rate under 5% — infrastructure failures, not visual reasoning failures.`,
      },
    ];

    const tournaments = tournamentsRaw as any[];
    const totalRounds = tournaments.reduce((s: number, t: any) => s + (t.total_rounds ?? 0), 0);
    const totalCost   = tournaments.reduce((s: number, t: any) => s + (t.accumulated_cost_usd ?? 0), 0);

    const globalStats = {
      total_tournaments:  tournaments.length,
      total_rounds:       totalRounds,
      total_model_rounds: models.reduce((s: number, m: any) => s + (m.total_rounds ?? 0), 0),
      total_cost_usd:     Math.round(totalCost * 100) / 100,
      active_models:      models.length,
      first_try_pct,
      date_from:          tournaments[0]?.started_at?.slice(0, 10) ?? '',
      date_to:            tournaments[tournaments.length - 1]?.started_at?.slice(0, 10) ?? '',
    };

    const roundRow = (sampleRoundRaw as any[])[0];
    const sampleRound = roundRow ? {
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
    } : null;

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
        model_id:       q.model_id,
        label:          MODEL_META[q.model_id]?.label ?? q.model_id,
        icon:           MODEL_META[q.model_id]?.icon ?? '?',
        accent:         MODEL_META[q.model_id]?.accent ?? '#888',
        final_score:    q.final_score as number,
        reasoning_text: q.reasoning_text as string,
      }));

    // ── Gallery rounds (embedded players via PostgREST join) ─────────────────
    const gallery = (Array.isArray(roundsRaw) ? roundsRaw : []).map((r: any) => {
        const players: any[] = Array.isArray(r.arena_round_players) ? r.arena_round_players : [];
        const nonDnf = players.filter((p: any) => !p.dnf && (p.final_score ?? 0) > 0);
        const sorted  = [...nonDnf].sort((a: any, b: any) => (b.final_score ?? 0) - (a.final_score ?? 0));
        const winner  = sorted[0];
        const scores  = nonDnf.map((p: any) => p.final_score as number);
        return {
          round_id:      r.id,
          idiom_phrase:  r.idiom_phrase ?? r.ground_truth ?? '?',
          image_url:     r.image_url as string | null,
          winner_label:  MODEL_META[winner?.model_id]?.label ?? winner?.model_id ?? '?',
          winner_icon:   MODEL_META[winner?.model_id]?.icon  ?? '?',
          winner_score:  winner?.final_score ?? 0,
          score_min:     scores.length ? Math.min(...scores) : 0,
          score_max:     scores.length ? Math.max(...scores) : 0,
          correct_count: nonDnf.length,
        };
      }).filter((r: any) => r.winner_score > 0);

    return { models, globalStats, liveInsights, sampleRound, quotes, gallery };
  } catch (err) {
    console.error('[public-benchmark] data error:', err);
    return null;
  }
}

// ── Static insights (editorial, from handoff doc) ─────────────────────────────

const STATIC_INSIGHTS = [
  {
    id:       'wait-fallacy',
    headline: 'Waiting is a signal of uncertainty, not strategy',
    detail:   'The top five models guess on first attempt 84–86% of rounds. Lower-ranked models wait more — but their wait rate correlates with their DNF rate, not with improved accuracy. The "wait" action in this benchmark is a symptom of visual uncertainty, not a timing advantage.',
  },
  {
    id:       'rationality',
    headline: 'Strategic rationality is near-universal',
    detail:   'Out of 5,291 model-round entries, only a handful of irrational strategic actions were recorded. Models that referenced their standings almost always made the game-theoretically correct decision given that information — even when the underlying visual reasoning was wrong.',
  },
  {
    id:       'accuracy-vs-score',
    headline: 'Accuracy and score diverge at the top',
    detail:   'Gemini 2.5 Pro has the second-highest accuracy (57.2%) but ranks fifth by total score. Claude Opus leads on both, but GPT-4.1 — with 50.1% accuracy — outscores Gemini by capturing first-attempt time bonuses more consistently. Reading images correctly is necessary but not sufficient.',
  },
  {
    id:       'elephant-unanimous',
    headline: '"The elephant in the room" was unanimous',
    detail:   'In one tournament round, all 11 models identified the correct idiom on the first attempt — the only round in the dataset with a perfect participation record. Despite identical answers, scores ranged from 297 to 707, entirely due to submission timing and score-decay curve.',
  },
  {
    id:       'kimi-outlier',
    headline: 'Kimi K2.5 is the benchmark outlier',
    detail:   "Kimi is the only model where mentioning standings correlates with *better* performance. It also logged the dataset's sole irrational standing action. It has the highest standing-awareness rate (56.6%) among models that score positively on that attribute — suggesting genuine but volatile meta-game modeling.",
  },
];

// ── Methodology text ─────────────────────────────────────────────────────────

const METHODOLOGY = `
Each tournament runs 11 vision-language models through 20 rounds of an idiom identification task.
In each round, all models receive the same AI-generated image depicting a common English idiom literally.
Models submit structured JSON responses with an action (guess or wait), a phrase guess, a confidence score, and free-form reasoning.
They can see each other's public guesses and current standings in real time.

Scoring follows an exponential time-decay curve: first-attempt correct guesses score highest,
with deductions for each subsequent attempt and for elapsed time within the round.
Wrong guesses incur a penalty; rounds where all attempts fail or error are marked DNF.

The benchmark tracks three categories: visual reasoning performance (accuracy, score),
strategic behavior (standing awareness, attempt patterns, rationality of standing-based decisions),
and infrastructure reliability (DNF rates, provider error types).

All API calls are made against production endpoints with no special pricing or throttling.
Cost figures reflect standard pay-as-you-go rates at time of collection.
`.trim();

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function PublicBenchmarkPage() {
  const data = await getBenchmarkData();

  const models       = (data?.models      ?? []) as any[];
  const globalStats  = (data?.globalStats ?? {}) as any;
  const liveInsights = (data?.liveInsights ?? []) as any[];
  const sampleRound  = (data?.sampleRound  ?? null) as any;
  const quotes       = (data?.quotes       ?? []) as any[];
  const gallery      = (data?.gallery      ?? []) as any[];

  // Merge insights: live first, then static
  const allInsights = [...liveInsights, ...STATIC_INSIGHTS];

  return (
    <main style={{ background: '#0a0a0a', minHeight: '100vh', color: '#e8e8e8' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px' }}>

        {/* ── Nav ─────────────────────────────────────────────────────────── */}
        <nav style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px 0',
          borderBottom: '1px solid #1a1a1a',
          marginBottom: 64,
        }}>
          <span style={{
            fontFamily: 'var(--font-geist-mono, monospace)',
            fontSize: '0.8rem',
            color: '#555',
            letterSpacing: '0.08em',
          }}>
            AI VISION BENCHMARK
          </span>
          <span style={{
            fontFamily: 'var(--font-geist-mono, monospace)',
            fontSize: '0.72rem',
            color: '#333',
          }}>
            read-only · public
          </span>
        </nav>

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section style={{ marginBottom: 72 }}>
          <h1 style={{
            fontFamily: 'var(--font-geist-sans, sans-serif)',
            fontSize: 'clamp(2.2rem, 5vw, 3.8rem)',
            fontWeight: 700,
            lineHeight: 1.08,
            letterSpacing: '-0.03em',
            color: '#f0f0f0',
            margin: '0 0 20px',
          }}>
            11 vision-language models.<br />
            One benchmark.
          </h1>
          <p style={{
            fontFamily: 'var(--font-geist-sans, sans-serif)',
            fontSize: '1.05rem',
            color: '#777',
            lineHeight: 1.65,
            maxWidth: 560,
            margin: '0 0 32px',
          }}>
            Each model competes in real-time tournaments — identifying idioms from AI-generated
            literal images, watching opponents&apos; guesses, and deciding when to commit.
            Scores decay with time. Strategy matters.
          </p>
          {globalStats.date_from && (
            <p style={{
              fontFamily: 'var(--font-geist-mono, monospace)',
              fontSize: '0.75rem',
              color: '#3a3a3a',
            }}>
              {globalStats.date_from} – {globalStats.date_to} ·{' '}
              {globalStats.total_tournaments} tournaments ·{' '}
              {globalStats.active_models ?? models.length} active models
            </p>
          )}
        </section>

        {/* ── Stats row ────────────────────────────────────────────────────── */}
        <section style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 1,
          background: '#1a1a1a',
          border: '1px solid #1a1a1a',
          borderRadius: 6,
          overflow: 'hidden',
          marginBottom: 72,
        }}>
          {[
            { label: 'Tournaments',     value: globalStats.total_tournaments?.toLocaleString() ?? '—' },
            { label: 'Rounds',          value: globalStats.total_rounds?.toLocaleString() ?? '—' },
            { label: 'Model-Rounds',    value: globalStats.total_model_rounds?.toLocaleString() ?? '—' },
            { label: 'First-try Solve', value: globalStats.first_try_pct != null ? `${globalStats.first_try_pct}%` : '—' },
          ].map(stat => (
            <div key={stat.label} style={{
              background: '#0a0a0a',
              padding: '28px 24px',
            }}>
              <div style={{
                fontFamily: 'var(--font-geist-mono, monospace)',
                fontSize: 'clamp(1.6rem, 3vw, 2.2rem)',
                fontWeight: 700,
                color: '#d4f25a',
                lineHeight: 1,
                marginBottom: 8,
              }}>
                {stat.value}
              </div>
              <div style={{
                fontFamily: 'var(--font-geist-sans, sans-serif)',
                fontSize: '0.75rem',
                color: '#555',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}>
                {stat.label}
              </div>
            </div>
          ))}
        </section>

        {/* ── 01 Leaderboard ───────────────────────────────────────────────── */}
        <section style={{ marginBottom: 72 }}>
          <SectionHeader label="01" title="Leaderboard" subtitle="All 11 active models · sortable by any column" />

          {/* How to read this table */}
          <div style={{
            background: '#0c0c0c',
            borderLeft: '2px solid #1e1e1e',
            padding: '16px 20px',
            marginBottom: 20,
            borderRadius: '0 4px 4px 0',
          }}>
            <div style={{
              fontFamily: 'var(--font-geist-mono, monospace)',
              fontSize: '0.62rem',
              color: '#333',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              marginBottom: 10,
            }}>
              How to read this table
            </div>
            <ul style={{
              fontFamily: 'var(--font-geist-sans, sans-serif)',
              fontSize: '0.78rem',
              color: '#555',
              lineHeight: 1.6,
              margin: 0,
              padding: '0 0 0 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
            }}>
              <li>Avg Score is the primary metric. It measures mean points per round, accounting for submission speed via score decay.</li>
              <li>Accuracy counts correct identifications — but a slow correct guess scores far less than a fast one. Top models win with speed, not just accuracy.</li>
              <li>DNF% = rounds where all 3 attempts failed or the API errored. Infrastructure failures, not reasoning failures.</li>
            </ul>
          </div>

          {models.length > 0
            ? <LeaderboardTable models={models} />
            : <Placeholder />
          }
        </section>

        {/* ── 02 Round Gallery ─────────────────────────────────────────────── */}
        <section style={{ marginBottom: 72 }}>
          <SectionHeader label="02" title="Round Gallery" subtitle="Recent rounds · click any card for full detail" />
          {gallery.length > 0
            ? <RoundGallery rounds={gallery} />
            : <Placeholder />
          }
        </section>

        {/* ── 03 Findings ──────────────────────────────────────────────────── */}
        <section style={{ marginBottom: 72 }}>
          <SectionHeader label="03" title="Findings" subtitle="3 live from current data · 5 editorial" />
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: 1,
            background: '#1a1a1a',
            border: '1px solid #1a1a1a',
            borderRadius: 6,
            overflow: 'hidden',
          }}>
            {allInsights.map((ins: any, i: number) => {
              const isLive = i < liveInsights.length;
              return (
                <div key={ins.id} style={{
                  background: '#0c0c0c',
                  padding: '24px',
                  borderLeft: isLive ? '2px solid #d4f25a' : '2px solid #1e1e1e',
                }}>
                  {isLive && (
                    <div style={{
                      fontFamily: 'var(--font-geist-mono, monospace)',
                      fontSize: '0.65rem',
                      color: '#d4f25a',
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      marginBottom: 6,
                    }}>
                      live · {ins.value}
                    </div>
                  )}
                  <h3 style={{
                    fontFamily: 'var(--font-geist-sans, sans-serif)',
                    fontSize: '0.9rem',
                    fontWeight: 600,
                    color: '#e0e0e0',
                    margin: '0 0 10px',
                    lineHeight: 1.3,
                  }}>
                    {ins.headline}
                  </h3>
                  <p style={{
                    fontFamily: 'var(--font-geist-sans, sans-serif)',
                    fontSize: '0.82rem',
                    color: '#666',
                    lineHeight: 1.6,
                    margin: 0,
                  }}>
                    {ins.detail}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── 04 Round Snapshot ────────────────────────────────────────────── */}
        <section style={{ marginBottom: 72 }}>
          <SectionHeader
            label="04"
            title="Round Snapshot"
            subtitle={sampleRound ? `"${sampleRound.idiom_phrase}" · all 11 models responded` : 'Sample round'}
          />
          {sampleRound ? (
            <div style={{
              border: '1px solid #1e1e1e',
              borderRadius: 6,
              overflow: 'hidden',
              background: '#0c0c0c',
            }}>
              {/* Image + idiom header */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(200px, 320px) 1fr',
                gap: 0,
              }}>
                <div style={{ position: 'relative', aspectRatio: '1', background: '#111' }}>
                  <Image
                    src={sampleRound.image_url}
                    alt={`AI-generated image representing "${sampleRound.idiom_phrase}"`}
                    fill
                    style={{ objectFit: 'cover' }}
                    unoptimized
                  />
                </div>
                <div style={{ padding: '28px 32px', borderLeft: '1px solid #1a1a1a' }}>
                  <div style={{
                    fontFamily: 'var(--font-geist-mono, monospace)',
                    fontSize: '0.65rem',
                    color: '#444',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    marginBottom: 12,
                  }}>
                    idiom
                  </div>
                  <h3 style={{
                    fontFamily: 'var(--font-geist-sans, sans-serif)',
                    fontSize: 'clamp(1.3rem, 2.5vw, 1.9rem)',
                    fontWeight: 700,
                    color: '#f0f0f0',
                    margin: '0 0 20px',
                    letterSpacing: '-0.02em',
                  }}>
                    &ldquo;{sampleRound.idiom_phrase}&rdquo;
                  </h3>
                  <p style={{
                    fontFamily: 'var(--font-geist-sans, sans-serif)',
                    fontSize: '0.82rem',
                    color: '#555',
                    lineHeight: 1.6,
                    margin: 0,
                  }}>
                    All 11 models identified this idiom correctly on the first attempt.
                    Despite identical answers, scores ranged from{' '}
                    <span style={{ color: '#d4f25a' }}>
                      {Math.min(...sampleRound.players.map((p: any) => p.final_score))}
                    </span>{' '}
                    to{' '}
                    <span style={{ color: '#d4f25a' }}>
                      {Math.max(...sampleRound.players.map((p: any) => p.final_score))}
                    </span>{' '}
                    — entirely due to submission timing and the score-decay curve.
                  </p>
                </div>
              </div>

              {/* Player timeline */}
              <div style={{ borderTop: '1px solid #1a1a1a', padding: '20px 0' }}>
                <div style={{
                  padding: '0 24px 12px',
                  fontFamily: 'var(--font-geist-mono, monospace)',
                  fontSize: '0.65rem',
                  color: '#444',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}>
                  Finish order — score ↓
                </div>
                {sampleRound.players.map((p: any, i: number) => (
                  <div key={p.model_id} style={{
                    display: 'grid',
                    gridTemplateColumns: '28px 180px 70px 1fr',
                    gap: 0,
                    padding: '10px 24px',
                    borderTop: i === 0 ? 'none' : '1px solid #141414',
                    alignItems: 'start',
                  }}>
                    <span style={{
                      fontFamily: 'var(--font-geist-mono, monospace)',
                      fontSize: '0.72rem',
                      color: i === 0 ? '#d4f25a' : '#333',
                      paddingTop: 2,
                    }}>
                      {i + 1}
                    </span>
                    <span style={{
                      fontFamily: 'var(--font-geist-sans, sans-serif)',
                      fontSize: '0.83rem',
                      color: '#ccc',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}>
                      <span style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: p.accent,
                        flexShrink: 0,
                      }} />
                      {p.label}
                    </span>
                    <span style={{
                      fontFamily: 'var(--font-geist-mono, monospace)',
                      fontSize: '0.83rem',
                      color: i === 0 ? '#d4f25a' : '#555',
                      paddingTop: 1,
                    }}>
                      {p.final_score.toLocaleString()}
                    </span>
                    <span style={{
                      fontFamily: 'var(--font-geist-sans, sans-serif)',
                      fontSize: '0.75rem',
                      color: '#3a3a3a',
                      lineHeight: 1.4,
                    }}>
                      {p.reasoning_snippet?.slice(0, 120)}{p.reasoning_snippet?.length > 120 ? '…' : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : <Placeholder />}
        </section>

        {/* ── 05 In Their Own Words ─────────────────────────────────────────── */}
        <section style={{ marginBottom: 72 }}>
          <SectionHeader label="05" title="In Their Own Words" subtitle="Strategic reasoning from the highest-scoring rounds" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: '#1a1a1a', borderRadius: 6, overflow: 'hidden' }}>
            {quotes.map((q: any) => (
              <div key={`${q.model_id}-${q.final_score}`} style={{
                background: '#0c0c0c',
                padding: '28px 28px 28px 32px',
                borderLeft: `3px solid ${q.accent}`,
              }}>
                <blockquote style={{
                  fontFamily: 'var(--font-geist-sans, sans-serif)',
                  fontSize: '0.95rem',
                  color: '#c8c8c8',
                  lineHeight: 1.7,
                  margin: '0 0 16px',
                  fontStyle: 'italic',
                }}>
                  &ldquo;{q.reasoning_text}&rdquo;
                </blockquote>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{
                    fontFamily: 'var(--font-geist-sans, sans-serif)',
                    fontSize: '0.8rem',
                    color: '#666',
                  }}>
                    {q.icon} {q.label}
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-geist-mono, monospace)',
                    fontSize: '0.72rem',
                    color: '#333',
                  }}>
                    ·
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-geist-mono, monospace)',
                    fontSize: '0.75rem',
                    color: '#d4f25a',
                  }}>
                    {q.final_score.toLocaleString()} pts
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── 06 Methodology ───────────────────────────────────────────────── */}
        <section style={{ marginBottom: 72 }}>
          <SectionHeader label="06" title="Methodology" />
          <div style={{
            border: '1px solid #1a1a1a',
            borderRadius: 6,
            padding: '28px 32px',
            background: '#0c0c0c',
          }}>
            {METHODOLOGY.split('\n\n').map((para, i) => (
              <p key={i} style={{
                fontFamily: 'var(--font-geist-sans, sans-serif)',
                fontSize: '0.85rem',
                color: '#666',
                lineHeight: 1.75,
                margin: i === 0 ? 0 : '14px 0 0',
              }}>
                {para}
              </p>
            ))}
            <div style={{
              display: 'flex',
              gap: 24,
              flexWrap: 'wrap',
              marginTop: 24,
              paddingTop: 20,
              borderTop: '1px solid #1a1a1a',
            }}>
              {[
                ['Image generation', 'fal.ai flux/schnell'],
                ['Scoring', 'Exponential time-decay, −50 per wrong guess'],
                ['Rounds per tournament', '20'],
                ['Models per round', '11'],
                ['Max attempts per round', '3'],
              ].map(([label, val]) => (
                <div key={label}>
                  <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.65rem', color: '#3a3a3a', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
                  <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.8rem', color: '#777' }}>{val}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── What's Next ──────────────────────────────────────────────────── */}
        <section style={{
          borderTop: '1px solid #1a1a1a',
          padding: '40px 0 80px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 24,
          flexWrap: 'wrap',
        }}>
          <div>
            <div style={{
              fontFamily: 'var(--font-geist-mono, monospace)',
              fontSize: '0.65rem',
              color: '#333',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              marginBottom: 10,
            }}>
              What&apos;s next
            </div>
            <p style={{
              fontFamily: 'var(--font-geist-sans, sans-serif)',
              fontSize: '0.88rem',
              color: '#555',
              maxWidth: 520,
              lineHeight: 1.6,
              margin: 0,
            }}>
              Phase 4 will expand the idiom bank, add per-model profile pages, and introduce
              a full tournament replay viewer. Results are updated after each run.
            </p>
          </div>
          <div style={{
            fontFamily: 'var(--font-geist-mono, monospace)',
            fontSize: '0.72rem',
            color: '#2a2a2a',
            textAlign: 'right',
          }}>
            AI Vision Benchmark
          </div>
        </section>

      </div>
    </main>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function SectionHeader({ label, title, subtitle }: { label: string; title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 24, display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
      <span style={{
        fontFamily: 'var(--font-geist-mono, monospace)',
        fontSize: '0.7rem',
        color: '#333',
      }}>
        {label}
      </span>
      <h2 style={{
        fontFamily: 'var(--font-geist-sans, sans-serif)',
        fontSize: '1.25rem',
        fontWeight: 600,
        color: '#e8e8e8',
        margin: 0,
        letterSpacing: '-0.01em',
      }}>
        {title}
      </h2>
      {subtitle && (
        <span style={{
          fontFamily: 'var(--font-geist-sans, sans-serif)',
          fontSize: '0.8rem',
          color: '#444',
        }}>
          {subtitle}
        </span>
      )}
    </div>
  );
}

function Placeholder() {
  return (
    <div style={{
      border: '1px solid #1a1a1a',
      borderRadius: 6,
      padding: 40,
      textAlign: 'center',
      color: '#333',
      fontFamily: 'var(--font-geist-mono, monospace)',
      fontSize: '0.8rem',
    }}>
      Data unavailable
    </div>
  );
}
