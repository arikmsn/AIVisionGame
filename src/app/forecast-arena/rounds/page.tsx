/**
 * /forecast-arena/rounds — Rounds list
 */

import Link from 'next/link';
import { sfetch } from '@/lib/forecast/db';

export const dynamic = 'force-dynamic';

export default async function RoundsPage() {
  let rounds: any[] = [];
  try {
    rounds = await sfetch('fa_v_round_summary?select=*&order=opened_at.desc&limit=100');
    if (!Array.isArray(rounds)) rounds = [];
  } catch { /* ok */ }

  return (
    <div>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '16px', color: '#ccc' }}>
        Rounds ({rounds.length})
      </h2>

      {rounds.length === 0 ? (
        <p style={{ color: '#555', fontSize: '0.85rem' }}>
          No rounds yet. Create rounds via POST /api/forecast/create-round.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.78rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #333' }}>
                {['#', 'Market', 'Status', 'Market Price', 'Submissions', 'Opened', 'Resolved'].map(h => (
                  <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: '#666', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rounds.map((r: any) => (
                <tr key={r.round_id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                  <td style={{ padding: '6px 10px' }}>
                    <Link href={`/forecast-arena/rounds/${r.round_id}`} style={{ color: '#d4f25a', textDecoration: 'none' }}>
                      R{r.round_number}
                    </Link>
                  </td>
                  <td style={{ padding: '6px 10px', maxWidth: '300px' }}>
                    <Link href={`/forecast-arena/markets/${r.market_id}`} style={{ color: '#ccc', textDecoration: 'none' }}>
                      {(r.market_title ?? '').slice(0, 60)}
                    </Link>
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <span style={{
                      color: r.round_status === 'resolved' ? '#60a5fa'
                        : r.round_status === 'open' ? '#4ade80'
                        : r.round_status === 'completed' ? '#fbbf24'
                        : '#888',
                    }}>
                      {r.round_status}
                    </span>
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    {r.market_yes_price_at_open != null ? `${(Number(r.market_yes_price_at_open) * 100).toFixed(1)}%` : '--'}
                  </td>
                  <td style={{ padding: '6px 10px', fontWeight: 600 }}>{r.submission_count ?? 0}</td>
                  <td style={{ padding: '6px 10px', color: '#888', whiteSpace: 'nowrap' }}>
                    {r.opened_at ? new Date(r.opened_at).toLocaleString() : '--'}
                  </td>
                  <td style={{ padding: '6px 10px', color: '#888', whiteSpace: 'nowrap' }}>
                    {r.resolved_at ? new Date(r.resolved_at).toLocaleString() : '--'}
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
