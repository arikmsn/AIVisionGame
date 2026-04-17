/**
 * /forecast-arena/players/[slug] — Agent detail
 *
 * Shows: stat cards, position logic explanation, open positions with full tick
 * timeline + auto-generated "position story", closed position history, submissions.
 */

import Link from 'next/link';
import { sfetch } from '@/lib/forecast/db';

export const dynamic = 'force-dynamic';

// ── Helpers ───────────────────────────────────────────────────────────────────

function pnlColor(n: number) { return n > 0 ? '#4ade80' : n < 0 ? '#f87171' : '#888'; }
function pnlStr(n: number)   { return `${n >= 0 ? '+' : ''}$${n.toFixed(2)}`; }
function pct(n: number)      { return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`; }

const ACTION_COLOR: Record<string, string> = {
  hold:        '#444',
  scale_in:    '#4ade80',
  scale_out:   '#60a5fa',
  stop_loss:   '#f87171',
  expiry_exit: '#f59e0b',
  close:       '#a78bfa',
};

/**
 * Generates a plain-English one-sentence summary of a position's lifecycle.
 * e.g. "Entered LONG YES at 42% with $150. Scaled in +$75 at 38%. Trimmed 50% at 55%.
 *       Closed via stop_loss at 22%. Final P&L: −$18.40 (−12.3%)."
 */
function buildPositionStory(pos: any, ticks: any[]): string {
  const side = pos.side === 'long' ? 'LONG YES' : 'SHORT NO';
  const entry = (Number(pos.avg_entry_price) * 100).toFixed(1);
  const cost  = Number(pos.cost_basis_usd).toFixed(2);

  const parts: string[] = [
    `Entered ${side} at ${entry}% with $${cost}.`,
  ];

  for (const t of ticks) {
    const mp = (Number(t.market_price) * 100).toFixed(1);
    if (t.action === 'scale_in') {
      const delta = t.size_delta_usd ? `+$${Number(t.size_delta_usd).toFixed(2)}` : '';
      parts.push(`Scaled in ${delta} at ${mp}% (tick ${t.tick_number}).`);
    } else if (t.action === 'scale_out') {
      const rlz = t.realized_pnl ? `, realized ${pnlStr(Number(t.realized_pnl))}` : '';
      parts.push(`Trimmed 50% at ${mp}%${rlz} (tick ${t.tick_number}).`);
    } else if (t.action === 'stop_loss') {
      parts.push(`Stop-loss triggered at ${mp}% (tick ${t.tick_number}).`);
    } else if (t.action === 'expiry_exit') {
      parts.push(`Exited before market expiry at ${mp}% (tick ${t.tick_number}).`);
    }
  }

  const totalPnl = Number(pos.realized_pnl || 0) +
    (pos.status === 'open' ? Number(pos.unrealized_pnl || 0) : 0);
  const retPct = pos.cost_basis_usd > 0 ? totalPnl / Number(pos.cost_basis_usd) : 0;

  if (pos.status === 'closed') {
    parts.push(`Final P&L: ${pnlStr(totalPnl)} (${pct(retPct)}).`);
  } else {
    parts.push(`Still open — unrealized ${pnlStr(totalPnl)} (${pct(retPct)}).`);
  }

  return parts.join(' ');
}

const thStyle: React.CSSProperties = {
  padding: '6px 10px', textAlign: 'left', color: '#555',
  fontWeight: 500, whiteSpace: 'nowrap', fontSize: '0.68rem',
  letterSpacing: '0.04em', textTransform: 'uppercase', borderBottom: '1px solid #222',
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function PlayerDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let agent:       any   = null;
  let submissions: any[] = [];
  let scores:      any[] = [];
  let wallet:      any   = null;
  let positions:   any[] = [];
  let ticks:       any[] = [];

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

      if (positions.length > 0) {
        const posIds = positions.map((p: any) => p.id).join(',');
        ticks = await sfetch(
          `fa_position_ticks?position_id=in.(${posIds})&select=*&order=created_at.asc`,
        ).then((r: any) => Array.isArray(r) ? r : []).catch(() => []);

        // Enrich with market titles and current price
        const marketIds = [...new Set(positions.map((p: any) => p.market_id))];
        if (marketIds.length > 0) {
          const markets = await sfetch(
            `fa_markets?id=in.(${marketIds.join(',')})&select=id,title,current_yes_price,close_time`,
          ).then((r: any) => Array.isArray(r) ? r : []).catch(() => []);
          const marketMap = new Map(markets.map((m: any) => [m.id, m]));
          for (const p of positions) {
            p._market = marketMap.get(p.market_id);
          }
        }
      }
    }
  } catch { /* ok */ }

  if (!agent) return <p style={{ color: '#888' }}>Agent not found.</p>;

  const totalCost = submissions.reduce((s: number, sub: any) => s + (Number(sub.cost_usd) || 0), 0);
  const totalToks = submissions.reduce((s: number, sub: any) =>
    s + (Number(sub.input_tokens) || 0) + (Number(sub.output_tokens) || 0), 0);
  const avgLat    = submissions.length > 0
    ? Math.round(submissions.reduce((s: number, sub: any) => s + (Number(sub.latency_ms) || 0), 0) / submissions.length)
    : 0;
  const errCount  = submissions.filter((s: any) => s.error_text).length;
  const avgBrier  = scores.length > 0
    ? scores.reduce((s: number, sc: any) => s + (Number(sc.brier_score) || 0), 0) / scores.length : null;
  const avgEdge   = scores.length > 0
    ? scores.reduce((s: number, sc: any) => s + (Number(sc.edge_at_submission) || 0), 0) / scores.length : null;

  const openPos   = positions.filter((p: any) => p.status === 'open');
  const closedPos = positions.filter((p: any) => p.status === 'closed');
  const totalUnr  = openPos.reduce((s: number, p: any) => s + Number(p.unrealized_pnl || 0), 0);
  const totalRlz  = positions.reduce((s: number, p: any) => s + Number(p.realized_pnl || 0), 0);

  const ticksByPos = new Map<string, any[]>();
  for (const t of ticks) {
    if (!ticksByPos.has(t.position_id)) ticksByPos.set(t.position_id, []);
    ticksByPos.get(t.position_id)!.push(t);
  }

  return (
    <div>
      <Link href="/forecast-arena/players" style={{ color: '#666', textDecoration: 'none', fontSize: '0.75rem' }}>
        &larr; Players
      </Link>

      <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginTop: '12px', color: '#f0f0f0' }}>
        {agent.display_name}
      </h2>
      <p style={{ fontSize: '0.78rem', color: '#666', marginTop: '4px' }}>
        {agent.model_id} · {agent.provider}
        {agent.prompt_version ? ` · ${agent.prompt_version}` : ''}
        {agent.strategy_profile_json?.strategy ? ` · Strategy: ${agent.strategy_profile_json.strategy}` : ''}
      </p>

      {/* ── Stat cards ── */}
      <div style={{ display: 'flex', gap: '10px', marginTop: '16px', flexWrap: 'wrap' }}>
        {[
          { label: 'Submissions',    value: String(submissions.length),  sub: errCount > 0 ? `${errCount} errors` : undefined, subColor: '#f87171' },
          { label: 'Avg Brier',      value: avgBrier != null ? avgBrier.toFixed(4) : '--', sub: 'lower is better' },
          { label: 'Avg Edge',       value: avgEdge != null ? `${avgEdge > 0 ? '+' : ''}${avgEdge.toFixed(4)}` : '--', valueColor: avgEdge != null ? pnlColor(avgEdge) : '#f0f0f0' },
          { label: 'Total LLM Cost', value: `$${totalCost.toFixed(4)}` },
          { label: 'Avg Latency',    value: `${avgLat}ms` },
          { label: 'Open Positions', value: String(openPos.length), sub: totalUnr !== 0 ? `${pnlStr(totalUnr)} unrealized` : undefined, subColor: pnlColor(totalUnr) },
          { label: 'Total Realized', value: pnlStr(totalRlz), valueColor: pnlColor(totalRlz) },
          ...(wallet ? [{ label: 'Paper Balance', value: `$${Number(wallet.paper_balance_usd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }] : []),
        ].map(card => (
          <div key={card.label} style={{ background: '#111', border: '1px solid #222', borderRadius: '6px', padding: '12px 16px', minWidth: '120px' }}>
            <div style={{ color: '#555', fontSize: '0.63rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{card.label}</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '4px', color: card.valueColor ?? '#f0f0f0' }}>{card.value}</div>
            {card.sub && <div style={{ fontSize: '0.63rem', color: card.subColor ?? '#666', marginTop: '2px' }}>{card.sub}</div>}
          </div>
        ))}
      </div>

      {/* ── How this agent manages positions ── */}
      <section style={{
        marginTop: '24px',
        padding: '14px 18px',
        background: '#080808',
        border: '1px solid #1a1a1a',
        borderRadius: '6px',
      }}>
        <h3 style={{ fontSize: '0.72rem', fontWeight: 600, color: '#444', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '10px' }}>
          How this agent manages positions
        </h3>
        <p style={{ fontSize: '0.75rem', color: '#555', lineHeight: 1.8, marginBottom: '8px' }}>
          <strong style={{ color: '#666' }}>Initial entry (LLM, once per round):</strong>{' '}
          After submitting a forecast, a position is opened if the agent&apos;s probability diverges
          from the Polymarket price by ≥ 10 percentage points. Position size = 2% of wallet,
          capped at $200. LONG if agent thinks market is underpriced; SHORT if overpriced.
        </p>
        <p style={{ fontSize: '0.75rem', color: '#555', lineHeight: 1.8, marginBottom: '4px' }}>
          <strong style={{ color: '#666' }}>Ongoing management (rule-based, no LLM):</strong>{' '}
          Each tick evaluates the position in this priority order:
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '6px', marginTop: '8px' }}>
          {[
            { action: 'expiry_exit', rule: 'Market closes within 24 h → close fully' },
            { action: 'stop_loss',   rule: 'Unrealized loss ≥ 20% of cost → close fully' },
            { action: 'scale_out',   rule: 'Unrealized gain ≥ 15% of cost, no prior trim → sell 50%' },
            { action: 'scale_in',    rule: 'Edge ≥ 8%, tick ≤ 3, no prior add → buy 50% more' },
            { action: 'hold',        rule: 'None of the above → hold, update P&L' },
          ].map(({ action, rule }) => (
            <div key={action} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '0.7rem' }}>
              <span style={{ color: ACTION_COLOR[action], fontWeight: 700, minWidth: '80px', fontFamily: 'monospace' }}>{action}</span>
              <span style={{ color: '#444' }}>{rule}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Open Positions ── */}
      {openPos.length > 0 && (
        <section style={{ marginTop: '28px' }}>
          <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: '#ccc', marginBottom: '12px' }}>
            Open Positions ({openPos.length})
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {openPos.map((p: any) => {
              const unr      = Number(p.unrealized_pnl || 0);
              const rlz      = Number(p.realized_pnl   || 0);
              const retPct   = p.cost_basis_usd > 0 ? (unr + rlz) / Number(p.cost_basis_usd) : 0;
              const posTicks = ticksByPos.get(p.id) ?? [];
              const story    = buildPositionStory(p, posTicks);
              const curPrice = p._market?.current_yes_price != null
                ? Number(p._market.current_yes_price)
                : p.current_price != null ? Number(p.current_price) : null;

              return (
                <div key={p.id} style={{ background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: '6px', padding: '16px 18px' }}>
                  {/* Header */}
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '6px' }}>
                    <span style={{
                      fontSize: '0.63rem', fontWeight: 700, padding: '2px 6px', borderRadius: '3px',
                      background: p.side === 'long' ? '#1a2e1a' : '#2e1a1a',
                      color:      p.side === 'long' ? '#4ade80' : '#f87171',
                    }}>
                      {p.side === 'long' ? '▲ LONG' : '▼ SHORT'}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: '#bbb', flex: 1 }}>
                      {p._market?.title ?? p.market_id?.slice(0, 40)}
                    </span>
                    <span style={{ fontSize: '0.88rem', fontWeight: 700, color: pnlColor(unr + rlz) }}>
                      {pnlStr(unr + rlz)}
                      <span style={{ fontSize: '0.65rem', color: '#444', marginLeft: '4px' }}>({pct(retPct)})</span>
                    </span>
                  </div>

                  {/* Metrics row */}
                  <div style={{ display: 'flex', gap: '18px', fontSize: '0.72rem', color: '#666', marginBottom: '12px', flexWrap: 'wrap' }}>
                    <span>Entry <strong style={{ color: '#aaa' }}>{(Number(p.avg_entry_price)*100).toFixed(1)}%</strong></span>
                    <span>Current <strong style={{ color: curPrice != null ? (p.side === 'long' ? pnlColor(curPrice - Number(p.avg_entry_price)) : pnlColor(Number(p.avg_entry_price) - curPrice)) : '#aaa' }}>
                      {curPrice != null ? `${(curPrice*100).toFixed(1)}%` : '--'}
                    </strong></span>
                    <span>Size <strong style={{ color: '#aaa' }}>${Number(p.cost_basis_usd).toFixed(2)}</strong></span>
                    <span>Contracts <strong style={{ color: '#aaa' }}>{Number(p.contracts).toFixed(4)}</strong></span>
                    <span>Ticks <strong style={{ color: '#aaa' }}>{p.tick_count ?? 0}</strong></span>
                    {rlz !== 0 && <span>Realized <strong style={{ color: pnlColor(rlz) }}>{pnlStr(rlz)}</strong></span>}
                    <span>Opened <strong style={{ color: '#888' }}>{new Date(p.opened_at).toLocaleDateString()}</strong></span>
                  </div>

                  {/* Position story */}
                  <div style={{
                    fontSize: '0.7rem', color: '#555', fontStyle: 'italic',
                    padding: '8px 12px', background: '#060606',
                    borderLeft: '2px solid #2a2a2a', borderRadius: '0 4px 4px 0',
                    marginBottom: '12px', lineHeight: 1.7,
                  }}>
                    {story}
                  </div>

                  {/* Tick timeline: t0=entry, t1..tn=ticks */}
                  <div style={{ overflowX: 'auto' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, minWidth: 'max-content' }}>
                      {/* t0: entry */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '80px' }}>
                        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#4ade80', marginTop: '2px' }} />
                        <div style={{ fontSize: '0.6rem', color: '#555', marginTop: '4px', textAlign: 'center', lineHeight: 1.4 }}>
                          <span style={{ color: '#4ade80', fontWeight: 700 }}>ENTRY</span><br />
                          {(Number(p.avg_entry_price)*100).toFixed(1)}%<br />
                          ${Number(p.cost_basis_usd).toFixed(0)}
                        </div>
                      </div>
                      {/* ticks */}
                      {posTicks.map((t: any) => (
                        <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start' }}>
                          <div style={{ width: '28px', height: '2px', background: '#1e1e1e', marginTop: '6px', flexShrink: 0 }} />
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '80px' }}>
                            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: ACTION_COLOR[t.action] ?? '#555', marginTop: '2px' }} />
                            <div style={{ fontSize: '0.6rem', color: '#555', marginTop: '4px', textAlign: 'center', lineHeight: 1.4 }}>
                              <span style={{ color: ACTION_COLOR[t.action] ?? '#555', fontWeight: 700 }}>t{t.tick_number}</span><br />
                              <span style={{ color: ACTION_COLOR[t.action] ?? '#555' }}>{t.action}</span><br />
                              {(Number(t.market_price)*100).toFixed(1)}%<br />
                              {t.size_delta_usd != null && (
                                <span style={{ color: pnlColor(Number(t.size_delta_usd)) }}>
                                  {Number(t.size_delta_usd) > 0 ? '+' : ''}${Math.abs(Number(t.size_delta_usd)).toFixed(0)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {posTicks.length === 0 && (
                    <div style={{ fontSize: '0.65rem', color: '#2a2a2a', marginTop: '4px' }}>
                      No ticks yet — first tick runs at 03:00 UTC.
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {closedPos.map((p: any) => {
              const rlz      = Number(p.realized_pnl || 0);
              const retPct   = p.cost_basis_usd > 0 ? rlz / Number(p.cost_basis_usd) : 0;
              const posTicks = ticksByPos.get(p.id) ?? [];
              const story    = buildPositionStory(p, posTicks);
              const dur      = p.closed_at
                ? (() => {
                    const ms = new Date(p.closed_at).getTime() - new Date(p.opened_at).getTime();
                    return ms < 3_600_000 ? `${Math.round(ms/60000)}m`
                      : ms < 86_400_000 ? `${Math.round(ms/3_600_000)}h`
                      : `${Math.round(ms/86_400_000)}d`;
                  })()
                : '--';

              return (
                <div key={p.id} style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '6px', padding: '12px 16px' }}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '6px' }}>
                    <span style={{ fontSize: '0.63rem', color: p.side === 'long' ? '#4ade80' : '#f87171', fontWeight: 700 }}>
                      {p.side === 'long' ? '▲ LONG' : '▼ SHORT'}
                    </span>
                    <span style={{ fontSize: '0.78rem', color: '#888', flex: 1 }}>
                      {p._market?.title ?? p.market_id?.slice(0, 40)}
                    </span>
                    <span style={{ fontSize: '0.82rem', fontWeight: 700, color: pnlColor(rlz) }}>
                      {pnlStr(rlz)}
                      <span style={{ fontSize: '0.65rem', color: '#444', marginLeft: '4px' }}>({pct(retPct)})</span>
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '16px', fontSize: '0.68rem', color: '#555', marginBottom: '8px', flexWrap: 'wrap' }}>
                    <span>Entry {(Number(p.avg_entry_price)*100).toFixed(1)}%</span>
                    <span>Exit {p.current_price != null ? `${(Number(p.current_price)*100).toFixed(1)}%` : '--'}</span>
                    <span>Size ${Number(p.cost_basis_usd).toFixed(2)}</span>
                    <span>{p.tick_count ?? 0} ticks</span>
                    <span>Duration {dur}</span>
                  </div>
                  <div style={{
                    fontSize: '0.68rem', color: '#444', fontStyle: 'italic',
                    lineHeight: 1.6,
                  }}>
                    {story}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Recent Submissions ── */}
      <section style={{ marginTop: '28px' }}>
        <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: '#ccc', marginBottom: '10px' }}>
          Recent Submissions ({submissions.length})
        </h3>
        {submissions.length === 0 ? (
          <p style={{ color: '#555', fontSize: '0.8rem' }}>
            No submissions yet. Use "Run Round" on the dashboard.
          </p>
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
                      <td style={{ padding: '6px 10px', color: '#666', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                        {new Date(sub.submitted_at).toLocaleString()}
                      </td>
                      <td style={{ padding: '6px 10px', fontWeight: 700, fontSize: '0.82rem' }}>
                        {(Number(sub.probability_yes) * 100).toFixed(1)}%
                      </td>
                      <td style={{ padding: '6px 10px', fontSize: '0.72rem', color: sub.action?.includes('yes') ? '#4ade80' : sub.action?.includes('no') ? '#f87171' : '#888' }}>
                        {sub.action ?? '--'}
                      </td>
                      <td style={{ padding: '6px 10px', fontSize: '0.78rem', color: '#888' }}>{sc ? Number(sc.brier_score).toFixed(4) : '--'}</td>
                      <td style={{ padding: '6px 10px', fontSize: '0.78rem' }}>
                        {sc ? (
                          <span style={{ color: Number(sc.edge_at_submission) > 0 ? '#4ade80' : '#f87171' }}>
                            {Number(sc.edge_at_submission) > 0 ? '+' : ''}{Number(sc.edge_at_submission).toFixed(4)}
                          </span>
                        ) : '--'}
                      </td>
                      <td style={{ padding: '6px 10px', fontSize: '0.72rem', color: '#666' }}>{sub.latency_ms ?? '--'}ms</td>
                      <td style={{ padding: '6px 10px', fontSize: '0.72rem', color: '#666' }}>${Number(sub.cost_usd || 0).toFixed(5)}</td>
                      <td style={{ padding: '6px 10px', fontSize: '0.72rem', color: '#666', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
