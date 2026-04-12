'use client';

import { useState } from 'react';
import Image from 'next/image';

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

const PAGE_SIZE = 12;

export function RoundGallery({ rounds }: { rounds: RoundSummary[] }) {
  const [page, setPage]             = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail]         = useState<RoundDetail | null>(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(false);

  const totalPages    = Math.ceil(rounds.length / PAGE_SIZE);
  const visibleRounds = rounds.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  async function selectRound(id: string) {
    if (selectedId === id) {
      setSelectedId(null);
      setDetail(null);
      setError(false);
      return;
    }
    setSelectedId(id);
    setDetail(null);
    setError(false);
    setLoading(true);
    try {
      const res = await fetch(`/api/public/rounds/${id}`);
      if (!res.ok) throw new Error('fetch failed');
      setDetail(await res.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  function changePage(next: number) {
    setPage(next);
    setSelectedId(null);
    setDetail(null);
    setError(false);
  }

  return (
    <div>
      {/* ── Card grid ──────────────────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
        gap: 1,
        background: '#1a1a1a',
        border: '1px solid #1a1a1a',
        borderRadius: selectedId ? '6px 6px 0 0' : 6,
        overflow: 'hidden',
      }}>
        {visibleRounds.map(r => {
          const isSelected = selectedId === r.round_id;
          return (
            <button
              key={r.round_id}
              onClick={() => selectRound(r.round_id)}
              style={{
                background: isSelected ? '#131313' : '#0c0c0c',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                padding: 0,
                outline: isSelected ? '1px solid #d4f25a44' : 'none',
                outlineOffset: -1,
                display: 'flex',
                flexDirection: 'column',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = '#0f0f0f'; }}
              onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = '#0c0c0c'; }}
            >
              {/* Thumbnail */}
              <div style={{ position: 'relative', width: '100%', paddingBottom: '72%', background: '#111', overflow: 'hidden', flexShrink: 0 }}>
                {r.image_url ? (
                  <Image
                    src={r.image_url}
                    alt={r.idiom_phrase}
                    fill
                    style={{ objectFit: 'cover', opacity: isSelected ? 1 : 0.75, transition: 'opacity 0.1s' }}
                    unoptimized
                    sizes="210px"
                  />
                ) : (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2a2a2a', fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.65rem' }}>
                    no image
                  </div>
                )}
              </div>

              {/* Card body */}
              <div style={{ padding: '10px 12px 12px', flexGrow: 1 }}>
                <div style={{
                  fontFamily: 'var(--font-geist-sans, sans-serif)',
                  fontSize: '0.78rem',
                  fontWeight: 500,
                  color: isSelected ? '#ebebeb' : '#aaa',
                  marginBottom: 7,
                  lineHeight: 1.3,
                }}>
                  &ldquo;{r.idiom_phrase}&rdquo;
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontFamily: 'var(--font-geist-sans, sans-serif)', fontSize: '0.7rem', color: '#555' }}>
                    {r.winner_icon} {r.winner_label.split(' ').slice(0, 2).join(' ')}
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-geist-mono, monospace)',
                    fontSize: '0.7rem',
                    color: isSelected ? '#d4f25a' : '#3a3a3a',
                  }}>
                    {r.winner_score}
                  </span>
                </div>
                <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.62rem', color: '#2a2a2a' }}>
                  {r.correct_count}/11 correct · range {r.score_min}–{r.score_max}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Expanded detail panel ───────────────────────────────────────────── */}
      {selectedId && (
        <div style={{
          border: '1px solid #1e1e1e',
          borderTop: '1px solid #d4f25a22',
          borderRadius: '0 0 6px 6px',
          background: '#080808',
          overflow: 'hidden',
        }}>
          {loading && (
            <div style={{ padding: 40, textAlign: 'center', color: '#333', fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.78rem' }}>
              Loading round…
            </div>
          )}
          {error && (
            <div style={{ padding: 40, textAlign: 'center', color: '#f87171', fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.78rem' }}>
              Failed to load round detail.
            </div>
          )}
          {detail && <ExpandedRound detail={detail} />}
        </div>
      )}

      {/* ── Pagination ──────────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
          <button
            onClick={() => changePage(Math.max(0, page - 1))}
            disabled={page === 0}
            style={pagerBtn(page === 0)}
          >
            ← Prev
          </button>
          <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.72rem', color: '#444' }}>
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => changePage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
            style={pagerBtn(page >= totalPages - 1)}
          >
            Next →
          </button>
          <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.65rem', color: '#2a2a2a', marginLeft: 8 }}>
            {rounds.length} rounds total
          </span>
        </div>
      )}
    </div>
  );
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

function ExpandedRound({ detail }: { detail: RoundDetail }) {
  const correctCount = detail.players.filter(p => p.is_correct).length;

  return (
    <div>
      {/* Header: image + meta */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 200px) 1fr' }}>
        {detail.image_url ? (
          <div style={{ position: 'relative', aspectRatio: '1', background: '#111' }}>
            <Image src={detail.image_url} alt={detail.idiom_phrase} fill style={{ objectFit: 'cover' }} unoptimized />
          </div>
        ) : (
          <div style={{ background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, color: '#2a2a2a', fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.65rem' }}>
            no image
          </div>
        )}
        <div style={{ padding: '18px 24px', borderLeft: '1px solid #141414' }}>
          <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.58rem', color: '#2a2a2a', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
            Round {detail.round_number} · {correctCount} / {detail.players.length} correct
          </div>
          <h4 style={{ fontFamily: 'var(--font-geist-sans, sans-serif)', fontSize: '1.05rem', fontWeight: 700, color: '#e0e0e0', margin: '0 0 10px', letterSpacing: '-0.01em' }}>
            &ldquo;{detail.idiom_phrase}&rdquo;
          </h4>
          <p style={{ fontFamily: 'var(--font-geist-sans, sans-serif)', fontSize: '0.75rem', color: '#3a3a3a', lineHeight: 1.55, margin: 0 }}>
            Sorted by score — higher score = faster correct submission.
            Score decays exponentially from ~800 with time elapsed in the round.
          </p>
        </div>
      </div>

      {/* Column headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '22px 1fr 90px 60px 50px 55px 1fr',
        padding: '7px 16px',
        borderTop: '1px solid #141414',
        fontFamily: 'var(--font-geist-mono, monospace)',
        fontSize: '0.58rem',
        color: '#2a2a2a',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        gap: 8,
        alignItems: 'center',
      }}>
        <span>#</span>
        <span>Model</span>
        <span>Guess</span>
        <span style={{ textAlign: 'right' }}>Score</span>
        <span style={{ textAlign: 'center' }}>Result</span>
        <span style={{ textAlign: 'center' }}>Tries</span>
        <span>Reasoning</span>
      </div>

      {/* Player rows */}
      {detail.players.map((p, i) => (
        <div key={p.model_id} style={{
          display: 'grid',
          gridTemplateColumns: '22px 1fr 90px 60px 50px 55px 1fr',
          padding: '10px 16px',
          borderTop: '1px solid #0e0e0e',
          alignItems: 'start',
          gap: 8,
          background: i % 2 === 0 ? '#080808' : '#0a0a0a',
        }}>
          {/* # */}
          <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.7rem', color: i === 0 ? '#d4f25a' : '#222', paddingTop: 2 }}>
            {i + 1}
          </span>
          {/* Model */}
          <span style={{ fontFamily: 'var(--font-geist-sans, sans-serif)', fontSize: '0.76rem', color: '#aaa', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.accent, display: 'inline-block', flexShrink: 0 }} />
            {p.label}
          </span>
          {/* Guess text */}
          <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.68rem', color: p.is_correct ? '#6a9a5a' : '#444', lineHeight: 1.3, wordBreak: 'break-word' }}>
            {p.first_guess_text
              ? `"${p.first_guess_text.slice(0, 40)}${p.first_guess_text.length > 40 ? '…' : ''}"`
              : (p.dnf ? '—' : 'waited')}
            {p.first_guess_ms != null && (
              <span style={{ color: '#2a2a2a', marginLeft: 4 }}>
                {(p.first_guess_ms / 1000).toFixed(1)}s
              </span>
            )}
          </span>
          {/* Score */}
          <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.76rem', color: p.dnf ? '#2a2a2a' : (i === 0 ? '#d4f25a' : '#555'), textAlign: 'right', paddingTop: 2 }}>
            {p.dnf ? '—' : p.final_score.toLocaleString()}
          </span>
          {/* Result badge */}
          <span style={{ textAlign: 'center', paddingTop: 2 }}>
            {p.dnf ? (
              <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.6rem', color: '#f87171', background: '#f8717115', padding: '2px 5px', borderRadius: 3 }}>DNF</span>
            ) : p.is_correct ? (
              <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.6rem', color: '#4ade80', background: '#4ade8015', padding: '2px 5px', borderRadius: 3 }}>✓</span>
            ) : (
              <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.6rem', color: '#555', background: '#55555515', padding: '2px 5px', borderRadius: 3 }}>✗</span>
            )}
          </span>
          {/* Attempts */}
          <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.7rem', color: '#2a2a2a', textAlign: 'center', paddingTop: 2 }}>
            {p.attempts_used ?? '—'}
          </span>
          {/* Reasoning */}
          <span style={{ fontFamily: 'var(--font-geist-sans, sans-serif)', fontSize: '0.7rem', color: '#333', lineHeight: 1.45 }}>
            {p.reasoning_snippet
              ? `${p.reasoning_snippet.slice(0, 160)}${p.reasoning_snippet.length > 160 ? '…' : ''}`
              : '—'}
          </span>
        </div>
      ))}

      {/* Footer */}
      <div style={{ padding: '10px 16px', borderTop: '1px solid #0e0e0e', display: 'flex', justifyContent: 'flex-end' }}>
        <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.6rem', color: '#222' }}>
          click card again to collapse
        </span>
      </div>
    </div>
  );
}
