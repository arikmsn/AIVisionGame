/**
 * /forecast-arena/rounds/[id] — Round detail with submissions + positions opened
 */

import Link from 'next/link';
import { sfetch } from '@/lib/forecast/db';

export const dynamic = 'force-dynamic';

function pnlColor(n: number) { return n > 0 ? '#4ade80' : n < 0 ? '#f87171' : '#888'; }
function pnlStr(n: number)   { return `${n >= 0 ? '+' : ''}$${n.toFixed(2)}`; }

const thStyle: React.CSSProperties = {
  padding: '6px 10px', textAlign: 'left', color: '#555',
  fontWeight: 500, whiteSpace: 'nowrap', fontSize: '0.65rem',
  letterSpacing: '0.04em', textTransform: 'uppercase', borderBottom: '1px solid #222',
};

export default async function RoundDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let round:       any    = null;
  let market:      any    = null;
  let submissions: any[]  = [];
  let scores:      any[]  = [];
  let agents:      any[]  = [];
  let positions:   any[]  = [];
  let posTicks:    any[]  = [];

  try {
    const roundArr = await sfetch(`fa_rounds?id=eq.${id}&select=*`);
    round = Array.isArray(roundArr) && roundArr[0] ? roundArr[0] : null;

    if (round) {
      [market, submissions, scores, agents, positions] = await Promise.all([
        sfetch(`fa_markets?id=eq.${round.market_id}&select=*`).then((r: any) => Array.isArray(r) ? r[0] ?? null : null),
        sfetch(`fa_submissions?round_id=eq.${id}&select=*&order=probability_yes.desc`).then((r: any) => Array.isArray(r) ? r : []),
        sfetch(`fa_scores?round_id=eq.${id}&select=*`).then((r: any) => Array.isArray(r) ? r : []),
        sfetch('fa_agents?select=id,slug,display_name,model_id,provider').then((r: any) => Array.isArray(r) ? r : []),
        sfetch(`fa_positions?round_id=eq.${id}&select=*&order=opened_at.asc`).then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
      ]);

      if (positions.length > 0) {
        const posIds = positions.map((p: any) => p.id).join(',');
        posTicks = await sfetch(
          `fa_position_ticks?position_id=in.(${posIds})&select=*&order=created_at.asc`,
        ).then((r: any) => Array.isArray(r) ? r : []).catch(() => []);
      }
    }
  } catch { /* ok */ }

  if (!round) {
    return <p style={{ color: '#888' }}>Round not found.</p>;
  }

  const agentMap   = new Map(agents.map((a: any) => [a.id, a]));
  const scoreMap   = new Map(scores.map((s: any) => [s.submission_id, s]));
  const ticksByPos = new Map<string, any[]>();
  for (const t of posTicks) {
    if (!ticksByPos.has(t.position_id)) ticksByPos.set(t.position_id, []);
    ticksByPos.get(t.position_id)!.push(t);
  }

  return (
    <div>
      <Link href="/forecast-arena/rounds" style={{ color: '#666', textDecoration: 'none', fontSize: '0.75rem' }}>
        &larr; Rounds
      </Link>

      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginTop: '12px', color: '#f0f0f0' }}>
        Round {round.round_number}
        <span style={{
          color: round.status === 'open' ? '#4ade80' : round.status === 'resolved' ? '#60a5fa' : '#666',
          fontWeight: 400, marginLeft: '10px', fontSize: '0.85rem',
        }}>
          {round.status}
        </span>
      </h2>

      {market && (
        <p style={{ fontSize: '0.8rem', color: '#888', marginTop: '6px' }}>
          Market:{' '}
          <Link href={`/forecast-arena/markets/${market.id}`} style={{ color: '#d4f25a', textDecoration: 'none' }}>
            {market.title?.slice(0, 80)}
          </Link>
        </p>
      )}

      <div style={{ display: 'flex', gap: '24px', marginTop: '12px', fontSize: '0.8rem', flexWrap: 'wrap' }}>
        <div><span style={{ color: '#555' }}>Market YES at open: </span>
          {round.market_yes_price_at_open != null ? `${(Number(round.market_yes_price_at_open) * 100).toFixed(1)}%` : '--'}</div>
        <div><span style={{ color: '#555' }}>Opened: </span>{new Date(round.opened_at).toLocaleString()}</div>
        {round.resolved_at && <div><span style={{ color: '#555' }}>Resolved: </span>{new Date(round.resolved_at).toLocaleString()}</div>}
        <div><span style={{ color: '#555' }}>Submissions: </span>{submissions.length}</div>
        <div><span style={{ color: '#555' }}>Positions opened: </span>
          <span style={{ color: positions.length > 0 ? '#4ade80' : '#555' }}>{positions.length}</span>
        </div>
      </div>

      {/* ── Positions opened from this round ── */}
      {positions.length > 0 && (
        <section style={{ marginTop: '28px' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '12px', color: '#ccc' }}>
            Positions Opened ({positions.length})
          </h3>
          <p style={{ fontSize: '0.7rem', color: '#444', marginBottom: '12px', lineHeight: 1.6 }}>
            Positions open automatically when an agent's forecast shows ≥ 10% edge vs market price.
            Ongoing management is rule-based (stop-loss / scale-out / scale-in / hold) — no further LLM calls.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {positions.map((p: any) => {
              const agent  = agentMap.get(p.agent_id);
              const ticks  = ticksByPos.get(p.id) ?? [];
              const rlz    = Number(p.realized_pnl   || 0);
              const unr    = Number(p.unrealized_pnl  || 0);
              const totalPnl = rlz + (p.status === 'open' ? unr : 0);
              const ret    = p.cost_basis_usd > 0 ? totalPnl / Number(p.cost_basis_usd) : 0;

              return (
                <div key={p.id} style={{
                  background: '#0d0d0d', border: '1px solid #1e1e1e',
                  borderRadius: '6px', padding: '14px 18px',
                }}>
                  {/* Header row */}
                  <div style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.88rem', color: '#ddd' }}>
                      <Link href={`/forecast-arena/players/${agent?.slug}`} style={{ color: '#ddd', textDecoration: 'none' }}>
                        {agent?.display_name ?? p.agent_id.slice(0, 8)}
                      </Link>
                    </span>
                    <span style={{
                      fontSize: '0.62rem', fontWeight: 700, padding: '2px 6px', borderRadius: '3px',
                      background: p.side === 'long' ? '#1a2e1a' : '#2e1a1a',
                      color:      p.side === 'long' ? '#4ade80' : '#f87171',
                    }}>
                      {p.side === 'long' ? '▲ LONG' : '▼ SHORT'}
                    </span>
                    <span style={{
                      fontSize: '0.62rem', padding: '2px 6px', borderRadius: '3px',
                      background: p.status === 'open' ? '#1a2a1a' : '#1a1a1a',
                      color:      p.status === 'open' ? '#4ade80' : '#555',
                    }}>
                      {p.status}
                    </span>
                    <span style={{ fontSize: '0.73rem', color: '#666' }}>
                      {(Number(p.avg_entry_price) * 100).toFixed(1)}% entry
                    </span>
                    <span style={{ fontSize: '0.73rem', color: '#555' }}>
                      ${Number(p.cost_basis_usd).toFixed(2)} deployed
                    </span>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: pnlColor(totalPnl) }}>
                      {pnlStr(totalPnl)}
                      <span style={{ fontSize: '0.65rem', color: '#444', marginLeft: '4px' }}>
                        ({ret >= 0 ? '+' : ''}{(ret * 100).toFixed(1)}%)
                      </span>
                    </span>
                  </div>

                  {/* Tick log */}
                  {ticks.length > 0 ? (
                    <div style={{
                      marginTop: '6px', padding: '8px 10px',
                      background: '#080808', borderRadius: '3px',
                      fontSize: '0.68rem', lineHeight: 2,
                    }}>
                      <div style={{ color: '#333', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                        Tick history ({ticks.length} ticks)
                      </div>
                      {ticks.map((t: any) => {
                        const actionColor = t.action === 'hold' ? '#444'
                          : t.action === 'scale_in'  ? '#4ade80'
                          : t.action === 'scale_out' ? '#60a5fa'
                          : '#f87171';
                        return (
                          <div key={t.id} style={{ display: 'flex', gap: '12px', color: '#444', flexWrap: 'wrap' }}>
                            <span style={{ fontFamily: 'monospace', minWidth: '150px', color: '#2a2a2a' }}>
                              {new Date(t.created_at).toLocaleString()}
                            </span>
                            <span style={{ color: '#2a2a2a' }}>tick #{t.tick_number}</span>
                            <span style={{ color: actionColor, fontWeight: 600 }}>{t.action}</span>
                            <span style={{ color: '#3a3a3a' }}>mkt {(Number(t.market_price) * 100).toFixed(1)}%</span>
                            {t.size_delta_usd && (
                              <span style={{ color: pnlColor(Number(t.size_delta_usd)) }}>
                                {Number(t.size_delta_usd) > 0 ? '+' : ''}${Number(t.size_delta_usd).toFixed(2)}
                              </span>
                            )}
                            {t.notes && <span style={{ color: '#2e2e2e' }}>{t.notes}</span>}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.65rem', color: '#2a2a2a', marginTop: '4px' }}>
                      No ticks yet — position just opened.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Submissions table ── */}
      <section style={{ marginTop: '28px' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#ccc' }}>
          Submissions ({submissions.length})
        </h3>

        {submissions.length === 0 ? (
          <p style={{ color: '#555', fontSize: '0.8rem' }}>No submissions yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.78rem' }}>
              <thead>
                <tr>
                  {['Agent', 'P(Yes)', 'Confidence', 'Action', 'Brier', 'Edge', 'Position', 'Latency', 'Cost', 'Rationale'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {submissions.map((sub: any) => {
                  const agent    = agentMap.get(sub.agent_id);
                  const score    = scoreMap.get(sub.id);
                  const hasError = !!sub.error_text;
                  // Find position linked to this submission
                  const pos = positions.find((p: any) => p.submission_id === sub.id);

                  return (
                    <tr key={sub.id} style={{ borderBottom: '1px solid #1a1a1a', opacity: hasError ? 0.5 : 1 }}>
                      <td style={{ padding: '6px 10px', fontWeight: 600 }}>
                        {agent ? (
                          <Link href={`/forecast-arena/players/${agent.slug}`} style={{ color: '#d4f25a', textDecoration: 'none' }}>
                            {agent.display_name}
                          </Link>
                        ) : sub.agent_id?.slice(0, 8)}
                      </td>
                      <td style={{ padding: '6px 10px', fontWeight: 700 }}>
                        {(Number(sub.probability_yes) * 100).toFixed(1)}%
                      </td>
                      <td style={{ padding: '6px 10px', color: '#888' }}>
                        {sub.confidence != null ? Number(sub.confidence).toFixed(2) : '--'}
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        <span style={{
                          color: sub.action?.includes('yes') ? '#4ade80'
                            : sub.action?.includes('no') ? '#f87171'
                            : '#888',
                        }}>
                          {sub.action ?? '--'}
                        </span>
                      </td>
                      <td style={{ padding: '6px 10px', color: '#888' }}>
                        {score ? Number(score.brier_score).toFixed(4) : '--'}
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        {score ? (
                          <span style={{ color: Number(score.edge_at_submission) > 0 ? '#4ade80' : '#f87171' }}>
                            {Number(score.edge_at_submission) > 0 ? '+' : ''}{Number(score.edge_at_submission).toFixed(4)}
                          </span>
                        ) : '--'}
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        {pos ? (
                          <span style={{
                            fontSize: '0.62rem', fontWeight: 700, padding: '2px 5px', borderRadius: '3px',
                            background: pos.side === 'long' ? '#1a2e1a' : '#2e1a1a',
                            color:      pos.side === 'long' ? '#4ade80' : '#f87171',
                          }}>
                            {pos.side === 'long' ? '▲' : '▼'} {pos.side}
                          </span>
                        ) : (
                          <span style={{ color: '#333', fontSize: '0.68rem' }}>no position</span>
                        )}
                      </td>
                      <td style={{ padding: '6px 10px', color: '#666' }}>
                        {sub.latency_ms != null ? `${sub.latency_ms}ms` : '--'}
                      </td>
                      <td style={{ padding: '6px 10px', color: '#666' }}>
                        {sub.cost_usd != null ? `$${Number(sub.cost_usd).toFixed(5)}` : '--'}
                      </td>
                      <td style={{ padding: '6px 10px', color: '#666', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {hasError
                          ? <span style={{ color: '#f87171' }}>{sub.error_text?.slice(0, 60)}</span>
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
