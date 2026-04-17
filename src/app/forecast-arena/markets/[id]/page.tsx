/**
 * /forecast-arena/markets/[id] — Market detail: price history + rounds + per-agent position timeline
 */

import Link from 'next/link';
import { sfetch } from '@/lib/forecast/db';

export const dynamic = 'force-dynamic';

function pnlColor(n: number) { return n > 0 ? '#4ade80' : n < 0 ? '#f87171' : '#888'; }
function pnlStr(n: number)   { return `${n >= 0 ? '+' : ''}$${n.toFixed(2)}`; }

export default async function MarketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let market:      any   = null;
  let snapshots:   any[] = [];
  let rounds:      any[] = [];
  let submissions: any[] = [];
  let positions:   any[] = [];
  let agents:      any[] = [];
  let posTicks:    any[] = [];

  try {
    const [marketArr, snapshotArr] = await Promise.all([
      sfetch(`fa_markets?id=eq.${id}&select=*`),
      sfetch(`fa_market_snapshots?market_id=eq.${id}&select=*&order=timestamp.desc&limit=20`),
    ]);
    market    = Array.isArray(marketArr)   && marketArr[0]   ? marketArr[0]   : null;
    snapshots = Array.isArray(snapshotArr) ? snapshotArr : [];

    if (market) {
      [rounds, positions, agents] = await Promise.all([
        sfetch(`fa_rounds?market_id=eq.${id}&select=*&order=round_number.desc`).then((r: any) => Array.isArray(r) ? r : []),
        sfetch(`fa_positions?market_id=eq.${id}&select=*&order=opened_at.asc`).then((r: any) => Array.isArray(r) ? r : []),
        sfetch('fa_agents?select=id,slug,display_name,model_id,provider').then((r: any) => Array.isArray(r) ? r : []),
      ]);

      if (rounds.length > 0) {
        const roundIds = rounds.map((r: any) => r.id).join(',');
        submissions = await sfetch(`fa_submissions?round_id=in.(${roundIds})&select=*&order=submitted_at.desc`)
          .then((r: any) => Array.isArray(r) ? r : []).catch(() => []);
      }

      if (positions.length > 0) {
        const posIds = positions.map((p: any) => p.id).join(',');
        posTicks = await sfetch(
          `fa_position_ticks?position_id=in.(${posIds})&select=*&order=created_at.asc`,
        ).then((r: any) => Array.isArray(r) ? r : []).catch(() => []);
      }
    }
  } catch { /* ok */ }

  if (!market) return <p style={{ color: '#888' }}>Market not found.</p>;

  const agentMap    = new Map(agents.map((a: any) => [a.id, a]));
  const ticksByPos  = new Map<string, any[]>();
  for (const t of posTicks) {
    if (!ticksByPos.has(t.position_id)) ticksByPos.set(t.position_id, []);
    ticksByPos.get(t.position_id)!.push(t);
  }

  const thStyle: React.CSSProperties = {
    padding: '6px 10px', textAlign: 'left', color: '#555',
    fontWeight: 500, whiteSpace: 'nowrap', fontSize: '0.68rem',
    letterSpacing: '0.04em', textTransform: 'uppercase', borderBottom: '1px solid #222',
  };

  return (
    <div>
      <Link href="/forecast-arena/markets" style={{ color: '#666', textDecoration: 'none', fontSize: '0.75rem' }}>
        &larr; Markets
      </Link>

      {/* ── Market header ── */}
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginTop: '12px', color: '#f0f0f0', lineHeight: 1.4 }}>
        {market.title}
      </h2>

      <div style={{ display: 'flex', gap: '24px', marginTop: '10px', fontSize: '0.8rem', flexWrap: 'wrap' }}>
        {[
          { label: 'Status', value: market.status, color: market.status === 'active' ? '#4ade80' : '#888' },
          { label: 'YES', value: market.current_yes_price != null ? `${(Number(market.current_yes_price)*100).toFixed(1)}%` : '--', color: '#f0f0f0', bold: true },
          { label: 'Volume', value: `$${Number(market.volume_usd || 0).toLocaleString()}` },
          { label: 'Close', value: market.close_time ? new Date(market.close_time).toLocaleDateString() : '--' },
          { label: 'Source', value: market.source },
        ].map(item => (
          <div key={item.label}>
            <span style={{ color: '#666' }}>{item.label}: </span>
            <span style={{ color: item.color ?? '#888', fontWeight: item.bold ? 700 : undefined }}>{item.value}</span>
          </div>
        ))}
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
        <p style={{ color: '#777', fontSize: '0.78rem', marginTop: '14px', maxWidth: '680px', lineHeight: 1.6 }}>
          {market.description.slice(0, 500)}
        </p>
      )}

      {/* ── Per-agent position timeline ── */}
      {positions.length > 0 && (
        <section style={{ marginTop: '28px' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '12px', color: '#ccc' }}>
            Agent Positions ({positions.length})
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {positions.map((p: any) => {
              const agent = agentMap.get(p.agent_id);
              const ticks = ticksByPos.get(p.id) ?? [];
              const rlz   = Number(p.realized_pnl   || 0);
              const unr   = Number(p.unrealized_pnl  || 0);
              const ret   = p.cost_basis_usd > 0
                ? (rlz + (p.status === 'open' ? unr : 0)) / Number(p.cost_basis_usd) : 0;

              return (
                <div key={p.id} style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: '6px', padding: '14px 18px' }}>
                  {/* Position header */}
                  <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#f0f0f0' }}>
                      <Link href={`/forecast-arena/players/${agent?.slug}`} style={{ color: '#f0f0f0', textDecoration: 'none' }}>
                        {agent?.display_name ?? p.agent_id.slice(0, 8)}
                      </Link>
                    </span>
                    <span style={{
                      fontSize: '0.65rem', fontWeight: 700, padding: '2px 7px', borderRadius: '3px',
                      background: p.side === 'long' ? '#1a2e1a' : '#2e1a1a',
                      color:      p.side === 'long' ? '#4ade80' : '#f87171',
                    }}>
                      {p.side === 'long' ? '▲ LONG' : '▼ SHORT'}
                    </span>
                    <span style={{
                      fontSize: '0.65rem', padding: '2px 7px', borderRadius: '3px',
                      background: p.status === 'open' ? '#1a2a1a' : '#222',
                      color:      p.status === 'open' ? '#4ade80' : '#666',
                    }}>
                      {p.status}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: '#888' }}>
                      {(Number(p.avg_entry_price)*100).toFixed(1)}% entry
                    </span>
                    <span style={{ fontSize: '0.75rem', color: '#888' }}>
                      ${Number(p.cost_basis_usd).toFixed(2)} deployed
                    </span>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: pnlColor(rlz + (p.status === 'open' ? unr : 0)) }}>
                      {pnlStr(rlz + (p.status === 'open' ? unr : 0))}
                      {' '}
                      <span style={{ fontSize: '0.68rem', color: '#555' }}>({ret >= 0 ? '+' : ''}{(ret*100).toFixed(1)}%)</span>
                    </span>
                  </div>

                  {/* Timeline */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, overflowX: 'auto', paddingBottom: '4px' }}>
                    {/* Entry dot */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '80px' }}>
                      <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#4ade80', flexShrink: 0, marginTop: '2px' }} />
                      <div style={{ fontSize: '0.62rem', color: '#555', marginTop: '4px', textAlign: 'center' }}>
                        OPEN<br />{new Date(p.opened_at).toLocaleDateString()}
                      </div>
                    </div>

                    {ticks.map((t: any, i: number) => {
                      const dotColor = t.action === 'hold' ? '#333'
                        : t.action === 'scale_in' ? '#4ade80'
                        : t.action === 'scale_out' ? '#60a5fa'
                        : '#f87171';
                      return (
                        <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start' }}>
                          <div style={{ width: '32px', height: '2px', background: '#2a2a2a', marginTop: '6px', flexShrink: 0 }} />
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '80px' }}>
                            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: dotColor, flexShrink: 0, marginTop: '2px' }} />
                            <div style={{ fontSize: '0.6rem', color: '#555', marginTop: '4px', textAlign: 'center' }}>
                              <span style={{ color: dotColor, fontWeight: 600 }}>{t.action}</span><br />
                              {(Number(t.market_price)*100).toFixed(1)}%
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* Close dot if closed */}
                    {p.status === 'closed' && (
                      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                        <div style={{ width: '32px', height: '2px', background: '#2a2a2a', marginTop: '6px', flexShrink: 0 }} />
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '80px' }}>
                          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: pnlColor(rlz), flexShrink: 0, marginTop: '2px' }} />
                          <div style={{ fontSize: '0.62rem', color: '#555', marginTop: '4px', textAlign: 'center' }}>
                            CLOSED<br />
                            <span style={{ color: pnlColor(rlz), fontWeight: 600 }}>{pnlStr(rlz)}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Price snapshots ── */}
      <section style={{ marginTop: '28px' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#ccc' }}>
          Price History ({snapshots.length} snapshots)
        </h3>
        {snapshots.length === 0 ? (
          <p style={{ color: '#555', fontSize: '0.8rem' }}>No snapshots.</p>
        ) : (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '0.72rem' }}>
            {snapshots.slice(0, 12).map((s: any, i: number) => (
              <div key={s.id ?? i} style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: '4px', padding: '6px 10px' }}>
                <div style={{ color: '#555' }}>{new Date(s.timestamp).toLocaleString()}</div>
                <div style={{ fontWeight: 600, marginTop: '2px' }}>
                  {s.yes_price != null ? `${(Number(s.yes_price)*100).toFixed(1)}%` : '--'}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Rounds ── */}
      <section style={{ marginTop: '28px' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#ccc' }}>
          Rounds ({rounds.length})
        </h3>
        {rounds.length === 0 ? (
          <p style={{ color: '#555', fontSize: '0.8rem' }}>No rounds created for this market.</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.78rem' }}>
            <thead>
              <tr>
                {['#', 'Status', 'Opened', 'Mkt Price', 'Submissions'].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rounds.map((r: any) => {
                const roundSubs = submissions.filter((s: any) => s.round_id === r.id);
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                    <td style={{ padding: '7px 10px' }}>
                      <Link href={`/forecast-arena/rounds/${r.id}`} style={{ color: '#d4f25a', textDecoration: 'none' }}>
                        R{r.round_number}
                      </Link>
                    </td>
                    <td style={{ padding: '7px 10px', color: r.status === 'resolved' ? '#60a5fa' : r.status === 'open' ? '#4ade80' : '#888' }}>
                      {r.status}
                    </td>
                    <td style={{ padding: '7px 10px', color: '#888' }}>{new Date(r.opened_at).toLocaleString()}</td>
                    <td style={{ padding: '7px 10px' }}>
                      {r.market_yes_price_at_open != null ? `${(Number(r.market_yes_price_at_open)*100).toFixed(1)}%` : '--'}
                    </td>
                    <td style={{ padding: '7px 10px' }}>{roundSubs.length}</td>
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
