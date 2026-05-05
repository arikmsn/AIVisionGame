/**
 * /forecast-arena/dashboard — Operator Console
 *
 * Primary operator entry point: portfolio state, active positions,
 * system health, recent activity, and quick controls.
 */

import Link from 'next/link';
import { sfetch } from '@/lib/forecast/db';
import OperatorActions from '../_components/OperatorActions';
import { LegacyBanner } from '../_components/LegacyBanner';

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
  const ms = Date.now() - new Date(iso).getTime();
  const m  = Math.floor(ms / 60_000);
  const h  = Math.floor(ms / 3_600_000);
  const d  = Math.floor(ms / 86_400_000);
  if (m < 2)  return 'just now';
  if (m < 90) return `${m}m ago`;
  if (h < 36) return `${h}h ago`;
  return `${d}d ago`;
}
function statusColor(iso: string | undefined, warnHours: number, staleHours: number): string {
  if (!iso) return '#f87171';
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < warnHours)  return '#4ade80';
  if (h < staleHours) return '#fbbf24';
  return '#f87171';
}
function positionAge(openedAt: string | undefined): { hours: number; label: string; color: string; badge: string } {
  if (!openedAt) return { hours: 0, label: '--', color: '#555', badge: '' };
  const h = (Date.now() - new Date(openedAt).getTime()) / 3_600_000;
  if (h < 4)   return { hours: h, label: relTime(openedAt), color: '#4ade80',  badge: 'fresh' };
  if (h < 24)  return { hours: h, label: relTime(openedAt), color: '#86efac',  badge: '' };
  if (h < 72)  return { hours: h, label: relTime(openedAt), color: '#fbbf24',  badge: 'aging' };
  return            { hours: h, label: relTime(openedAt), color: '#f87171',  badge: 'stale' };
}

// Map experiment name from DB to operational label
function strategyLabel(domain: string, name: string): string {
  if (domain === 'sports') return 'Active Strategy: Sports Markets';
  if (domain) return `Active Strategy: ${domain.charAt(0).toUpperCase() + domain.slice(1)} Markets`;
  return name;
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
      <div style={{ fontSize: '0.58rem', color: '#444', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '6px' }}>
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
      {sub && <div style={{ fontSize: '0.6rem', color: '#3d3d3d', marginTop: '5px' }}>{sub}</div>}
    </div>
  );
}

const TH: React.CSSProperties = {
  padding: '6px 12px', textAlign: 'left', color: '#3a3a3a',
  fontWeight: 500, fontSize: '0.6rem', letterSpacing: '0.05em',
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
  let activeMarketsCount = 0;

  // System status timestamps
  let lastScoreAt:       string | undefined;
  let lastContextAt:     string | undefined;
  let lastRoundAt:       string | undefined;
  let lastDailyCycleAt:  string | undefined;
  let lastLightCycleAt:  string | undefined;
  let lightCyclesToday   = 0;
  let lightCyclePaused   = false;
  let lastPositionOpenedAt: string | undefined;

  try {
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    const todayIso = todayUtc.toISOString();

    [bankroll, openPos, closedPos, recentRounds, tickAudit, syncJobs, experimentCfg] = await Promise.all([
      sfetch('fa_central_bankroll?select=*&limit=1').then((r: any) => Array.isArray(r) ? r[0] ?? null : null).catch(() => null),
      sfetch('fa_v_open_positions?select=position_id,agent_display_name,market_title,side,size_usd,cost_basis_usd,avg_entry_price,current_price,unrealized_pnl,realized_pnl,tick_count,last_action,opened_at&order=opened_at.desc').then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
      sfetch('fa_positions?status=eq.closed&select=id,agent_id,market_id,side,cost_basis_usd,realized_pnl,closed_at&order=closed_at.desc&limit=6').then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
      sfetch('fa_v_round_summary?select=round_id,round_number,market_title,market_yes_price_at_open,round_status,submission_count,opened_at&order=opened_at.desc&limit=5').then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
      sfetch('fa_audit_events?event_type=eq.tick_cycle&select=created_at,payload_json&order=created_at.desc&limit=1').then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
      sfetch('fa_sync_jobs?select=status,started_at,records_processed&order=started_at.desc&limit=1').then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
      sfetch('fa_experiment_config?status=eq.active&select=*&order=created_at.desc&limit=1').then((r: any) => Array.isArray(r) ? r[0] ?? null : null).catch(() => null),
    ]);

    // System status timestamps + active market count
    const [scoreRow, contextRow, dailyCycleRow, lightCycleRow,
      lightCycleTodayRows, lightCyclePausedRow, activeMarketsRow, lastPosRow] = await Promise.all([
      sfetch('fa_market_scores?select=scored_at&order=scored_at.desc&limit=1')
        .then((r: any) => Array.isArray(r) ? r[0] ?? null : null).catch(() => null),
      sfetch('fa_market_context?select=last_updated_at&order=last_updated_at.desc&limit=1')
        .then((r: any) => Array.isArray(r) ? r[0] ?? null : null).catch(() => null),
      sfetch('fa_audit_events?event_type=eq.daily_cycle&select=created_at&order=created_at.desc&limit=1')
        .then((r: any) => Array.isArray(r) ? r[0] ?? null : null).catch(() => null),
      sfetch('fa_audit_events?event_type=eq.light_cycle&select=created_at,payload_json&order=created_at.desc&limit=1')
        .then((r: any) => Array.isArray(r) ? r[0] ?? null : null).catch(() => null),
      sfetch(`fa_audit_events?event_type=eq.light_cycle&created_at=gte.${todayIso}&select=id`)
        .then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
      sfetch(`fa_audit_events?event_type=eq.light_cycle_paused&created_at=gte.${todayIso}&select=created_at&order=created_at.desc&limit=1`)
        .then((r: any) => Array.isArray(r) ? r[0] ?? null : null).catch(() => null),
      sfetch('fa_markets?select=id&status=eq.active')
        .then((r: any) => Array.isArray(r) ? r.length : 0).catch(() => 0),
      sfetch('fa_positions?status=eq.open&select=opened_at&order=opened_at.desc&limit=1')
        .then((r: any) => Array.isArray(r) ? r[0] ?? null : null).catch(() => null),
    ]);

    lastScoreAt         = scoreRow?.scored_at;
    lastContextAt       = contextRow?.last_updated_at;
    lastDailyCycleAt    = dailyCycleRow?.created_at;
    lastLightCycleAt    = lightCycleRow?.created_at;
    lightCyclesToday    = lightCycleTodayRows.length;
    lightCyclePaused    = !!lightCyclePausedRow;
    activeMarketsCount  = activeMarketsRow;
    lastPositionOpenedAt = lastPosRow?.opened_at;
    lastRoundAt         = recentRounds[0]?.opened_at;

    // Score stats
    const scoreRows = await sfetch('fa_market_scores?select=is_selected').then((r: any) => Array.isArray(r) ? r : []).catch(() => []);
    marketScoreStats = {
      total:    scoreRows.length,
      selected: scoreRows.filter((s: any) => s.is_selected).length,
    };

    // Enrich closed positions
    if (closedPos.length > 0) {
      const agentIds  = [...new Set(closedPos.map((p: any) => p.agent_id))].join(',');
      const agents    = await sfetch(`fa_agents?id=in.(${agentIds})&select=id,display_name`).then((r: any) => Array.isArray(r) ? r : []).catch(() => []);
      const agentMap  = new Map(agents.map((a: any) => [a.id, a.display_name]));
      const marketIds = [...new Set(closedPos.map((p: any) => p.market_id))].join(',');
      const markets   = await sfetch(`fa_markets?id=in.(${marketIds})&select=id,title`).then((r: any) => Array.isArray(r) ? r : []).catch(() => []);
      const marketMap = new Map(markets.map((m: any) => [m.id, m.title]));
      closedPos = closedPos.map((p: any) => ({
        ...p,
        agent_display_name: agentMap.get(p.agent_id) ?? '--',
        market_title:       marketMap.get(p.market_id) ?? '--',
      }));
    }

    if (recentRounds.length > 0) {
      const roundIds = recentRounds.map((r: any) => r.round_id).join(',');
      submissions = await sfetch(
        `fa_submissions?round_id=in.(${roundIds})&select=round_id,agent_id,probability_yes,action,error_text&order=submitted_at.desc`,
      ).then((r: any) => Array.isArray(r) ? r : []).catch(() => []);
    }
  } catch { /* tables may not exist yet */ }

  // ── Derived financial state ────────────────────────────────────────────────

  const totalDeposit  = Number(bankroll?.total_deposit_usd  ?? 60000);
  const availableUsd  = Number(bankroll?.available_usd       ?? 60000);
  const allocatedUsd  = Number(bankroll?.allocated_usd       ?? 0);
  const realizedPnl   = Number(bankroll?.total_realized_pnl  ?? 0);
  const unrealizedPnl = openPos.reduce((s: number, p: any) => s + Number(p.unrealized_pnl || 0), 0);
  const netPnl        = realizedPnl + unrealizedPnl;
  const netValue      = totalDeposit + netPnl;
  const allocatedPct  = totalDeposit > 0 ? (allocatedUsd / totalDeposit * 100).toFixed(1) : '0.0';

  const lastTickTime    = tickAudit[0]?.created_at;
  const lastSyncTime    = syncJobs[0]?.started_at;
  const tickIntervalMin = Number(experimentCfg?.tick_interval_minutes    ?? 15);
  const maxLightCycles  = Number(experimentCfg?.max_light_cycles_per_day ?? 6);

  const expDaysAgo = experimentCfg?.starts_at
    ? Math.floor((Date.now() - new Date(experimentCfg.starts_at).getTime()) / 86_400_000)
    : null;
  const expStartDate = experimentCfg?.starts_at
    ? new Date(experimentCfg.starts_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  const subsByRound = new Map<string, any[]>();
  for (const s of submissions) {
    if (!subsByRound.has(s.round_id)) subsByRound.set(s.round_id, []);
    subsByRound.get(s.round_id)!.push(s);
  }

  const actionColors: Record<string, string> = {
    strong_yes: '#4ade80', lean_yes: '#86efac', hold: '#9ca3af',
    lean_no: '#fca5a5', strong_no: '#f87171',
  };

  // Activity context: when was the last new trade vs last eval
  const lastEvalAge  = lastRoundAt ? (Date.now() - new Date(lastRoundAt).getTime()) / 3_600_000 : null;
  const lastPosAge   = lastPositionOpenedAt ? (Date.now() - new Date(lastPositionOpenedAt).getTime()) / 3_600_000 : null;
  const noRecentActivity = lastEvalAge !== null && lastEvalAge > 6;

  // System status items
  const tickWarnH  = (tickIntervalMin * 2) / 60;
  const tickStaleH = (tickIntervalMin * 6) / 60;

  const systemItems = [
    {
      label:  `Tick · every ${tickIntervalMin}m`,
      time:   lastTickTime,
      warn:   tickWarnH,  stale: tickStaleH,
      detail: `${tickAudit[0]?.payload_json?.processed ?? 0} positions managed`,
      paused: false,
    },
    {
      label:  `Light Cycle · ${lightCyclesToday}/${maxLightCycles} today`,
      time:   lastLightCycleAt,
      warn:   5,  stale: 10,
      detail: lightCyclePaused ? '⚠ paused — daily limit reached' : 'sync → score → rounds if price moved',
      paused: lightCyclePaused,
    },
    {
      label:  'Daily Cycle · 06:00 UTC',
      time:   lastDailyCycleAt,
      warn:   24, stale: 48,
      detail: 'full refresh: sync → score → news → rounds → tick',
      paused: false,
    },
    {
      label:  'Market Scoring',
      time:   lastScoreAt,
      warn:   5,  stale: 12,
      detail: marketScoreStats.total > 0
        ? `${marketScoreStats.total} scored · ${marketScoreStats.selected} selected`
        : `${activeMarketsCount} markets tracked · score not yet run`,
      paused: false,
    },
    {
      label:  'News Context',
      time:   lastContextAt,
      warn:   10, stale: 26,
      detail: 'refreshed by daily cycle',
      paused: false,
    },
    {
      label:  'Last Evaluation',
      time:   lastRoundAt,
      warn:   12, stale: 48,
      detail: recentRounds.length > 0 ? `${recentRounds[0]?.market_title?.slice(0, 40)}` : '',
      paused: false,
    },
  ] as Array<{
    label: string; time: string | undefined; warn: number; stale: number; detail: string; paused: boolean;
  }>;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>

      <LegacyBanner pageName="Dashboard" />

      {/* ── Strategy Context Strip ── */}
      {experimentCfg && (
        <section style={{ marginBottom: '20px' }}>
          <div style={{
            display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center',
            padding: '10px 16px', background: '#090909',
            border: '1px solid #1a2214', borderRadius: '6px',
            fontSize: '0.72rem',
          }}>
            <span style={{ color: '#d4f25a', fontWeight: 700, fontSize: '0.78rem', letterSpacing: '0.01em' }}>
              {strategyLabel(experimentCfg.domain, experimentCfg.name)}
            </span>
            <span style={{ color: '#222' }}>|</span>
            <span style={{ color: '#555' }}>
              <span style={{ color: '#333' }}>since </span>
              <strong style={{ color: '#666' }}>{expStartDate ?? `${expDaysAgo}d ago`}</strong>
            </span>
            <span style={{ color: '#555' }}>
              <span style={{ color: '#333' }}>tracking </span>
              <strong style={{ color: '#888' }}>{activeMarketsCount}</strong>
              <span style={{ color: '#333' }}> markets</span>
            </span>
            {marketScoreStats.selected > 0 && (
              <span style={{ color: '#555' }}>
                <span style={{ color: '#333' }}>selected </span>
                <strong style={{ color: '#4ade80' }}>{marketScoreStats.selected}</strong>
              </span>
            )}
            <span style={{ color: '#555' }}>
              <span style={{ color: '#333' }}>open positions </span>
              <strong style={{ color: openPos.length > 0 ? '#fbbf24' : '#555' }}>{openPos.length}</strong>
            </span>
            <Link href="/forecast-arena/experiment" style={{ marginLeft: 'auto', color: '#333', textDecoration: 'none', fontSize: '0.65rem' }}>
              Strategy →
            </Link>
          </div>
        </section>
      )}

      {/* ── Portfolio KPIs ── */}
      <section style={{ marginBottom: '28px' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <KpiCard label="Portfolio Value" value={$(netValue)}
            color={netPnl >= 0 ? '#d4f25a' : '#f87171'} size="large"
            sub={`Original deposit: ${$(totalDeposit)}`} />
          <KpiCard label="Available Cash" value={$(availableUsd)}
            color="#e8e8e8" sub={`${(100 - Number(allocatedPct)).toFixed(1)}% idle`} />
          <KpiCard label="Deployed Capital" value={$(allocatedUsd)}
            color="#fbbf24" sub={`${allocatedPct}% · ${openPos.length} position${openPos.length !== 1 ? 's' : ''}`} />
          <KpiCard label="Unrealized P&L" value={pnlStr(unrealizedPnl)} color={pnlColor(unrealizedPnl)} />
          <KpiCard label="Realized P&L"   value={pnlStr(realizedPnl)}   color={pnlColor(realizedPnl)}   />
          <KpiCard label="Net P&L"        value={pnlStr(netPnl)}        color={pnlColor(netPnl)}        />
        </div>
      </section>

      {/* ── Open Positions ── */}
      <section style={{ marginBottom: '36px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
          <h2 style={{ fontSize: '0.78rem', fontWeight: 600, color: '#888', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Open Positions ({openPos.length})
          </h2>
          <Link href="/forecast-arena/positions" style={{ fontSize: '0.68rem', color: '#444', textDecoration: 'none' }}>
            All positions →
          </Link>
        </div>

        {/* Activity context — only show when things are quiet */}
        {noRecentActivity && (
          <div style={{
            padding: '8px 14px', marginBottom: '10px',
            background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: '5px',
            fontSize: '0.68rem', color: '#444',
            display: 'flex', gap: '16px', flexWrap: 'wrap',
          }}>
            {lastEvalAge !== null && (
              <span>
                Last evaluation:{' '}
                <strong style={{ color: '#555' }}>{relTime(lastRoundAt)}</strong>
              </span>
            )}
            {lastPosAge !== null && lastEvalAge !== null && lastPosAge > lastEvalAge + 1 && (
              <span style={{ color: '#3a3a3a' }}>
                System evaluated markets — no new positions opened (insufficient edge)
              </span>
            )}
            {lastPosAge !== null && (
              <span>
                Last new position:{' '}
                <strong style={{ color: '#555' }}>{relTime(lastPositionOpenedAt)}</strong>
              </span>
            )}
          </div>
        )}

        {openPos.length === 0 ? (
          <div style={{
            padding: '24px', background: '#0e0e0e',
            border: '1px solid #1a1a1a', borderRadius: '6px',
            color: '#3a3a3a', fontSize: '0.78rem', textAlign: 'center',
          }}>
            {lastRoundAt
              ? `No open positions. Last evaluation was ${relTime(lastRoundAt)} — no qualifying edge found.`
              : 'No open positions. The daily cycle will evaluate markets and open positions automatically.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto', border: '1px solid #1a1a1a', borderRadius: '6px' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead style={{ background: '#0a0a0a' }}>
                <tr>
                  {['Model', 'Market', 'Side', 'Cost', 'Entry', 'Current', 'Unrealized', 'Ticks', 'Opened'].map(h => (
                    <th key={h} style={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {openPos.map((p: any) => {
                  const unr = Number(p.unrealized_pnl || 0);
                  const pct = p.cost_basis_usd > 0 ? unr / Number(p.cost_basis_usd) : 0;
                  const age = positionAge(p.opened_at);
                  return (
                    <tr key={p.position_id} style={{ borderBottom: '1px solid #141414' }}>
                      <td style={{ ...TD, fontWeight: 600, color: '#d4f25a' }}>{p.agent_display_name}</td>
                      <td style={{ ...TD, color: '#888', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.market_title}
                      </td>
                      <td style={TD}>
                        <span style={{
                          fontSize: '0.6rem', fontWeight: 700, padding: '2px 6px', borderRadius: '3px',
                          background: p.side === 'long' ? '#162716' : '#271616',
                          color:      p.side === 'long' ? '#4ade80' : '#f87171',
                        }}>
                          {p.side === 'long' ? '▲ LONG' : '▼ SHORT'}
                        </span>
                      </td>
                      <td style={{ ...TD, fontFamily: 'monospace' }}>${Number(p.cost_basis_usd || 0).toFixed(2)}</td>
                      <td style={{ ...TD, color: '#777', fontFamily: 'monospace' }}>
                        {p.avg_entry_price != null ? `${(Number(p.avg_entry_price) * 100).toFixed(1)}%` : '--'}
                      </td>
                      <td style={{ ...TD, fontFamily: 'monospace' }}>
                        {p.current_price != null ? `${(Number(p.current_price) * 100).toFixed(1)}%` : '--'}
                      </td>
                      <td style={{ ...TD, fontWeight: 600 }}>
                        <span style={{ color: pnlColor(unr) }}>{pnlStr(unr)}</span>
                        <span style={{ color: '#333', fontSize: '0.6rem', marginLeft: '4px' }}>
                          ({pct >= 0 ? '+' : ''}{(pct * 100).toFixed(1)}%)
                        </span>
                      </td>
                      <td style={{ ...TD, color: '#555' }}>{p.tick_count ?? 0}</td>
                      <td style={{ ...TD }}>
                        <span style={{ color: age.color, fontSize: '0.72rem' }}>{age.label}</span>
                        {age.badge && (
                          <span style={{
                            marginLeft: '6px', fontSize: '0.55rem', fontWeight: 600,
                            padding: '1px 5px', borderRadius: '3px',
                            background: age.color + '22', color: age.color,
                            textTransform: 'uppercase', letterSpacing: '0.04em',
                          }}>
                            {age.badge}
                          </span>
                        )}
                      </td>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
            <h2 style={{ fontSize: '0.78rem', fontWeight: 600, color: '#444', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Recently Closed
            </h2>
            <Link href="/forecast-arena/positions" style={{ fontSize: '0.68rem', color: '#333', textDecoration: 'none' }}>
              All positions →
            </Link>
          </div>
          <div style={{ overflowX: 'auto', border: '1px solid #161616', borderRadius: '6px' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead style={{ background: '#090909' }}>
                <tr>
                  {['Model', 'Market', 'Side', 'Cost', 'Realized P&L', 'Closed'].map(h => (
                    <th key={h} style={{ ...TH, color: '#2a2a2a' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {closedPos.map((p: any) => {
                  const rlz = Number(p.realized_pnl || 0);
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid #111', opacity: 0.7 }}>
                      <td style={{ ...TD, color: '#666', fontSize: '0.73rem' }}>{p.agent_display_name}</td>
                      <td style={{ ...TD, color: '#444', fontSize: '0.72rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                      <td style={{ ...TD, color: '#444', fontFamily: 'monospace', fontSize: '0.73rem' }}>
                        ${Number(p.cost_basis_usd || 0).toFixed(2)}
                      </td>
                      <td style={{ ...TD, fontWeight: 600, fontSize: '0.78rem' }}>
                        <span style={{ color: pnlColor(rlz) }}>{pnlStr(rlz)}</span>
                      </td>
                      <td style={{ ...TD, color: '#333', fontSize: '0.68rem' }}>
                        {p.closed_at ? relTime(p.closed_at) : '--'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Recent Evaluations (Decision Log preview) ── */}
      <section style={{ marginBottom: '36px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
          <h2 style={{ fontSize: '0.78rem', fontWeight: 600, color: '#444', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Recent Evaluations
          </h2>
          <Link href="/forecast-arena/decisions" style={{ fontSize: '0.68rem', color: '#333', textDecoration: 'none' }}>
            Full Decision Log →
          </Link>
        </div>

        {recentRounds.length === 0 ? (
          <div style={{
            padding: '20px', background: '#0e0e0e', border: '1px solid #1a1a1a',
            borderRadius: '6px', color: '#333', fontSize: '0.78rem', textAlign: 'center',
          }}>
            No market evaluations yet — the daily cycle will run automatically at 06:00 UTC.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {recentRounds.map((round: any) => {
              const subs      = subsByRound.get(round.round_id) ?? [];
              const posOpened = subs.filter((s: any) => actionColors[s.action]).length; // proxy
              return (
                <Link
                  key={round.round_id}
                  href={`/forecast-arena/decisions`}
                  style={{ textDecoration: 'none' }}
                >
                  <div style={{
                    background: '#0a0a0a', border: '1px solid #1a1a1a',
                    borderRadius: '5px', padding: '10px 14px',
                    display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap',
                  }}>
                    <div style={{ minWidth: '48px' }}>
                      <div style={{ fontSize: '0.55rem', color: '#333' }}>Round</div>
                      <div style={{ fontFamily: 'monospace', color: '#555', fontWeight: 600, fontSize: '0.82rem' }}>#{round.round_number}</div>
                    </div>
                    <div style={{ flex: 1, minWidth: '180px' }}>
                      <div style={{ fontSize: '0.75rem', color: '#aaa', fontWeight: 500 }}>
                        {round.market_title?.slice(0, 65)}
                      </div>
                      <div style={{ fontSize: '0.6rem', color: '#444', marginTop: '2px' }}>
                        YES at open:{' '}
                        <strong style={{ color: '#666' }}>
                          {round.market_yes_price_at_open != null
                            ? `${(Number(round.market_yes_price_at_open) * 100).toFixed(1)}%`
                            : '--'}
                        </strong>
                        {' · '}{subs.length} model{subs.length !== 1 ? 's' : ''}
                        {' · '}{relTime(round.opened_at)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                      {subs.slice(0, 6).map((s: any, i: number) => (
                        <span key={i} style={{
                          fontSize: '0.58rem', padding: '2px 5px', borderRadius: '3px',
                          background: '#111', fontFamily: 'monospace',
                          color: actionColors[s.action] ?? '#555',
                          border: `1px solid ${actionColors[s.action] ? actionColors[s.action] + '33' : '#1a1a1a'}`,
                        }}>
                          {(Number(s.probability_yes) * 100).toFixed(0)}%
                        </span>
                      ))}
                    </div>
                    <div style={{ fontSize: '0.6rem', color: '#222' }}>→</div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* ── System Status ── */}
      <section style={{ marginBottom: '36px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' }}>
          <h2 style={{ fontSize: '0.78rem', fontWeight: 600, color: '#333', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            System Status
          </h2>
          <Link href="/forecast-arena/admin" style={{ fontSize: '0.68rem', color: '#2a2a2a', textDecoration: 'none' }}>
            Diagnostics →
          </Link>
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
          gap: '8px',
        }}>
          {systemItems.map((item) => {
            const isPaused  = item.paused;
            const dotColor  = isPaused
              ? '#f59e0b'
              : item.time
                ? statusColor(item.time, item.warn, item.stale)
                : '#f87171';
            const isHealthy = dotColor === '#4ade80';
            const isWarn    = dotColor === '#fbbf24' || dotColor === '#f59e0b';
            return (
              <div key={item.label} style={{
                background:   '#0a0a0a',
                border:       `1px solid ${isHealthy ? '#152015' : isWarn ? '#201800' : '#201010'}`,
                borderRadius: '5px',
                padding:      '10px 13px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontSize: '0.58rem', color: '#444', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {item.label}
                  </span>
                  <span style={{
                    width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0,
                    background: dotColor, boxShadow: `0 0 4px ${dotColor}66`,
                  }} />
                </div>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: item.time ? '#777' : '#333' }}>
                  {isPaused ? 'paused' : relTime(item.time)}
                </div>
                {item.detail && (
                  <div style={{ fontSize: '0.57rem', color: isPaused ? '#92400e' : '#2a2a2a', marginTop: '3px' }}>
                    {item.detail}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: '7px', fontSize: '0.6rem', color: '#222', padding: '0 2px' }}>
          Cron: tick every {tickIntervalMin}m · light-cycle 6×/day (01:00 05:00 09:00 13:00 17:00 21:00 UTC) · daily-cycle 06:00 UTC
        </div>
      </section>

      {/* ── System Controls (collapsed by default) ── */}
      <section>
        <details>
          <summary style={{
            cursor: 'pointer', userSelect: 'none', listStyle: 'none',
            fontSize: '0.68rem', color: '#333', fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.05em',
            padding: '8px 0', borderTop: '1px solid #161616',
          }}>
            System Controls ▸
          </summary>
          <div style={{ marginTop: '12px' }}>
            <OperatorActions />
          </div>
        </details>
      </section>

    </div>
  );
}
