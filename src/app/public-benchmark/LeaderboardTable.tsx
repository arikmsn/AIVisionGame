'use client';

import { useState, useEffect } from 'react';

type SortKey =
  | 'avg_round_score'
  | 'total_score'
  | 'wins'
  | 'correct_pct'
  | 'dnf_pct'
  | 'avg_attempts'
  | 'score_per_dollar'
  | 'standing_perception_pct';

interface ModelRow {
  model_id:                string;
  label:                   string;
  icon:                    string;
  provider:                string;
  accent:                  string;
  total_rounds:            number;
  total_score:             number;
  avg_round_score:         number;
  correct_pct:             number;
  dnf_pct:                 number;
  score_per_dollar:        number | null;
  standing_perception_pct: number;
  rationality_pct:         number | null;
  total_cost_usd:          number;
  wins:                    number;
  avg_attempts:            number | null;
}

const PRIMARY_COLS: { key: SortKey; label: string; title: string }[] = [
  {
    key:   'avg_round_score',
    label: 'Avg Score',
    title: 'Mean score per round. Scores decay from ~800 to 0 over time — a correct first-attempt guess scores far more than a slow third-attempt guess. This is the primary performance metric.',
  },
  {
    key:   'total_score',
    label: 'Total',
    title: 'Sum of all round scores across every tournament played.',
  },
  {
    key:   'wins',
    label: 'Wins',
    title: 'Rounds where this model had the highest score among all 11 participants — i.e. submitted the fastest correct answer.',
  },
  {
    key:   'correct_pct',
    label: 'Accuracy',
    title: 'Percentage of rounds where the idiom was correctly identified within 3 attempts. High accuracy ≠ high score — a slow correct guess scores far less than a fast one.',
  },
  {
    key:   'dnf_pct',
    label: 'DNF%',
    title: 'Did Not Finish — percentage of rounds where all 3 attempts failed or the API call errored. DNF rounds score 0.',
  },
  {
    key:   'avg_attempts',
    label: 'Avg Tries',
    title: 'Average number of guess attempts used per round. Lower is better — models that need fewer tries tend to be more confident and score higher.',
  },
];

const DIM_COLS: { key: SortKey; label: string; title: string }[] = [
  {
    key:   'score_per_dollar',
    label: 'Score/$',
    title: 'Total score divided by total API cost in USD. Reflects efficiency, not raw performance.',
  },
  {
    key:   'standing_perception_pct',
    label: 'Standing%',
    title: 'Percentage of rounds where the model explicitly referenced its current tournament rank in its reasoning text.',
  },
];

function fmt(val: number | null | undefined, key: SortKey): string {
  if (val == null) return '—';
  if (key === 'total_score')      return val.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (key === 'avg_round_score')  return val.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (key === 'wins')             return val.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (key === 'avg_attempts')     return val.toFixed(2);
  if (key === 'score_per_dollar') {
    if (val <= 0) return '—';
    return val >= 10000 ? (val / 1000).toFixed(1) + 'k' : val.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  return val.toFixed(1) + '%';
}

function colColor(val: number | null, key: SortKey, isDimCol: boolean): string {
  if (isDimCol) return '#555';
  if (val == null) return '#555';
  if (key === 'dnf_pct') {
    if (val > 30) return '#f87171';
    if (val > 10) return '#fbbf24';
    return '#4ade80';
  }
  if (key === 'correct_pct') {
    if (val >= 60) return '#4ade80';
    if (val >= 40) return '#d4f25a';
    return '#888';
  }
  if (key === 'avg_round_score') {
    if (val >= 150) return '#d4f25a';
    if (val >= 80)  return '#a0c040';
    if (val >= 0)   return '#666';
    return '#f87171';
  }
  if (key === 'avg_attempts') {
    if (val <= 1.2) return '#4ade80';
    if (val <= 1.6) return '#d4f25a';
    return '#888';
  }
  return '#ebebeb';
}

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

export function LeaderboardTable({ models }: { models: ModelRow[] }) {
  const [sortKey, setSortKey]   = useState<SortKey>('avg_round_score');
  const [sortDesc, setSortDesc] = useState(true);
  const width = useWindowWidth();
  const isMobile = width < 700;

  function toggleSort(key: SortKey) {
    if (key === sortKey) { setSortDesc(d => !d); }
    else { setSortKey(key); setSortDesc(key !== 'dnf_pct' && key !== 'avg_attempts'); }
  }

  const sorted = [...models].sort((a, b) => {
    const av = (a as any)[sortKey] ?? (sortDesc ? -Infinity : Infinity);
    const bv = (b as any)[sortKey] ?? (sortDesc ? -Infinity : Infinity);
    return sortDesc ? (bv as number) - (av as number) : (av as number) - (bv as number);
  });

  const rank1Score = sorted[0]?.avg_round_score ?? 1;

  if (isMobile) {
    return (
      <div>
        {/* Mobile sort strip */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 10,
          flexWrap: 'wrap',
        }}>
          <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.63rem', color: '#3a3a3a', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Sort:
          </span>
          {PRIMARY_COLS.map(col => (
            <button
              key={col.key}
              onClick={() => toggleSort(col.key)}
              style={{
                background: 'none',
                border: sortKey === col.key ? '1px solid #d4f25a55' : '1px solid #222',
                borderRadius: 3,
                padding: '3px 9px',
                cursor: 'pointer',
                fontFamily: 'var(--font-geist-mono, monospace)',
                fontSize: '0.63rem',
                color: sortKey === col.key ? '#d4f25a' : '#444',
                letterSpacing: '0.02em',
              }}
            >
              {col.label}
            </button>
          ))}
        </div>

        {/* Mobile cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {sorted.map((m, i) => {
            const barWidth = Math.max(2, Math.round((Math.max(0, m.avg_round_score) / Math.max(1, rank1Score)) * 100));
            return (
              <div key={m.model_id} style={{
                background: '#0c0c0c',
                border: '1px solid #181818',
                borderRadius: 4,
                padding: '14px 16px',
              }}>
                {/* Row 1: rank + model name + primary score */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{
                    fontFamily: 'var(--font-geist-mono, monospace)',
                    fontSize: '0.7rem',
                    color: i === 0 ? '#d4f25a' : '#333',
                    minWidth: 18,
                    flexShrink: 0,
                  }}>
                    {i + 1}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontFamily: 'var(--font-geist-sans, sans-serif)',
                      fontSize: '0.88rem',
                      fontWeight: 600,
                      color: '#e8e8e8',
                      marginBottom: 5,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {m.icon} {m.label}
                    </div>
                    {/* Score bar */}
                    <div style={{ height: 2, background: '#1e1e1e', borderRadius: 1, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${barWidth}%`, background: m.accent, opacity: 0.7 }} />
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{
                      fontFamily: 'var(--font-geist-mono, monospace)',
                      fontSize: '1.05rem',
                      fontWeight: 700,
                      color: colColor(m.avg_round_score, 'avg_round_score', false),
                    }}>
                      {fmt(m.avg_round_score, 'avg_round_score')}
                    </div>
                    <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.6rem', color: '#333', marginTop: 2 }}>
                      avg/round
                    </div>
                  </div>
                </div>

                {/* Row 2: secondary metrics */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: 0,
                  borderTop: '1px solid #141414',
                  paddingTop: 10,
                }}>
                  {[
                    { label: 'Accuracy', val: fmt(m.correct_pct, 'correct_pct'), color: colColor(m.correct_pct, 'correct_pct', false) },
                    { label: 'DNF%',     val: fmt(m.dnf_pct, 'dnf_pct'),         color: colColor(m.dnf_pct, 'dnf_pct', false) },
                    { label: 'Wins',     val: fmt(m.wins, 'wins'),               color: '#888' },
                    { label: 'Tries',    val: fmt(m.avg_attempts, 'avg_attempts'), color: colColor(m.avg_attempts, 'avg_attempts', false) },
                  ].map(({ label, val, color }) => (
                    <div key={label} style={{ textAlign: 'center' }}>
                      <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '0.78rem', fontWeight: 600, color }}>{val}</div>
                      <div style={{ fontFamily: 'var(--font-geist-sans, sans-serif)', fontSize: '0.6rem', color: '#3a3a3a', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div style={{
          display: 'flex', gap: 16, marginTop: 12, paddingTop: 12,
          borderTop: '1px solid #1e1e1e',
          fontFamily: 'var(--font-geist-sans, sans-serif)',
          fontSize: '0.7rem', color: '#444', flexWrap: 'wrap',
        }}>
          <span><span style={{ color: '#4ade80' }}>■</span> Accuracy ≥60%</span>
          <span><span style={{ color: '#d4f25a' }}>■</span> Accuracy 40–60%</span>
          <span><span style={{ color: '#f87171' }}>■</span> DNF &gt;30%</span>
        </div>
      </div>
    );
  }

  // ── Desktop table ─────────────────────────────────────────────────────────
  return (
    <div style={{ overflowX: 'auto', width: '100%' }}>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontFamily: 'var(--font-geist-mono, monospace)',
        fontSize: '0.82rem',
      }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #222' }}>
            <th style={{ ...thBase, textAlign: 'left', width: 32, color: '#2e2e2e' }}>#</th>
            <th style={{ ...thBase, textAlign: 'left', minWidth: 190, color: '#888' }}>Model</th>
            <th style={{ ...thBase, textAlign: 'left', minWidth: 80, color: '#3a3a3a', fontFamily: 'var(--font-geist-sans, sans-serif)', fontSize: '0.73rem' }}>Provider</th>
            {PRIMARY_COLS.map(col => (
              <th
                key={col.key}
                onClick={() => toggleSort(col.key)}
                title={col.title}
                style={{
                  ...thBase,
                  cursor: 'pointer',
                  color: sortKey === col.key ? '#d4f25a' : (col.key === 'avg_round_score' ? '#888' : '#555'),
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                  fontWeight: col.key === 'avg_round_score' ? 700 : 500,
                }}
              >
                {col.label}{sortKey === col.key ? (sortDesc ? ' ↓' : ' ↑') : ''}
              </th>
            ))}
            {/* Dim separator */}
            <th style={{ ...thBase, width: 1, padding: '0 4px', background: '#111' }} />
            {DIM_COLS.map(col => (
              <th
                key={col.key}
                onClick={() => toggleSort(col.key)}
                title={col.title}
                style={{
                  ...thBase,
                  cursor: 'pointer',
                  color: sortKey === col.key ? '#d4f25a' : '#333',
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                  opacity: sortKey === col.key ? 1 : 0.6,
                }}
              >
                {col.label}{sortKey === col.key ? (sortDesc ? ' ↓' : ' ↑') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((m, i) => {
            const barWidth = Math.max(2, Math.round((Math.max(0, m.avg_round_score) / Math.max(1, rank1Score)) * 100));
            // Top 3 colored left rail — creates immediate visual hierarchy at a glance
            const rankRail = i === 0 ? '#d4f25a' : i === 1 ? '#555' : i === 2 ? '#303030' : 'transparent';
            return (
              <tr
                key={m.model_id}
                style={{ borderBottom: '1px solid #171717', borderLeft: `2px solid ${rankRail}`, transition: 'background 0.1s' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#111')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {/* Rank */}
                <td style={{ ...tdBase, color: i === 0 ? '#d4f25a' : '#383838', paddingRight: 8, fontWeight: i === 0 ? 700 : 400 }}>{i + 1}</td>

                {/* Model name + bar */}
                <td style={{ ...tdBase, textAlign: 'left' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ color: i === 0 ? '#f2f2f2' : '#d8d8d8', fontFamily: 'var(--font-geist-sans, sans-serif)', fontSize: '0.86rem', fontWeight: 700 }}>
                      {m.icon} {m.label}
                    </span>
                    <div style={{ height: 2, width: '100%', background: '#1a1a1a', borderRadius: 1, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${barWidth}%`, background: m.accent, opacity: i === 0 ? 0.85 : 0.55 }} />
                    </div>
                  </div>
                </td>

                {/* Provider */}
                <td style={{ ...tdBase, textAlign: 'left', color: '#484848', fontFamily: 'var(--font-geist-sans, sans-serif)', fontSize: '0.73rem' }}>
                  {m.provider}
                </td>

                {/* Primary data columns */}
                {PRIMARY_COLS.map(col => {
                  const val = (m as any)[col.key] as number | null;
                  const color = colColor(val, col.key, false);
                  const isActive = sortKey === col.key;
                  const isPrimary = col.key === 'avg_round_score';
                  return (
                    <td key={col.key} style={{
                      ...tdBase,
                      color: isPrimary && i === 0 ? '#d4f25a' : color,
                      fontSize: isPrimary ? '0.96rem' : '0.82rem',
                      fontWeight: isPrimary ? 700 : (isActive ? 600 : 400),
                      background: isActive ? 'rgba(212,242,90,0.025)' : 'transparent',
                    }}>
                      {fmt(val, col.key)}
                    </td>
                  );
                })}

                {/* Dim separator */}
                <td style={{ background: '#0e0e0e', padding: 0 }} />

                {/* Dim columns */}
                {DIM_COLS.map(col => {
                  const val = (m as any)[col.key] as number | null;
                  const isActive = sortKey === col.key;
                  return (
                    <td key={col.key} style={{
                      ...tdBase,
                      color: isActive ? colColor(val, col.key, false) : '#353535',
                      fontWeight: isActive ? 600 : 400,
                      background: isActive ? 'rgba(212,242,90,0.025)' : 'transparent',
                      opacity: isActive ? 1 : 0.8,
                    }}>
                      {fmt(val, col.key)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Legend */}
      <div style={{
        display: 'flex',
        gap: 20,
        marginTop: 12,
        paddingTop: 12,
        borderTop: '1px solid #1e1e1e',
        fontFamily: 'var(--font-geist-sans, sans-serif)',
        fontSize: '0.72rem',
        color: '#444',
        flexWrap: 'wrap',
        alignItems: 'center',
      }}>
        <span>Click column headers to sort.</span>
        <span><span style={{ color: '#4ade80' }}>■</span> Accuracy ≥60%</span>
        <span><span style={{ color: '#d4f25a' }}>■</span> Accuracy 40–60%</span>
        <span><span style={{ color: '#f87171' }}>■</span> DNF &gt;30%</span>
        <span style={{ marginLeft: 'auto', color: '#2a2a2a' }}>Avg Score = primary metric</span>
      </div>
    </div>
  );
}

const thBase: React.CSSProperties = {
  padding: '11px 14px',
  textAlign: 'right',
  fontWeight: 600,
  fontSize: '0.7rem',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
};

const tdBase: React.CSSProperties = {
  padding: '12px 14px',
  textAlign: 'right',
  verticalAlign: 'middle',
};
