'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';

// ─────────────────────── interfaces ─────────────────────────────────────────

interface RoundSummary {
  round_id:      string;
  idiom_phrase:  string;
  image_url:     string | null;
  winner_label:  string;
  winner_icon:   string;
  winner_score:  number;
  score_min:     number;
  score_max:     number;
  correct_count: number;
}

interface PlayerDetail {
  model_id:          string;
  label:             string;
  icon:              string;
  accent:            string;
  final_score:       number;
  dnf:               boolean;
  attempts_used:     number;
  is_correct:        boolean;
  first_guess_text:  string | null;
  first_guess_ms:    number | null;
  reasoning_snippet: string | null;
}

interface RoundDetail {
  round_id:     string;
  round_number: number;
  idiom_phrase: string;
  image_url:    string | null;
  players:      PlayerDetail[];
}

// ─────────────────────── hooks + helpers ────────────────────────────────────

const PAGE_SIZE = 12;

function useWindowWidth() {
  const [w, setW] = useState(1200);
  useEffect(() => {
    setW(window.innerWidth);
    const h = () => setW(window.innerWidth);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return w;
}

/** True when reasoning_text is an API/infra error string, not real reasoning. */
function isErrorText(text: string | null): boolean {
  if (!text) return false;
  return /rate.?limit|limit.?exceeded|api\s+(error|limit|timeout)|429|timed?\s*out|connection\s+error/i.test(text);
}

/**
 * Extract a sentence that hints at tournament-aware or strategic reasoning.
 * Returns null when not found.
 */
function extractTournamentContext(text: string | null): string | null {
  if (!text || text.length < 40 || isErrorText(text)) return null;
  const keywords =
    /\b(attempt[s]?|second\s+guess|waitin?g?|commit(?:ting)?|confident|uncertain|risk(?:y|ing)?|behind|leading|ahead|ranking?|standing[s]?|decay|elapsed|penalt|negative\s+point|previous\s+guess|already\s+guessed|consecutive|slower|faster)\b/i;
  const sentences = text.replace(/\n+/g, ' ').match(/[^.!?]+[.!?]+/g) ?? [text];
  for (const s of sentences) {
    const t = s.trim();
    if (t.length > 18 && keywords.test(t)) {
      return t.length > 130 ? t.slice(0, 130) + '…' : t;
    }
  }
  return null;
}

function pagerBtn(disabled: boolean): React.CSSProperties {
  return {
    background: 'none',
    border: '1px solid #222',
    color: disabled ? '#2a2a2a' : '#555',
    padding: '5px 14px',
    cursor: disabled ? 'default' : 'pointer',
    fontFamily: 'var(--font-geist-mono, monospace)',
    fontSize: '0.72rem',
    borderRadius: 3,
  };
}

// ─────────────────────── main export ────────────────────────────────────────

export function RoundGallery({ rounds }: { rounds: RoundSummary[] }) {
  const [page, setPage]             = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail]         = useState<RoundDetail | null>(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(false);
  const [hoveredId, setHoveredId]   = useState<string | null>(null);
  const width = useWindowWidth();
  const isMobile  = width < 540;
  const isTablet  = width < 860;

  const totalPages    = Math.ceil(rounds.length / PAGE_SIZE);
  const visibleRounds = rounds.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  async function selectRound(id: string) {
    if (selectedId === id) {
      setSelectedId(null); setDetail(null); setError(false);
      return;
    }
    setSelectedId(id); setDetail(null); setError(false); setLoading(true);
    try {
      const res = await fetch(`/api/public/rounds/${id}`);
      if (!res.ok) throw new Error('fetch failed');
      setDetail(await res.json());
    } catch { setError(true); }
    finally { setLoading(false); }
  }

  function changePage(next: number) {
    setPage(next); setSelectedId(null); setDetail(null); setError(false);
  }

  const gridCols = isMobile ? 1 : isTablet ? 2 : 3;

  return (
    <div>
      {/* ── Card grid ──────────────────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
        gap: 2,
      }}>
        {visibleRounds.map(r => {
          const isSelected = selectedId === r.round_id;
          const isHovered  = hoveredId === r.round_id && !isSelected;
          return (
            <button
              key={r.round_id}
              onClick={() => selectRound(r.round_id)}
              onMouseEnter={() => setHoveredId(r.round_id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                background:  isSelected ? '#141414' : isHovered ? '#111' : '#0c0c0c',
                border:      isSelected ? '1px solid #d4f25a55' : isHovered ? '1px solid #2a2a2a' : '1px solid #181818',
                borderRadius: 4,
                cursor:      'pointer',
                textAlign:   'left',
                padding:     0,
                display:     'flex',
                flexDirection: 'column',
                transition:  'background 0.15s, border-color 0.15s',
                overflow:    'hidden',
              }}
            >
              {/* Thumbnail */}
              <div style={{ position: 'relative', width: '100%', paddingBottom: '64%', background: '#111', overflow: 'hidden', flexShrink: 0 }}>
                {r.image_url ? (
                  <Image
                    src={r.image_url}
                    alt={r.idiom_phrase}
                    fill
                    style={{ objectFit: 'cover', opacity: isSelected ? 1 : isHovered ? 0.88 : 0.72, transition: 'opacity 0.15s' }}
                    unoptimized
                    sizes="(max-width: 540px) 100vw, (max-width: 860px) 50vw, 33vw"
                  />
                ) : (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2a2a2a', fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.65rem' }}>
                    no image
                  </div>
                )}
                {/* Hover score badge */}
                {(isHovered || isSelected) && (
                  <div style={{
                    position: 'absolute', top: 8, right: 8,
                    background: '#000000dd', padding: '3px 8px',
                    borderRadius: 3, fontFamily: 'var(--font-geist-mono, monospace)',
                    fontSize: '0.62rem', color: '#d4f25a',
                    letterSpacing: '0.04em',
                  }}>
                    {r.winner_icon} {r.winner_score}
                  </div>
                )}
              </div>

              {/* Card body */}
              <div style={{ padding: '12px 14px 10px', flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {/* Idiom phrase */}
                <div style={{
                  fontFamily:  'var(--font-geist-sans, sans-serif)',
                  fontSize:    '0.82rem',
                  fontWeight:  600,
                  color:       isSelected ? '#f0f0f0' : isHovered ? '#d8d8d8' : '#bfbfbf',
                  lineHeight:  1.3,
                  transition:  'color 0.15s',
                }}>
                  &ldquo;{r.idiom_phrase}&rdquo;
                </div>

                {/* Winner + score */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: 'var(--font-geist-sans, sans-serif)', fontSize: '0.71rem', color: '#616161' }}>
                    {r.winner_icon} {r.winner_label.split(' ').slice(0, 2).join(' ')}
                  </span>
                  <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.71rem', fontWeight: 600, color: isSelected ? '#d4f25a' : '#3f3f3f' }}>
                    {r.winner_score}
                  </span>
                </div>

                {/* Meta + CTA */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 1 }}>
                  <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.61rem', color: '#333' }}>
                    {r.correct_count}/11 · {r.score_min}–{r.score_max}
                  </span>
                  <span style={{
                    fontFamily:  'var(--font-geist-sans, sans-serif)',
                    fontSize:    '0.66rem',
                    fontWeight:  500,
                    color:       isSelected ? '#666' : isHovered ? '#555' : '#2f2f2f',
                    letterSpacing: '0.01em',
                    transition:  'color 0.15s',
                  }}>
                    {isSelected ? 'collapse ↑' : 'View details →'}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Expanded detail panel ───────────────────────────────────────────── */}
      {selectedId && (
        <div style={{
          border:       '1px solid #1e1e1e',
          borderTop:    '1px solid #d4f25a22',
          borderRadius: '0 0 4px 4px',
          background:   '#080808',
          overflow:     'hidden',
          marginTop:    1,
        }}>
          {loading && (
            <div style={{ padding: 40, textAlign: 'center', color: '#444', fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.78rem' }}>
              Loading round…
            </div>
          )}
          {error && (
            <div style={{ padding: 40, textAlign: 'center', color: '#f87171', fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.78rem' }}>
              Failed to load round detail.
            </div>
          )}
          {detail && <ExpandedRound detail={detail} isMobile={isMobile} />}
        </div>
      )}

      {/* ── Pagination ──────────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
          <button onClick={() => changePage(Math.max(0, page - 1))} disabled={page === 0} style={pagerBtn(page === 0)}>
            ← Prev
          </button>
          <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.72rem', color: '#444' }}>
            {page + 1} / {totalPages}
          </span>
          <button onClick={() => changePage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} style={pagerBtn(page >= totalPages - 1)}>
            Next →
          </button>
          <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.65rem', color: '#333', marginLeft: 8 }}>
            {rounds.length} rounds total
          </span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────── expanded panel ─────────────────────────────────────

function ExpandedRound({ detail, isMobile }: { detail: RoundDetail; isMobile: boolean }) {
  // Filter out models that never produced a guess AND have only error reasoning
  const activePlayers = detail.players.filter(
    p => !(isErrorText(p.reasoning_snippet) && !p.first_guess_text)
  );
  const excludedCount = detail.players.length - activePlayers.length;
  const correctCount  = activePlayers.filter(p => p.is_correct).length;

  // Column layout: condensed on mobile (no first-guess col, no reasoning col)
  const COLS = isMobile
    ? '20px 1fr 52px 36px 36px'
    : '22px 1fr 120px 60px 50px 44px 1.2fr';

  return (
    <div>
      {/* ── Header: image + meta ──────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'minmax(140px, 200px) 1fr',
      }}>
        {detail.image_url ? (
          <div style={{ position: 'relative', aspectRatio: isMobile ? '16/7' : '1', background: '#111' }}>
            <Image src={detail.image_url} alt={detail.idiom_phrase} fill style={{ objectFit: 'cover' }} unoptimized />
          </div>
        ) : (
          <div style={{ background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, color: '#333', fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.65rem', aspectRatio: isMobile ? '16/7' : '1' }}>
            no image
          </div>
        )}
        <div style={{ padding: isMobile ? '14px 16px' : '18px 24px', borderLeft: isMobile ? 'none' : '1px solid #141414', borderTop: isMobile ? '1px solid #141414' : 'none' }}>
          <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.58rem', color: '#3a3a3a', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
            Round {detail.round_number} · {correctCount} / {activePlayers.length} correct
          </div>
          <h4 style={{ fontFamily: 'var(--font-geist-sans, sans-serif)', fontSize: isMobile ? '0.95rem' : '1.05rem', fontWeight: 700, color: '#eaeaea', margin: '0 0 10px', letterSpacing: '-0.01em' }}>
            &ldquo;{detail.idiom_phrase}&rdquo;
          </h4>
          <p style={{ fontFamily: 'var(--font-geist-sans, sans-serif)', fontSize: '0.75rem', color: '#585858', lineHeight: 1.6, margin: 0 }}>
            Scores decay exponentially from ~800 over time. First correct guess scores highest.
          </p>
        </div>
      </div>

      {/* ── Column headers ────────────────────────────────────────────────── */}
      <div style={{
        display: 'grid', gridTemplateColumns: COLS,
        padding: isMobile ? '7px 12px' : '7px 16px',
        borderTop: '1px solid #141414',
        fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.58rem',
        color: '#3a3a3a', letterSpacing: '0.08em', textTransform: 'uppercase',
        gap: 8, alignItems: 'center',
      }}>
        <span>#</span>
        <span style={{ fontWeight: 600 }}>Model</span>
        {!isMobile && <span>First guess</span>}
        <span style={{ textAlign: 'right' }}>Score</span>
        <span style={{ textAlign: 'center' }}>Result</span>
        <span style={{ textAlign: 'center' }}>Tries</span>
        {!isMobile && <span>Reasoning</span>}
      </div>

      {/* ── Player rows ───────────────────────────────────────────────────── */}
      {activePlayers.map((p, i) => {
        const showErrorBadge = isErrorText(p.reasoning_snippet);
        const context        = extractTournamentContext(p.reasoning_snippet);
        const reasoningText  = showErrorBadge
          ? null
          : p.reasoning_snippet
            ? `${p.reasoning_snippet.slice(0, 150)}${p.reasoning_snippet.length > 150 ? '…' : ''}`
            : null;

        return (
          <div key={p.model_id} style={{
            display: 'grid', gridTemplateColumns: COLS,
            padding: isMobile ? '9px 12px' : '10px 16px',
            borderTop: '1px solid #0e0e0e',
            alignItems: 'start', gap: 8,
            background: i % 2 === 0 ? '#080808' : '#090909',
          }}>

            {/* # */}
            <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.7rem', color: i === 0 ? '#d4f25a' : '#2a2a2a', paddingTop: 3 }}>
              {i + 1}
            </span>

            {/* Model */}
            <span style={{ fontFamily: 'var(--font-geist-sans, sans-serif)', fontSize: '0.77rem', fontWeight: 600, color: '#ccc', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.accent, display: 'inline-block', flexShrink: 0 }} />
              {isMobile ? p.label.split(' ').slice(0, 2).join(' ') : p.label}
            </span>

            {/* First guess — desktop only */}
            {!isMobile && (
              <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.67rem', color: p.is_correct ? '#6aad5a' : '#484848', lineHeight: 1.35, wordBreak: 'break-word' }}>
                {p.first_guess_text ? (
                  <>
                    &ldquo;{p.first_guess_text.slice(0, 36)}{p.first_guess_text.length > 36 ? '…' : ''}&rdquo;
                    {!p.dnf && p.first_guess_ms != null && (
                      <span style={{ color: '#333', display: 'block', fontSize: '0.62rem', marginTop: 2 }}>
                        {(p.first_guess_ms / 1000).toFixed(1)}s
                      </span>
                    )}
                  </>
                ) : (
                  <span style={{ color: '#2a2a2a' }}>—</span>
                )}
              </span>
            )}

            {/* Score */}
            <span style={{
              fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.76rem', fontWeight: 600,
              color: p.dnf ? '#2a2a2a' : (i === 0 ? '#d4f25a' : (p.final_score < 0 ? '#f87171aa' : '#686868')),
              textAlign: 'right', paddingTop: 3,
            }}>
              {p.dnf ? '—' : p.final_score.toLocaleString()}
            </span>

            {/* Result badge */}
            <span style={{ textAlign: 'center', paddingTop: 3 }}>
              {p.dnf ? (
                <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.6rem', color: '#f87171', background: '#f8717115', padding: '2px 5px', borderRadius: 3 }}>DNF</span>
              ) : p.is_correct ? (
                <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.6rem', color: '#4ade80', background: '#4ade8015', padding: '2px 5px', borderRadius: 3 }}>✓</span>
              ) : (
                <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.6rem', color: '#555', background: '#55555515', padding: '2px 5px', borderRadius: 3 }}>✗</span>
              )}
            </span>

            {/* Attempts */}
            <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.7rem', fontWeight: 600, color: '#3a3a3a', textAlign: 'center', paddingTop: 3 }}>
              {p.dnf ? '—' : (p.attempts_used ?? '—')}
            </span>

            {/* Reasoning — desktop only */}
            {!isMobile && (
              <div style={{ lineHeight: 1.55 }}>
                {showErrorBadge ? (
                  <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.6rem', color: '#ef4444', background: '#ef444415', padding: '2px 6px', borderRadius: 3 }}>
                    API error
                  </span>
                ) : (
                  <span style={{ fontFamily: 'var(--font-geist-sans, sans-serif)', fontSize: '0.71rem', color: '#686868', letterSpacing: '0.01em', lineHeight: 1.6 }}>
                    {reasoningText ?? <span style={{ color: '#2a2a2a' }}>—</span>}
                  </span>
                )}
                {context && (
                  <div style={{ marginTop: 5, paddingTop: 5, borderTop: '1px solid #111', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.57rem', color: '#d4f25a', opacity: 0.6, letterSpacing: '0.07em', textTransform: 'uppercase', flexShrink: 0, paddingTop: 1 }}>
                      context
                    </span>
                    <span style={{ fontFamily: 'var(--font-geist-sans, sans-serif)', fontSize: '0.68rem', color: '#5e5e5e', lineHeight: 1.45, fontStyle: 'italic' }}>
                      {context}
                    </span>
                  </div>
                )}
              </div>
            )}

          </div>
        );
      })}

      {/* ── Excluded rows notice ──────────────────────────────────────────── */}
      {excludedCount > 0 && (
        <div style={{ padding: '8px 16px', borderTop: '1px solid #0e0e0e', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.6rem', color: '#2a2a2a' }}>
            {excludedCount} model{excludedCount > 1 ? 's' : ''} excluded (API errors — no guess submitted)
          </span>
        </div>
      )}

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <div style={{ padding: '9px 16px', borderTop: '1px solid #0e0e0e', display: 'flex', justifyContent: 'flex-end' }}>
        <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.6rem', color: '#222' }}>
          click card again to collapse ↑
        </span>
      </div>
    </div>
  );
}
