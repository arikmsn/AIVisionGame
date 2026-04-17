/**
 * /forecast-arena/leaderboard — 6-model scoring leaderboard
 */

import Link from 'next/link';
import { sfetch } from '@/lib/forecast/db';
import { FORECAST_MODEL_REGISTRY } from '@/lib/forecast/registry';

export const dynamic = 'force-dynamic';

const PROVIDER_COLOR: Record<string, string> = {
  anthropic:  '#f97316',
  openai:     '#10a37f',
  xai:        '#ef4444',
  google:     '#4285f4',
  openrouter: '#8b5cf6',
};

const PROVIDER_LABEL: Record<string, string> = {
  anthropic:  'Anthropic',
  openai:     'OpenAI',
  xai:        'xAI',
  google:     'Google',
  openrouter: 'OpenRouter',
};

const MODEL_COLOR: Record<string, string> = Object.fromEntries(
  FORECAST_MODEL_REGISTRY.map(m => [m.modelId, m.accentColor]),
);

export default async function LeaderboardPage() {
  let leaderboard: any[] = [];
  try {
    const raw = await sfetch('fa_v_leaderboard?select=*&order=avg_brier.asc.nullslast');
    leaderboard = Array.isArray(raw) ? raw : [];
  } catch { /* ok */ }

  // Separate active (core league) from legacy
  const core   = leaderboard.filter((r: any) => r.is_active !== false);
  const legacy = leaderboard.filter((r: any) => r.is_active === false);

  const thStyle: React.CSSProperties = {
    padding:     '8px 12px',
    textAlign:   'left',
    color:       '#555',
    fontWeight:  500,
    whiteSpace:  'nowrap',
    fontSize:    '0.72rem',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    borderBottom: '1px solid #222',
  };

  const renderRow = (row: any, idx: number, showRank = true) => {
    const accent  = MODEL_COLOR[row.model_id] ?? PROVIDER_COLOR[row.provider] ?? '#444';
    const provLbl = PROVIDER_LABEL[row.provider] ?? row.provider;

    return (
      <tr key={row.agent_id} style={{ borderBottom: '1px solid #141414' }}>
        {showRank && (
          <td style={{ padding: '10px 12px', color: '#444', fontSize: '0.8rem', fontWeight: 700 }}>
            {idx + 1}
          </td>
        )}
        <td style={{ padding: '10px 12px' }}>
          <Link href={`/forecast-arena/players/${row.slug}`}
            style={{ color: '#f0f0f0', textDecoration: 'none', fontWeight: 700, fontSize: '0.85rem' }}>
            {row.display_name}
          </Link>
        </td>
        <td style={{ padding: '10px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{
              fontSize:      '0.62rem',
              fontWeight:    600,
              padding:       '2px 6px',
              borderRadius:  '3px',
              background:    `${accent}1a`,
              color:         accent,
              border:        `1px solid ${accent}33`,
              letterSpacing: '0.04em',
              textTransform: 'uppercase' as const,
              whiteSpace:    'nowrap' as const,
            }}>
              {provLbl}
            </span>
            <span style={{ fontSize: '0.67rem', color: '#555', fontFamily: 'monospace' }}>
              {row.model_id}
            </span>
          </div>
        </td>
        <td style={{ padding: '10px 12px', fontSize: '0.8rem', color: '#888' }}>
          {row.total_submissions ?? 0}
        </td>
        <td style={{ padding: '10px 12px', fontSize: '0.85rem', fontWeight: 700, color: '#f0f0f0' }}>
          {row.avg_brier != null ? Number(row.avg_brier).toFixed(4) : '—'}
        </td>
        <td style={{ padding: '10px 12px', fontSize: '0.8rem', color: '#888' }}>
          {row.avg_log_loss != null ? Number(row.avg_log_loss).toFixed(4) : '—'}
        </td>
        <td style={{ padding: '10px 12px', fontSize: '0.85rem', fontWeight: 600 }}>
          <span style={{
            color: row.avg_edge > 0 ? '#4ade80' : row.avg_edge < 0 ? '#f87171' : '#666',
          }}>
            {row.avg_edge != null
              ? `${Number(row.avg_edge) > 0 ? '+' : ''}${Number(row.avg_edge).toFixed(4)}`
              : '—'}
          </span>
        </td>
        <td style={{ padding: '10px 12px', fontSize: '0.8rem', color: '#888' }}>
          ${row.total_cost_usd != null ? Number(row.total_cost_usd).toFixed(4) : '0'}
        </td>
        <td style={{ padding: '10px 12px', fontSize: '0.8rem', color: '#555' }}>
          {((Number(row.total_input_tokens) || 0) + (Number(row.total_output_tokens) || 0)).toLocaleString()}
        </td>
      </tr>
    );
  };

  const headers = ['#', 'Agent', 'Model / Provider', 'Submissions', 'Avg Brier ↑', 'Avg Log Loss', 'Avg Edge', 'Total Cost', 'Tokens'];

  return (
    <div>
      <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'baseline', gap: '12px' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#ccc', margin: 0 }}>
          Leaderboard
        </h2>
        <span style={{ fontSize: '0.72rem', color: '#555' }}>
          ranked by Brier score (lower = better)
        </span>
      </div>

      {leaderboard.length === 0 ? (
        <p style={{ color: '#555', fontSize: '0.85rem' }}>
          No scored submissions yet. Score rounds to populate this table.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.8rem' }}>
            <thead>
              <tr>
                {headers.map(h => <th key={h} style={thStyle}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {core.map((row, idx) => renderRow(row, idx, true))}
            </tbody>
          </table>

          {legacy.length > 0 && (
            <>
              <div style={{ marginTop: '32px', marginBottom: '10px', fontSize: '0.72rem', color: '#444', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Legacy agents (inactive)
              </div>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.75rem', opacity: 0.5 }}>
                <tbody>
                  {legacy.map((row, idx) => renderRow(row, idx, false))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}
