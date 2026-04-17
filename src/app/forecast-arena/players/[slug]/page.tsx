/**
 * /forecast-arena/players/[slug] — Agent detail: submissions + live positions + ticks
 */

import Link from 'next/link';
import { sfetch } from '@/lib/forecast/db';

export const dynamic = 'force-dynamic';

function pnlColor(n: number) { return n > 0 ? '#4ade80' : n < 0 ? '#f87171' : '#888'; }
function pnlStr(n: number)   { return `${n >= 0 ? '+' : ''}$${n.toFixed(2)}`; }

export default async function PlayerDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let agent:      any   = null;
  let submissions: any[] = [];
  let scores:     any[] = [];
  let wallet:     any   = null;
  let positions:  any[] = [];
  let ticks:      any[] = [];

  try {
    const agentArr = await sfetch(`fa_agents?slug=eq.${slug}&select=*`);
    agent = Array.isArray(agentArr) && agentArr[0] ? agentArr[0] : null;

    if (agent) {
      [submissions, scores, wallet, positions] = await Promise.all([
        sfetch(`fa_submissions?agent_id=eq.${agent.id}&select=*&order=submitted_at.desc&limit=50`)
          .then((r: any) => Array.isArray(r) ? r : []),
        sfetch(`fa_scores?agent_id=eq.${agent.id}&select=*&order=scored_at.desc&limit=50`)
          .then((r: any) => Array.isArray(r) ? r : []),
        sfetch(`fa_agent_wallets?agent_id=eq.${agent.id}&select=*`)
          .then((r: any) => Array.isArray(r) && r[0] ? r[0] : null),
        sfetch(`fa_positions?agent_id=eq.${agent.id}&select=*&order=opened_at.desc&limit=30`)
          .then((r: any) => Array.isArray(r) ? r : []),
      ]);

      // Load ticks for all positions
      if (positions.length > 0) {
        const posIds = positions.map((p: any) => p.id).join(',');
        ticks = await sfetch(
          `fa_position_ticks?position_id=in.(${posIds})&select=*&order=created_at.desc&limit=100`,
        ).then((r: any) => Array.isArray(r) ? r : []).catch(() => []);
      }

      // Enrich positions with market titles
      const marketIds = [...new Set(positions.map((p: any) => p.market_id))];
      if (marketIds.length > 0) {
        const markets = await sfetch(
          `fa_markets?id=in.(${marketIds.join(',')})&select=id,title,current_yes_price`,
        ).then((r: any) => Array.isArray(r) ? r : []).catch(() => []);
        const marketMap = new Map(markets.map((m: any) => [m.id, m]));
        for (const p of positions) {
          p._market = marketMap.get(p.market_id);
        }
      }
    }
  } catch { /* ok */ }

  if (!agent) return <p style={{ color: '#888' }}>Agent not found.</p>;

  const totalCost  = submissions.reduce((s: number, sub: any) => s + (Number(sub.cost_usd) || 0), 0);
  const totalToks  = submissions.reduce((s: number, sub: any) => s + (Number(sub.input_tokens) || 0) + (Number(sub.output_tokens) || 0), 0);
  const avgLat     = submissions.length > 0
    ? Math.round(submissions.reduce((s: number, sub: any) => s + (Number(sub.latency_ms) || 0), 0) / submissions.length)
    : 0;
  const errCount   = submissions.filter((s: any) => s.error_text).length;
  const avgBrier   = scores.length > 0
    ? scores.reduce((s: number, sc: any) => s + (Number(sc.brier_score) || 0), 0) / scores.length : null;
  const avgEdge    = scores.length > 0
    ? scores.reduce((s: number, sc: any) => s + (Number(sc.edge_at_submission) || 0), 0) / scores.length : null;

  const openPos    = positions.filter((p: any) => p.status === 'open');
  const closedPos  = positions.filter((p: any) => p.status === 'closed');
  const totalUnr   = openPos.reduce((s: number, p: any) => s + Number(p.unrealized_pnl || 0), 0);
  const totalRlz   = positions.reduce((s: number, p: any) => s + Number(p.realized_pnl || 0), 0);

  const thStyle: React.CSSProperties = {
    padding: '6px 10px', textAlign: 'left', color: '#555',
    fontWeight: 500, whiteSpace: 'nowrap', fontSize: '0.68rem',
    letterSpacing: '0.04em', textTransform: 'uppercase', borderBottom: '1px solid #222',
  };

  return (
    <div>
      <Link href="/forecast-arena/players" style={{ color: '#666', textDecoration: 'none', fontSize: '0.75rem' }}>
        &larr; Players
      </Link>

      <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginTop: '12px', color: '#f0f0f0' }}>
        {agent.display_name}
      </h2>
      <p style={{ fontSize: '0.78rem', color: '#666', marginTop: '4px' }}>
        {agent.model_id} · {agent.provider} · {agent.prompt_version}
        · Strategy: {agent.strategy_profile_json?.strategy ?? '--'}
      </p>

      {/* ── Stats cards ── */}
      <div style={{ display: 'flex', gap: '12px', marginTop: '16px', flexWrap: 'wrap' }}>
        {[
          { label: 'Submissions',    value: String(submissions.length),  sub: errCount > 0 ? `${errCount} errors` : undefined, subColor: '#f87171' },
          { label: 'Avg Brier',      value: avgBrier != null ? avgBrier.toFixed(4) : '--' },
          { label: 'Avg Edge',       value: avgEdge != null ? `${avgEdge > 0 ? '+' : ''}${avgEdge.toFixed(4)}` : '--', valueColor: avgEdge != null ? pnlColor(avgEdge) : '#f0f0f0' },
          { label: 'Total LLM Cost', value: `$${totalCost.toFixed(4)}` },
          { label: 'Avg Latency',    value: `${avgLat}ms` },
          { label: 'Tokens',         value: totalToks.toLocaleString() },
          { label: 'Open Positions', value: String(openPos.length), sub: totalUnr !== 0 ? `${pnlStr(totalUnr)} unrealized` : undefined, subColor: pnlColor(totalUnr) },
          { label: 'Total Realized', value: pnlStr(totalRlz), valueColor: pnlColor(totalRlz) },
          ...(wallet ? [{ label: 'Paper Balance', value: `$${Number(wallet.paper_balance_usd).toLocaleString()}` }] : []),
        ].map(card => (
          <div key={card.label} style={{ background: '#111', border: '1px solid #222', borderRadius: '6px', padding: '12px 16px' }}>
            <div style={{ color: '#666', fontSize: '0.63rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{card.label}</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '4px', color: card.valueColor ?? '#f0f0f0' }}>{card.value}</div>
            {card.sub && <div style={{ fontSize: '0.63rem', color: card.subColor ?? '#888', marginTop: '2px' }}>{card.sub}</div>}
          </div>
        ))}
      </div>

      {/* ── Open Positions ── */}
      {openPos.length > 0 && (
        <section style={{ marginTop: '28px' }}>
          <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: '#ccc', marginBottom: '10px' }}>
            Open Positions ({openPos.length})
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '10px' }}>
            {openPos.map((p: any) => {
              const unr   = Number(p.unrealized_pnl || 0);
              const rlz   = Number(p.realized_pnl   || 0);
              const pct   = p.cost_basis_usd > 0 ? unr / Number(p.cost_basis_usd) : 0;
              const posTicks = ticks.filter((t: any) => t.position_id === p.id);

              return (
                <div key={p.id} style={{ background: '#111', border: '1px solid #222', borderRadius: '6px', padding: '14px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ fontSize: '0.78rem', color: '#aaa', maxWidth: '220px', lineHeight: 1.4 }}>
                      {p._market?.title ?? p.market_id?.slice(0, 20)}
                    </div>
                    <span style={{
                      fontSize: '0.63rem', fontWeight: 700, padding: '2px 6px', borderRadius: '3px',
                      background: p.side === 'long' ? '#1a2e1a' : '#2e1a1a',
                      color:      p.side === 'long' ? '#4ade80' : '#f87171',
                      flexShrink: 0, marginLeft: '8px',
                    }}>
                      {p.side === 'long' ? '▲ LONG' : '▼ SHORT'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '14px', marginTop: '10px', fontSize: '0.75rem' }}>
                    <div>
                      <span style={{ color: '#666' }}>Entry </span>
                      <span style={{ fontWeight: 600 }}>{(Number(p.avg_entry_price)*100).toFixed(1)}%</span>
                    </div>
                    <div>
                      <span style={{ color: '#666' }}>Now </span>
                      <span style={{ fontWeight: 600 }}>
                        {p._market?.current_yes_price != null
                          ? `${(Number(p._market.current_yes_price)*100).toFixed(1)}%`
                          : p.current_price != null ? `${(Number(p.current_price)*100).toFixed(1)}%` : '--'}
                      </span>
                    </div>
                    <div>
                      <span style={{ color: '#666' }}>Size </span>
                      <span>${Number(p.size_usd).toFixed(2)}</span>
                    </div>
                  </div>

                  <div style={{ marginTop: '8px', fontSize: '0.85rem', fontWeight: 700 }}>
                    <span style={{ color: pnlColor(unr) }}>{pnlStr(unr)}</span>
                    <span style={{ fontSize: '0.68rem', color: '#555', marginLeft: '6px' }}>
                      ({pct >= 0 ? '+' : ''}{(pct*100).toFixed(1)}%)
                    </span>
                    {rlz !== 0 && (
                      <span style={{ fontSize: '0.72rem', color: pnlColor(rlz), marginLeft: '10px' }}>
                        rlz {pnlStr(rlz)}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '10px', marginTop: '6px', fontSize: '0.68rem', color: '#555' }}>
                    <span>{p.tick_count ?? 0} ticks</span>
                    {p.last_action && <span>last: {p.last_action}</span>}
                    <span>opened {new Date(p.opened_at).toLocaleDateString()}</span>
                  </div>

                  {posTicks.length > 0 && (
                    <div style={{ marginTop: '8px', borderTop: '1px solid #1a1a1a', paddingTop: '6px' }}>
                      {posTicks.slice(0, 5).map((t: any) => (
                        <div key={t.id} style={{ display: 'flex', gap: '8px', fontSize: '0.65rem', color: '#444', marginBottom: '2px' }}>
                          <span style={{ fontWeight: 600, color: t.action === 'hold' ? '#444' : t.action.includes('scale') ? '#60a5fa' : '#f87171' }}>
                            {t.action}
                          </span>
                          <span>{(Number(t.market_price)*100).toFixed(1)}%</span>
                          <span style={{ color: '#3a3a3a' }}>{t.notes?.slice(0, 40)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Closed Positions ── */}
      {closedPos.length > 0 && (
        <section style={{ marginTop: '28px' }}>
          <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: '#ccc', marginBottom: '10px' }}>
            Closed Positions ({closedPos.length})
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  {['Market', 'Side', 'Entry', 'Close Price', 'Realized P&L', 'Return', 'Ticks', 'Duration'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {closedPos.map((p: any) => {
                  const rlz   = Number(p.realized_pnl || 0);
                  const ret   = p.cost_basis_usd > 0 ? rlz / Number(p.cost_basis_usd) : 0;
                  const dur   = p.closed_at
                    ? (() => {
                        const ms = new Date(p.closed_at).getTime() - new Date(p.opened_at).getTime();
                        return ms < 3_600_000 ? `${Math.round(ms/60000)}m`
                          : ms < 86_400_000 ? `${Math.round(ms/3_600_000)}h`
                          : `${Math.round(ms/86_400_000)}d`;
                      })()
                    : '--';
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid #141414' }}>
                      <td style={{ padding: '7px 10px', fontSize: '0.75rem', color: '#999', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p._market?.title ?? p.market_id?.slice(0, 20)}
                      </td>
                      <td style={{ padding: '7px 10px' }}>
                        <span style={{ fontSize: '0.65rem', color: p.side === 'long' ? '#4ade80' : '#f87171' }}>
                          {p.side === 'long' ? '▲' : '▼'} {p.side}
                        </span>
                      </td>
                      <td style={{ padding: '7px 10px', fontSize: '0.75rem', color: '#888' }}>
                        {(Number(p.avg_entry_price)*100).toFixed(1)}%
                      </td>
                      <td style={{ padding: '7px 10px', fontSize: '0.75rem', color: '#888' }}>
                        {p.current_price != null ? `${(Number(p.current_price)*100).toFixed(1)}%` : '--'}
                      </td>
                      <td style={{ padding: '7px 10px', fontSize: '0.82rem', fontWeight: 700, color: pnlColor(rlz) }}>
                        {pnlStr(rlz)}
                      </td>
                      <td style={{ padding: '7px 10px', fontSize: '0.78rem', color: pnlColor(ret) }}>
                        {ret >= 0 ? '+' : ''}{(ret*100).toFixed(1)}%
                      </td>
                      <td style={{ padding: '7px 10px', fontSize: '0.75rem', color: '#888' }}>{p.tick_count ?? 0}</td>
                      <td style={{ padding: '7px 10px', fontSize: '0.72rem', color: '#666' }}>{dur}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Recent Submissions ── */}
      <section style={{ marginTop: '28px' }}>
        <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: '#ccc', marginBottom: '10px' }}>
          Recent Submissions ({submissions.length})
        </h3>
        {submissions.length === 0 ? (
          <p style={{ color: '#555', fontSize: '0.8rem' }}>No submissions yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  {['Time', 'P(Yes)', 'Action', 'Brier', 'Edge', 'Latency', 'Cost', 'Rationale'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {submissions.map((sub: any) => {
                  const sc = scores.find((s: any) => s.submission_id === sub.id);
                  return (
                    <tr key={sub.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                      <td style={{ padding: '6px 10px', color: '#888', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                        {new Date(sub.submitted_at).toLocaleString()}
                      </td>
                      <td style={{ padding: '6px 10px', fontWeight: 700, fontSize: '0.82rem' }}>
                        {(Number(sub.probability_yes) * 100).toFixed(1)}%
                      </td>
                      <td style={{ padding: '6px 10px', fontSize: '0.72rem', color: sub.action?.includes('yes') ? '#4ade80' : sub.action?.includes('no') ? '#f87171' : '#888' }}>
                        {sub.action ?? '--'}
                      </td>
                      <td style={{ padding: '6px 10px', fontSize: '0.78rem' }}>{sc ? Number(sc.brier_score).toFixed(4) : '--'}</td>
                      <td style={{ padding: '6px 10px', fontSize: '0.78rem' }}>
                        {sc ? (
                          <span style={{ color: Number(sc.edge_at_submission) > 0 ? '#4ade80' : '#f87171' }}>
                            {Number(sc.edge_at_submission).toFixed(4)}
                          </span>
                        ) : '--'}
                      </td>
                      <td style={{ padding: '6px 10px', fontSize: '0.72rem', color: '#888' }}>{sub.latency_ms ?? '--'}ms</td>
                      <td style={{ padding: '6px 10px', fontSize: '0.72rem', color: '#888' }}>${Number(sub.cost_usd || 0).toFixed(5)}</td>
                      <td style={{ padding: '6px 10px', fontSize: '0.72rem', color: '#888', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {sub.error_text
                          ? <span style={{ color: '#f87171' }}>{sub.error_text.slice(0, 50)}</span>
                          : (sub.rationale_short ?? '--')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
