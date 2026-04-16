/**
 * /forecast-arena/markets — Searchable markets table
 */

import Link from 'next/link';
import { sfetch } from '@/lib/forecast/db';

export const dynamic = 'force-dynamic';

export default async function MarketsPage() {
  let markets: any[] = [];
  try {
    markets = await sfetch('fa_markets?select=*&order=volume_usd.desc.nullslast&limit=100');
    if (!Array.isArray(markets)) markets = [];
  } catch { /* tables may not exist */ }

  return (
    <div>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '16px', color: '#ccc' }}>
        Markets ({markets.length})
      </h2>

      {markets.length === 0 ? (
        <p style={{ color: '#555', fontSize: '0.85rem' }}>
          No markets synced yet. Run POST /api/forecast/sync-markets to import from Polymarket.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.78rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #333' }}>
                {['Title', 'Status', 'YES', 'Volume', 'Close', 'Category'].map(h => (
                  <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: '#666', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {markets.map((m: any) => (
                <tr key={m.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                  <td style={{ padding: '6px 10px', maxWidth: '400px' }}>
                    <Link
                      href={`/forecast-arena/markets/${m.id}`}
                      style={{ color: '#d4f25a', textDecoration: 'none' }}
                    >
                      {(m.title ?? '').slice(0, 80)}
                    </Link>
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <span style={{
                      color: m.status === 'active' ? '#4ade80' : m.status === 'resolved' ? '#60a5fa' : '#888',
                    }}>
                      {m.status}
                    </span>
                  </td>
                  <td style={{ padding: '6px 10px', fontWeight: 600 }}>
                    {m.current_yes_price != null ? `${(Number(m.current_yes_price) * 100).toFixed(1)}%` : '--'}
                  </td>
                  <td style={{ padding: '6px 10px', color: '#888' }}>
                    ${Number(m.volume_usd || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </td>
                  <td style={{ padding: '6px 10px', color: '#666', whiteSpace: 'nowrap' }}>
                    {m.close_time ? new Date(m.close_time).toLocaleDateString() : '--'}
                  </td>
                  <td style={{ padding: '6px 10px', color: '#666' }}>
                    {m.category ?? '--'}
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
