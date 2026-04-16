/**
 * /forecast-arena/leaderboard — Scoring leaderboard
 */

import Link from 'next/link';
import { sfetch } from '@/lib/forecast/db';

export const dynamic = 'force-dynamic';

export default async function LeaderboardPage() {
  let leaderboard: any[] = [];
  try {
    leaderboard = await sfetch('fa_v_leaderboard?select=*&order=avg_brier.asc.nullslast');
    if (!Array.isArray(leaderboard)) leaderboard = [];
  } catch { /* ok */ }

  return (
    <div>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '16px', color: '#ccc' }}>
        Leaderboard
      </h2>

      {leaderboard.length === 0 ? (
        <p style={{ color: '#555', fontSize: '0.85rem' }}>
          No scored submissions yet. Score rounds first.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #333' }}>
                {['#', 'Agent', 'Model', 'Submissions', 'Avg Brier', 'Avg Log Loss', 'Avg Edge', 'Total Cost', 'Tokens'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: '#666', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((row: any, idx: number) => (
                <tr key={row.agent_id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                  <td style={{ padding: '8px 12px', color: '#555' }}>{idx + 1}</td>
                  <td style={{ padding: '8px 12px', fontWeight: 700 }}>
                    <Link href={`/forecast-arena/players/${row.slug}`} style={{ color: '#d4f25a', textDecoration: 'none' }}>
                      {row.display_name}
                    </Link>
                  </td>
                  <td style={{ padding: '8px 12px', color: '#888' }}>{row.model_id}</td>
                  <td style={{ padding: '8px 12px' }}>{row.total_submissions ?? 0}</td>
                  <td style={{ padding: '8px 12px', fontWeight: 700 }}>
                    {row.avg_brier != null ? Number(row.avg_brier).toFixed(4) : '--'}
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    {row.avg_log_loss != null ? Number(row.avg_log_loss).toFixed(4) : '--'}
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ color: row.avg_edge > 0 ? '#4ade80' : row.avg_edge < 0 ? '#f87171' : '#888' }}>
                      {row.avg_edge != null ? `${Number(row.avg_edge) > 0 ? '+' : ''}${Number(row.avg_edge).toFixed(4)}` : '--'}
                    </span>
                  </td>
                  <td style={{ padding: '8px 12px', color: '#888' }}>
                    ${row.total_cost_usd != null ? Number(row.total_cost_usd).toFixed(4) : '0'}
                  </td>
                  <td style={{ padding: '8px 12px', color: '#888' }}>
                    {((Number(row.total_input_tokens) || 0) + (Number(row.total_output_tokens) || 0)).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
