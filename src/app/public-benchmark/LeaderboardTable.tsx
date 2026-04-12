'use client';

import { useState } from 'react';

type SortKey = 'total_score' | 'avg_round_score' | 'correct_pct' | 'dnf_pct' | 'score_per_dollar' | 'standing_perception_pct';

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
}

const COLS: { key: SortKey; label: string; title: string }[] = [
  { key: 'total_score',             label: 'Total Score',       title: 'Sum of all round scores' },
  { key: 'avg_round_score',         label: 'Avg / Round',       title: 'Mean score per round played' },
  { key: 'correct_pct',             label: 'Accuracy',          title: 'Rounds where the idiom was correctly identified' },
  { key: 'dnf_pct',                 label: 'DNF%',              title: 'Rounds where all attempts failed or errored' },
  { key: 'score_per_dollar',        label: 'Score / $',         title: 'Total score divided by total API cost in USD' },
  { key: 'standing_perception_pct', label: 'Standing Aware%',   title: 'Rounds where the model explicitly mentioned its tournament standing' },
];

function fmt(val: number | null | undefined, key: SortKey): string {
  if (val == null || val === undefined) return '—';
  if (key === 'total_score' || key === 'avg_round_score') return val.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (key === 'score_per_dollar') {
    if (val <= 0) return '—';
    return val >= 10000 ? (val / 1000).toFixed(1) + 'k' : val.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  return val.toFixed(1) + '%';
}

function colColor(val: number | null, key: SortKey): string {
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
  return '#ebebeb';
}

export function LeaderboardTable({ models }: { models: ModelRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('total_score');
  const [sortDesc, setSortDesc] = useState(true);

  function toggleSort(key: SortKey) {
    if (key === sortKey) { setSortDesc(d => !d); }
    else { setSortKey(key); setSortDesc(key !== 'dnf_pct'); }
  }

  const sorted = [...models].sort((a, b) => {
    const av = a[sortKey] ?? (sortDesc ? -Infinity : Infinity);
    const bv = b[sortKey] ?? (sortDesc ? -Infinity : Infinity);
    return sortDesc ? (bv as number) - (av as number) : (av as number) - (bv as number);
  });

  const rank1Score = sorted[0]?.total_score ?? 1;

  return (
    <div style={{ overflowX: 'auto', width: '100%' }}>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontFamily: 'var(--font-geist-mono, monospace)',
        fontSize: '0.82rem',
      }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
            <th style={{ ...thBase, textAlign: 'left', width: 32, color: '#444' }}>#</th>
            <th style={{ ...thBase, textAlign: 'left', minWidth: 180 }}>Model</th>
            <th style={{ ...thBase, textAlign: 'left', minWidth: 80, color: '#888', fontFamily: 'var(--font-geist-sans, sans-serif)', fontSize: '0.75rem' }}>Provider</th>
            {COLS.map(col => (
              <th
                key={col.key}
                onClick={() => toggleSort(col.key)}
                title={col.title}
                style={{
                  ...thBase,
                  cursor: 'pointer',
                  color: sortKey === col.key ? '#d4f25a' : '#666',
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                {col.label}{sortKey === col.key ? (sortDesc ? ' ↓' : ' ↑') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((m, i) => {
            const barWidth = Math.max(2, Math.round((m.total_score / rank1Score) * 100));
            return (
              <tr
                key={m.model_id}
                style={{
                  borderBottom: '1px solid #1a1a1a',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#161616')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {/* Rank */}
                <td style={{ ...tdBase, color: '#444', paddingRight: 8 }}>{i + 1}</td>

                {/* Model name + bar */}
                <td style={{ ...tdBase, textAlign: 'left' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ color: '#ebebeb', fontFamily: 'var(--font-geist-sans, sans-serif)', fontSize: '0.85rem', fontWeight: 500 }}>
                      {m.icon} {m.label}
                    </span>
                    <div style={{
                      height: 2,
                      width: '100%',
                      background: '#1e1e1e',
                      borderRadius: 1,
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        height: '100%',
                        width: `${barWidth}%`,
                        background: m.accent,
                        opacity: 0.7,
                      }} />
                    </div>
                  </div>
                </td>

                {/* Provider */}
                <td style={{ ...tdBase, textAlign: 'left', color: '#555', fontFamily: 'var(--font-geist-sans, sans-serif)', fontSize: '0.75rem' }}>
                  {m.provider}
                </td>

                {/* Data columns */}
                {COLS.map(col => {
                  const val = m[col.key] as number | null;
                  const color = colColor(val, col.key);
                  const isActive = sortKey === col.key;
                  return (
                    <td key={col.key} style={{
                      ...tdBase,
                      color,
                      fontWeight: isActive ? 600 : 400,
                      background: isActive ? 'rgba(212,242,90,0.03)' : 'transparent',
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
        color: '#555',
      }}>
        <span>Click column headers to sort.</span>
        <span style={{ color: '#4ade80' }}>■</span><span>Accuracy ≥60%</span>
        <span style={{ color: '#d4f25a' }}>■</span><span>Accuracy 40–60%</span>
        <span style={{ color: '#f87171' }}>■</span><span>DNF &gt;30%</span>
      </div>
    </div>
  );
}

const thBase: React.CSSProperties = {
  padding: '10px 14px',
  textAlign: 'right',
  fontWeight: 500,
  fontSize: '0.72rem',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
};

const tdBase: React.CSSProperties = {
  padding: '11px 14px',
  textAlign: 'right',
  verticalAlign: 'middle',
};
