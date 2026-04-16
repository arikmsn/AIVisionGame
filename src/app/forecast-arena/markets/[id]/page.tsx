/**
 * /forecast-arena/markets/[id] — Market detail page
 */

import Link from 'next/link';
import { sfetch } from '@/lib/forecast/db';

export const dynamic = 'force-dynamic';

export default async function MarketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let market: any = null;
  let snapshots: any[] = [];
  let rounds: any[] = [];
  let submissions: any[] = [];

  try {
    const [marketArr, snapshotArr] = await Promise.all([
      sfetch(`fa_markets?id=eq.${id}&select=*`),
      sfetch(`fa_market_snapshots?market_id=eq.${id}&select=*&order=timestamp.desc&limit=20`),
    ]);
    market = Array.isArray(marketArr) && marketArr[0] ? marketArr[0] : null;
    snapshots = Array.isArray(snapshotArr) ? snapshotArr : [];

    if (market) {
      rounds = await sfetch(`fa_rounds?market_id=eq.${id}&select=*&order=round_number.desc`);
      if (!Array.isArray(rounds)) rounds = [];

      if (rounds.length > 0) {
        const roundIds = rounds.map((r: any) => r.id).join(',');
        submissions = await sfetch(`fa_submissions?round_id=in.(${roundIds})&select=*&order=submitted_at.desc`);
        if (!Array.isArray(submissions)) submissions = [];
      }
    }
  } catch { /* ok */ }

  if (!market) {
    return <p style={{ color: '#888' }}>Market not found.</p>;
  }

  return (
    <div>
      <Link href="/forecast-arena/markets" style={{ color: '#666', textDecoration: 'none', fontSize: '0.75rem' }}>
        &larr; Markets
      </Link>

      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginTop: '12px', color: '#f0f0f0' }}>
        {market.title}
      </h2>

      <div style={{ display: 'flex', gap: '24px', marginTop: '12px', fontSize: '0.8rem', flexWrap: 'wrap' }}>
        <div>
          <span style={{ color: '#666' }}>Status: </span>
          <span style={{ color: market.status === 'active' ? '#4ade80' : '#888' }}>{market.status}</span>
        </div>
        <div>
          <span style={{ color: '#666' }}>YES: </span>
          <span style={{ fontWeight: 700 }}>
            {market.current_yes_price != null ? `${(Number(market.current_yes_price) * 100).toFixed(1)}%` : '--'}
          </span>
        </div>
        <div>
          <span style={{ color: '#666' }}>Volume: </span>
          ${Number(market.volume_usd || 0).toLocaleString()}
        </div>
        <div>
          <span style={{ color: '#666' }}>Close: </span>
          {market.close_time ? new Date(market.close_time).toLocaleDateString() : '--'}
        </div>
        <div>
          <span style={{ color: '#666' }}>Source: </span>
          {market.source} / {market.external_id?.slice(0, 12)}
        </div>
        {market.resolution_outcome != null && (
          <div>
            <span style={{ color: '#666' }}>Resolution: </span>
            <span style={{ color: market.resolution_outcome ? '#4ade80' : '#f87171', fontWeight: 700 }}>
              {market.resolution_outcome ? 'YES' : 'NO'}
            </span>
          </div>
        )}
      </div>

      {market.description && (
        <p style={{ color: '#888', fontSize: '0.78rem', marginTop: '16px', maxWidth: '700px', lineHeight: 1.6 }}>
          {market.description.slice(0, 500)}
        </p>
      )}

      {/* Snapshots */}
      <section style={{ marginTop: '28px' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#ccc' }}>
          Price History ({snapshots.length} snapshots)
        </h3>
        {snapshots.length === 0 ? (
          <p style={{ color: '#555', fontSize: '0.8rem' }}>No snapshots.</p>
        ) : (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '0.72rem' }}>
            {snapshots.slice(0, 10).map((s: any, i: number) => (
              <div key={s.id ?? i} style={{ background: '#111', border: '1px solid #222', borderRadius: '4px', padding: '6px 10px' }}>
                <div style={{ color: '#666' }}>{new Date(s.timestamp).toLocaleString()}</div>
                <div style={{ fontWeight: 600 }}>{s.yes_price != null ? `${(Number(s.yes_price) * 100).toFixed(1)}%` : '--'}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Rounds */}
      <section style={{ marginTop: '28px' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#ccc' }}>
          Rounds ({rounds.length})
        </h3>
        {rounds.length === 0 ? (
          <p style={{ color: '#555', fontSize: '0.8rem' }}>No rounds created for this market.</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.78rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #333' }}>
                {['#', 'Status', 'Opened', 'Mkt Price', 'Submissions'].map(h => (
                  <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: '#666', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rounds.map((r: any) => {
                const roundSubs = submissions.filter((s: any) => s.round_id === r.id);
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                    <td style={{ padding: '6px 10px' }}>
                      <Link href={`/forecast-arena/rounds/${r.id}`} style={{ color: '#d4f25a', textDecoration: 'none' }}>
                        R{r.round_number}
                      </Link>
                    </td>
                    <td style={{ padding: '6px 10px', color: r.status === 'resolved' ? '#60a5fa' : r.status === 'open' ? '#4ade80' : '#888' }}>
                      {r.status}
                    </td>
                    <td style={{ padding: '6px 10px', color: '#888' }}>
                      {new Date(r.opened_at).toLocaleString()}
                    </td>
                    <td style={{ padding: '6px 10px' }}>
                      {r.market_yes_price_at_open != null ? `${(Number(r.market_yes_price_at_open) * 100).toFixed(1)}%` : '--'}
                    </td>
                    <td style={{ padding: '6px 10px' }}>{roundSubs.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
