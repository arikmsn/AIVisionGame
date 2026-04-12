/**
 * /public-benchmark — AI Vision Model Benchmark
 *
 * Public, read-only. No auth required. Dark, research-first design.
 * Separate from all admin/game routes. Does not trigger any API activity.
 */

import Image from 'next/image';
import { LeaderboardTable } from './LeaderboardTable';

export const dynamic = 'force-dynamic';

// ── Data fetching ─────────────────────────────────────────────────────────────

async function getBenchmarkData() {
  try {
    const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://ai-vision-game.vercel.app';
    const res = await fetch(`${base}/api/public/leaderboard`, {
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json();
  } catch (err) {
    console.error('[public-benchmark] fetch error:', err);
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

  const models      = data?.models      ?? [];
  const globalStats = data?.globalStats ?? {};
  const liveInsights = data?.liveInsights ?? [];
  const sampleRound = data?.sampleRound  ?? null;
  const quotes      = data?.quotes       ?? [];

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
            literal images, watching opponents' guesses, and deciding when to commit.
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
            { label: 'Tournaments',   value: globalStats.total_tournaments?.toLocaleString() ?? '—' },
            { label: 'Rounds',        value: globalStats.total_rounds?.toLocaleString() ?? '—' },
            { label: 'Model-Rounds',  value: globalStats.total_model_rounds?.toLocaleString() ?? '—' },
            { label: 'API Spend',     value: globalStats.total_cost_usd != null ? `$${globalStats.total_cost_usd.toFixed(2)}` : '—' },
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

        {/* ── Leaderboard ──────────────────────────────────────────────────── */}
        <section style={{ marginBottom: 72 }}>
          <SectionHeader label="01" title="Leaderboard" subtitle="All 11 active models · sortable by any column" />
          {models.length > 0
            ? <LeaderboardTable models={models} />
            : <Placeholder />
          }
        </section>

        {/* ── Insights ─────────────────────────────────────────────────────── */}
        <section style={{ marginBottom: 72 }}>
          <SectionHeader label="02" title="Findings" subtitle="3 live from current data · 5 editorial" />
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

        {/* ── Sample Round ─────────────────────────────────────────────────── */}
        <section style={{ marginBottom: 72 }}>
          <SectionHeader
            label="03"
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
                    "{sampleRound.idiom_phrase}"
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

        {/* ── Reasoning Quotes ─────────────────────────────────────────────── */}
        <section style={{ marginBottom: 72 }}>
          <SectionHeader label="04" title="In Their Own Words" subtitle="Strategic reasoning from the highest-scoring rounds" />
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
                  "{q.reasoning_text}"
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

        {/* ── Methodology ──────────────────────────────────────────────────── */}
        <section style={{ marginBottom: 72 }}>
          <SectionHeader label="05" title="Methodology" />
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
              What's next
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
            {data?.generatedAt
              ? `Updated ${new Date(data.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
              : 'AI Vision Benchmark'
            }
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
