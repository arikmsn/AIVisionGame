/**
 * /forecast-arena/dashboard — Investment Control Center
 *
 * Primary operator entry point: bankroll state, open positions,
 * system status, recent decisions.
 */

import Link from 'next/link';
import { sfetch } from '@/lib/forecast/db';
import OperatorActions from '../_components/OperatorActions';

export const dynamic = 'force-dynamic';

// ── Helpers ───────────────────────────────────────────────────────────────────

const $ = (n: number, dec = 2) =>
  `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;

function pnlColor(n: number) { return n > 0 ? '#4ade80' : n < 0 ? '#f87171' : '#9ca3af'; }
function pnlStr(n: number) {
  const s = $(n);
  return n >= 0 ? `+${s}` : `-${s}`;
}
function relTime(iso: string | undefined): string {
  if (!iso) return 'never';
  const ms  = Date.now() - new Date(iso).getTime();
  const m   = Math.floor(ms / 60_000);
  const h   = Math.floor(ms / 3_600_000);
  const d   = Math.floor(ms / 86_400_000);
  if (m < 2)   return 'just now';
  if (m < 90)  return `${m}m ago`;
  if (h < 36)  return `${h}h ago`;
  return `${d}d ago`;
}
function statusColor(iso: string | undefined, warnHours: number, staleHours: number): string {
  if (!iso) return '#f87171';
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < warnHours)  return '#4ade80';
  if (h < staleHours) return '#fbbf24';
  return '#f87171';
}

function KpiCard({
  label, value, sub, color, mono, size = 'normal',
}: {
  label: string; value: string | number; sub?: string;
  color?: string; mono?: boolean; size?: 'normal' | 'large';
}) {
  return (
    <div style={{
      background:   '#0e0e0e',
      border:       '1px solid #1e1e1e',
      borderRadius: '8px',
      padding:      size === 'large' ? '18px 22px' : '14px 18px',
      minWidth:     '130px',
      flex:         '1 1 130px',
    }}>
      <div style={{ fontSize: '0.6rem', color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
        {label}
      </div>
      <div style={{
        fontSize:   size === 'large' ? '1.7rem' : '1.35rem',
        fontWeight: 700,
        color:      color ?? '#e8e8e8',
        fontFamily: mono ? 'monospace' : undefined,
        lineHeight: 1,
      }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '0.62rem', color: '#444', marginTop: '5px' }}>{sub}</div>}
    </div>
  );
}

const TH: React.CSSProperties = {
  padding: '6px 12px', textAlign: 'left', color: '#444',
  fontWeight: 500, fontSize: '0.62rem', letterSpacing: '0.05em',
  textTransform: 'uppercase', borderBottom: '1px solid #1a1a1a',
  whiteSpace: 'nowrap',
};
const TD: React.CSSProperties = { padding: '8px 12px', fontSize: '0.78rem' };

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  let bankroll:        any   = null;
  let openPos:         any[] = [];
  let closedPos:       any[] = [];
  let recentRounds:    any[] = [];
  let tickAudit:       any[] = [];
  let syncJobs:        any[] = [];
  let submissions:     any[] = [];
  let experimentCfg:   any   = null;
  let marketScoreStats: { total: number; selected: number } = { total: 0, selected: 0 };

  // System status timestamps
  let lastScoreAt:      string | undefined;
  let lastContextAt:    string | undefined;
  let lastRoundAt:      string | undefined;
  let lastDailyCycleAt: string | undefined;

  try {
    [bankroll, openPos, closedPos, recentRounds, tickAudit, syncJobs, experimentCfg] = await Promise.all([
      sfetch('fa_central_bankroll?select=*&limit=1').then((r: any) => Array.isArray(r) ? r[0] ?? null : null).catch(() => null),
      sfetch('fa_v_open_positions?select=position_id,agent_display_name,market_title,side,size_usd,cost_basis_usd,avg_entry_price,current_price,unrealized_pnl,realized_pnl,tick_count,last_action,opened_at&order=opened_at.desc').then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
      sfetch('fa_positions?status=eq.closed&select=id,agent_id,market_id,side,cost_basis_usd,realized_pnl,closed_at&order=closed_at.desc&limit=8').then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
      sfetch('fa_v_round_summary?select=round_id,round_number,market_title,market_yes_price_at_open,round_status,submission_count,opened_at&order=opened_at.desc&limit=5').then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
      sfetch('fa_audit_events?event_type=eq.tick_cycle&select=created_at,payload_json&order=created_at.desc&limit=1').then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
      sfetch('fa_sync_jobs?select=status,started_at,records_processed&order=started_at.desc&limit=1').then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
      sfetch('fa_experiment_config?status=eq.active&order=created_at.desc&limit=1').then((r: any) => Array.isArray(r) ? r[0] ?? null : null).catch(() => null),
    ]);

    // System status: last scoring, context, round, daily cycle
    const [scoreRow, contextRow, dailyCycleRow] = await Promise.all([
      sfetch('fa_market_scores?select=scored_at&order=scored_at.desc&limit=1')
        .then((r: any) => Array.isArray(r) ? r[0] ?? null : null).catch(() => null),
      sfetch('fa_market_context?select=last_updated_at&order=last_updated_at.desc&limit=1')
        .then((r: any) => Array.isArray(r) ? r[0] ?? null : null).catch(() => null),
      sfetch('fa_audit_events?event_type=eq.daily_cycle&select=created_at&order=created_at.desc&limit=1')
        .then((r: any) => Array.isArray(r) ? r[0] ?? null : null).catch(() => null),
    ]);
    lastScoreAt      = scoreRow?.scored_at;
    lastContextAt    = contextRow?.last_updated_at;
    lastDailyCycleAt = dailyCycleRow?.created_at;
    lastRoundAt      = recentRounds[0]?.opened_at;

    // Market score stats
    const scoreRows = await sfetch('fa_market_scores?select=is_selected').then((r: any) => Array.isArray(r) ? r : []).catch(() => []);
    marketScoreStats = {
      total:    scoreRows.length,
      selected: scoreRows.filter((s: any) => s.is_selected).length,
    };

    // Enrich closed positions with agent + market names
    if (closedPos.length > 0) {
      const agentIds = [...new Set(closedPos.map((p: any) => p.agent_id))].join(',');
      const agents = await sfetch(`fa_agents?id=in.(${agentIds})&select=id,display_name`).then((r: any) => Array.isArray(r) ? r : []).catch(() => []);
      const agentMap = new Map(agents.map((a: any) => [a.id, a.display_name]));
      const marketIds = [...new Set(closedPos.map((p: any) => p.market_id))].join(',');
      const markets = await sfetch(`fa_markets?id=in.(${marketIds})&select=id,title`).then((r: any) => Array.isArray(r) ? r : []).catch(() => []);
      const marketMap = new Map(markets.map((m: any) => [m.id, m.title]));
      closedPos = closedPos.map((p: any) => ({
        ...p,
        agent_display_name: agentMap.get(p.agent_id) ?? '--',
        market_title: marketMap.get(p.market_id) ?? '--',
      }));
    }

    if (recentRounds.length > 0) {
      const roundIds = recentRounds.map((r: any) => r.round_id).join(',');
      submissions = await sfetch(
        `fa_submissions?round_id=in.(${roundIds})&select=round_id,agent_id,probability_yes,action,error_text&order=submitted_at.desc`,
      ).then((r: any) => Array.isArray(r) ? r : []).catch(() => []);
    }
  } catch { /* tables may not exist */ }

  // ── Derived financial state ────────────────────────────────────────────────

  const totalDeposit  = Number(bankroll?.total_deposit_usd   ?? 60000);
  const availableUsd  = Number(bankroll?.available_usd        ?? 60000);
  const allocatedUsd  = Number(bankroll?.allocated_usd        ?? 0);
  const realizedPnl   = Number(bankroll?.total_realized_pnl   ?? 0);
  const unrealizedPnl = openPos.reduce((s: number, p: any) => s + Number(p.unrealized_pnl || 0), 0);
  const netPnl        = realizedPnl + unrealizedPnl;
  const netValue      = totalDeposit + netPnl;
  const allocatedPct  = totalDeposit > 0 ? (allocatedUsd / totalDeposit * 100).toFixed(1) : '0.0';

  const lastTickTime = tickAudit[0]?.created_at;
  const lastSyncTime = syncJobs[0]?.started_at;

  const subsByRound = new Map<string, any[]>();
  for (const s of submissions) {
    if (!subsByRound.has(s.round_id)) subsByRound.set(s.round_id, []);
    subsByRound.get(s.round_id)!.push(s);
  }

  const actionColors: Record<string, string> = {
    strong_yes: '#4ade80', lean_yes: '#86efac', hold: '#9ca3af',
    lean_no: '#fca5a5', strong_no: '#f87171',
  };

  const expDaysAgo = experimentCfg?.starts_at
    ? Math.floor((Date.now() - new Date(experimentCfg.starts_at).getTime()) / 86_400_000)
    : null;

  // ── System status items ────────────────────────────────────────────────────

  const systemItems = [
    {
      label:  'Market Sync',
      time:   lastSyncTime,
      ok:     !!lastSyncTime,
      warn:   12, stale: 48,     // hours
      detail: `${syncJobs[0]?.records_processed ?? 0} records`,
    },
    {
      label:  'Market Scoring',
      time:   lastScoreAt,
      ok:     !!lastScoreAt,
      warn:   12, stale: 48,
      detail: `${marketScoreStats.total} scored, ${marketScoreStats.selected} selected`,
    },
    {
      label:  'News Context',
      time:   lastContextAt,
      ok:     !!lastContextAt,
      warn:   10, stale: 24,
      detail: '',
    },
    {
      label:  'Last Round',
      time:   lastRoundAt,
      ok:     !!lastRoundAt,
      warn:   12, stale: 48,
      detail: '',
    },
    {
      label:  'Last Tick',
      time:   lastTickTime,
      ok:     !!lastTickTime,
      warn:   12, stale: 48,
      detail: `${tickAudit[0]?.payload_json?.processed ?? 0} positions`,
    },
    {
      label:  'Daily Cycle',
      time:   lastDailyCycleAt,
      ok:     !!lastDailyCycleAt,
      warn:   24, stale: 48,
      detail: '06:00 + 18:00 UTC',
    },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>

      {/* ── Experiment KPI Strip ── */}
      {experimentCfg && (
        <section style={{ marginBottom: '20px' }}>
          <div style={{
            display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center',
            padding: '10px 16px', background: '#090909',
            border: '1px solid #1e2a1e', borderRadius: '6px',
            fontSize: '0.72rem',
          }}>
            <span style={{ color: '#d4f25a', fontWeight: 700, fontSize: '0.8rem' }}>
              ◈ {experimentCfg.name}
            </span>
            <span style={{ color: '#555' }}>|</span>
            <span style={{ color: '#888' }}>
              <span style={{ color: '#555' }}>domain: </span>
              <strong style={{ color: '#fbbf24' }}>{experimentCfg.domain}</strong>
            </span>
            {expDaysAgo !== null && (
              <span style={{ color: '#888' }}>
                <span style={{ color: '#555' }}>started: </span>
                <strong>{expDaysAgo}d ago</strong>
              </span>
            )}
            <span style={{ color: '#888' }}>
              <span style={{ color: '#555' }}>monitored: </span>
              <strong>{marketScoreStats.total}</strong>
            </span>
            <span style={{ color: '#888' }}>
              <span style={{ color: '#555' }}>selected: </span>
              <strong style={{ color: '#4ade80' }}>{marketScoreStats.selected}</strong>
            </span>
            <span style={{ color: '#888' }}>
              <span style={{ color: '#555' }}>open positions: </span>
              <strong>{openPos.length}</strong>
            </span>
            <Link href="/forecast-arena/experiment" style={{ marginLeft: 'auto', color: '#444', textDecoration: 'none', fontSize: '0.68rem' }}>
              Full Experiment →
            </Link>
          </div>
        </section>
      )}

      {/* ── Financial Summary Bar ── */}
      <section style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <KpiCard label="Portfolio Value" value={$(netValue)}
            color={netPnl >= 0 ? '#d4f25a' : '#f87171'} size="large"
            sub={`Original deposit: ${$(totalDeposit)}`} />
          <KpiCard label="Available Cash" value={$(availableUsd)}
            color="#e8e8e8" sub={`${(100 - Number(allocatedPct)).toFixed(1)}% of portfolio`} />
          <KpiCard label="Invested Capital" value={$(allocatedUsd)}
            color="#fbbf24" sub={`${allocatedPct}% · ${openPos.length} open positions`} />
          <KpiCard label="Unrealized P&L" value={pnlStr(unrealizedPnl)}
            color={pnlColor(unrealizedPnl)} />
          <KpiCard label="Realized P&L" value={pnlStr(realizedPnl)}
            color={pnlColor(realizedPnl)} />
          <KpiCard label="Net P&L" value={pnlStr(netPnl)}
            color={pnlColor(netPnl)} />
        </div>
      </section>

      {/* ── Operator Actions ── */}
      <OperatorActions />

      {/* ── Open Positions ── */}
      <section style={{ marginBottom: '36px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px' }}>
          <h2 style={{ fontSize: '0.82rem', fontWeight: 600, color: '#888', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Open Positions ({openPos.length})
          </h2>
          <Link href="/forecast-arena/positions" style={{ fontSize: '0.7rem', color: '#555', textDecoration: 'none' }}>
            View all →
          </Link>
        </div>

        {openPos.length === 0 ? (
          <div style={{ padding: '20px', background: '#0e0e0e', border: '1px solid #1a1a1a', borderRadius: '6px', color: '#444', fontSize: '0.8rem', textAlign: 'center' }}>
            No open positions — the daily cycle will open them automatically, or click &ldquo;Run Round&rdquo; to trigger now.
          </div>
        ) : (
          <div style={{ overflowX: 'auto', border: '1px solid #1a1a1a', borderRadius: '6px' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead style={{ background: '#0a0a0a' }}>
                <tr>
                  {['Model', 'Market', 'Side', 'Cost', 'Entry', 'Current', 'Unrealized', 'Realized', 'Ticks', 'Last Action'].map(h => (
                    <th key={h} style={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {openPos.map((p: any) => {
                  const unr  = Number(p.unrealized_pnl || 0);
                  const rlz  = Number(p.realized_pnl   || 0);
                  const pct  = p.cost_basis_usd > 0 ? unr / Number(p.cost_basis_usd) : 0;
                  return (
                    <tr key={p.position_id} style={{ borderBottom: '1px solid #141414' }}>
                      <td style={{ ...TD, fontWeight: 600, color: '#d4f25a' }}>{p.agent_display_name}</td>
                      <td style={{ ...TD, color: '#999', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.market_title}
                      </td>
                      <td style={TD}>
                        <span style={{
                          fontSize: '0.62rem', fontWeight: 700, padding: '2px 7px', borderRadius: '3px',
                          background: p.side === 'long' ? '#162716' : '#271616',
                          color:      p.side === 'long' ? '#4ade80' : '#f87171',
                        }}>
                          {p.side === 'long' ? '▲ LONG' : '▼ SHORT'}
                        </span>
                      </td>
                      <td style={{ ...TD, fontFamily: 'monospace' }}>${Number(p.cost_basis_usd || 0).toFixed(2)}</td>
                      <td style={{ ...TD, color: '#888', fontFamily: 'monospace' }}>
                        {p.avg_entry_price != null ? `${(Number(p.avg_entry_price)*100).toFixed(1)}%` : '--'}
                      </td>
                      <td style={{ ...TD, fontFamily: 'monospace' }}>
                        {p.current_price != null ? `${(Number(p.current_price)*100).toFixed(1)}%` : '--'}
                      </td>
                      <td style={{ ...TD, fontWeight: 700 }}>
                        <span style={{ color: pnlColor(unr) }}>{pnlStr(unr)}</span>
                        <span style={{ color: '#444', fontSize: '0.65rem', marginLeft: '4px' }}>
                          ({pct >= 0 ? '+' : ''}{(pct*100).toFixed(1)}%)
                        </span>
                      </td>
                      <td style={{ ...TD, color: pnlColor(rlz) }}>
                        {rlz !== 0 ? pnlStr(rlz) : <span style={{ color: '#333' }}>—</span>}
                      </td>
                      <td style={{ ...TD, color: '#666' }}>{p.tick_count ?? 0}</td>
                      <td style={{ ...TD, color: '#555' }}>{p.last_action ?? 'open'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Recent Closed Positions ── */}
      {closedPos.length > 0 && (
        <section style={{ marginBottom: '36px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px' }}>
            <h2 style={{ fontSize: '0.82rem', fontWeight: 600, color: '#555', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Recently Closed
            </h2>
            <Link href="/forecast-arena/positions" style={{ fontSize: '0.7rem', color: '#444', textDecoration: 'none' }}>
              View all →
            </Link>
          </div>
          <div style={{ overflowX: 'auto', border: '1px solid #161616', borderRadius: '6px' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead style={{ background: '#090909' }}>
                <tr>
                  {['Model', 'Market', 'Side', 'Cost', 'Realized P&L', 'Closed'].map(h => (
                    <th key={h} style={{ ...TH, color: '#333' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {closedPos.map((p: any) => {
                  const rlz = Number(p.realized_pnl || 0);
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid #111', opacity: 0.75 }}>
                      <td style={{ ...TD, color: '#777', fontSize: '0.75rem' }}>{p.agent_display_name}</td>
                      <td style={{ ...TD, color: '#555', fontSize: '0.73rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.market_title}
                      </td>
                      <td style={TD}>
                        <span style={{
                          fontSize: '0.58rem', fontWeight: 700, padding: '1px 5px', borderRadius: '2px',
                          background: p.side === 'long' ? '#0e1a0e' : '#1a0e0e',
                          color:      p.side === 'long' ? '#2d7a2d' : '#7a2d2d',
                        }}>
                          {p.side === 'long' ? '▲' : '▼'} {p.side?.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ ...TD, color: '#555', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                        ${Number(p.cost_basis_usd || 0).toFixed(2)}
                      </td>
                      <td style={{ ...TD, fontWeight: 600, fontSize: '0.8rem' }}>
                        <span style={{ color: pnlColor(rlz) }}>{pnlStr(rlz)}</span>
                      </td>
                      <td style={{ ...TD, color: '#444', fontSize: '0.7rem' }}>
                        {p.closed_at ? new Date(p.closed_at).toLocaleDateString('en-US') : '--'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Recent Rounds Summary ── */}
      <section style={{ marginBottom: '36px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px' }}>
          <h2 style={{ fontSize: '0.82rem', fontWeight: 600, color: '#555', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Recent Analysis Rounds
          </h2>
          <Link href="/forecast-arena/decisions" style={{ fontSize: '0.7rem', color: '#444', textDecoration: 'none' }}>
            All Decisions →
          </Link>
        </div>

        {recentRounds.length === 0 ? (
          <div style={{ padding: '20px', background: '#0e0e0e', border: '1px solid #1a1a1a', borderRadius: '6px', color: '#444', fontSize: '0.8rem', textAlign: 'center' }}>
            No rounds yet — the daily cycle will create and run them automatically.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {recentRounds.map((round: any) => {
              const subs = subsByRound.get(round.round_id) ?? [];
              return (
                <Link
                  key={round.round_id}
                  href={`/forecast-arena/rounds/${round.round_id}`}
                  style={{ textDecoration: 'none' }}
                >
                  <div style={{
                    background: '#0a0a0a', border: '1px solid #1a1a1a',
                    borderRadius: '6px', padding: '12px 16px',
                    display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap',
                  }}>
                    <div style={{ minWidth: '60px' }}>
                      <div style={{ fontSize: '0.62rem', color: '#444' }}>Round</div>
                      <div style={{ fontFamily: 'monospace', color: '#888', fontWeight: 600 }}>#{round.round_number}</div>
                    </div>
                    <div style={{ flex: 1, minWidth: '200px' }}>
                      <div style={{ fontSize: '0.75rem', color: '#ccc', fontWeight: 500 }}>
                        {round.market_title?.slice(0, 70)}
                      </div>
                      <div style={{ fontSize: '0.63rem', color: '#555', marginTop: '2px' }}>
                        YES at open:{' '}
                        <strong style={{ color: '#888' }}>
                          {round.market_yes_price_at_open != null
                            ? `${(Number(round.market_yes_price_at_open)*100).toFixed(1)}%`
                            : '--'}
                        </strong>
                        {' · '}{subs.length} agent{subs.length !== 1 ? 's' : ''}
                        {' · '}{new Date(round.opened_at).toLocaleDateString('en-US')}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {subs.slice(0, 6).map((s: any, i: number) => (
                        <span key={i} style={{
                          fontSize: '0.58rem', padding: '2px 6px', borderRadius: '3px',
                          background: '#111',
                          color: actionColors[s.action] ?? '#666',
                          fontFamily: 'monospace',
                          border: `1px solid ${actionColors[s.action] ? actionColors[s.action] + '33' : '#1a1a1a'}`,
                        }}>
                          {(Number(s.probability_yes)*100).toFixed(0)}%
                        </span>
                      ))}
                    </div>
                    <div style={{ fontSize: '0.62rem', color: '#333' }}>→</div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* ── System Status ── */}
      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' }}>
          <h2 style={{ fontSize: '0.82rem', fontWeight: 600, color: '#555', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            System Status
          </h2>
          <Link href="/forecast-arena/admin" style={{ fontSize: '0.7rem', color: '#333', textDecoration: 'none' }}>
            System Logs →
          </Link>
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: '8px',
        }}>
          {systemItems.map((item) => {
            const dotColor = item.time
              ? statusColor(item.time, item.warn, item.stale)
              : '#f87171';
            const isHealthy = dotColor === '#4ade80';
            const isWarn    = dotColor === '#fbbf24';
            return (
              <div key={item.label} style={{
                background:   '#0a0a0a',
                border:       `1px solid ${isHealthy ? '#1a2a1a' : isWarn ? '#2a2000' : '#2a1a1a'}`,
                borderRadius: '6px',
                padding:      '10px 14px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontSize: '0.6rem', color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {item.label}
                  </span>
                  <span style={{
                    width: '7px', height: '7px', borderRadius: '50%',
                    background: dotColor,
                    boxShadow: `0 0 5px ${dotColor}66`,
                    flexShrink: 0,
                  }} />
                </div>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: item.time ? '#888' : '#444' }}>
                  {relTime(item.time)}
                </div>
                {item.detail && (
                  <div style={{ fontSize: '0.58rem', color: '#333', marginTop: '3px' }}>{item.detail}</div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: '8px', fontSize: '0.62rem', color: '#2a2a2a', padding: '0 2px' }}>
          Cron schedule: daily-cycle at 06:00 UTC (full cycle) · tick at 18:00 UTC (position management)
        </div>
      </section>

    </div>
  );
}
