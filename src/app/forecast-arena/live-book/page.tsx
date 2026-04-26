/**
 * /forecast-arena/live-book — v2 Operator Live Book
 *
 * Shows the Phase 1 pilot in full:
 *   • Pilot status bar (bankroll, cash, P&L, mode)
 *   • Open positions — each with entry reason, sizing logic, management plan, exit strategy
 *   • Hot signals not yet positioned (opportunity queue)
 *   • Recent adjustments log
 *   • AI cost summary for the pilot
 */

import { faSelect }         from '@/lib/forecast/db';
import type { V2Pilot, V2Position, V2Signal, V2Adjustment } from '@/lib/forecast/v2/types';
import {
  V2_MIN_ENTRY_EDGE,
  V2_BASE_POSITION_PCT,
  V2_MAX_POSITION_PCT,
  V2_REDUCE_EDGE_THRESHOLD,
  V2_REDUCE_DISAGREEMENT,
  V2_CLOSE_DISAGREEMENT,
  V2_REVERSAL_EDGE_MULTIPLIER,
} from '@/lib/forecast/v2/types';
import LiveBookControls     from './_components/LiveBookControls';

export const dynamic = 'force-dynamic';

// ── Helpers ───────────────────────────────────────────────────────────────────

const $ = (n: number, dec = 0) =>
  `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;

function pnlStr(n: number) {
  const s = $(Math.abs(n), 2);
  return n >= 0 ? `+${s}` : `-${s}`;
}
function pnlColor(n: number) { return n > 0 ? '#4ade80' : n < 0 ? '#f87171' : '#9ca3af'; }

function tierColor(tier: string) {
  switch (tier) {
    case 'hot':       return { bg: '#4ade80', text: '#080808' };
    case 'tradable':  return { bg: '#86efac', text: '#080808' };
    case 'active':    return { bg: '#60a5fa', text: '#080808' };
    case 'cooling':   return { bg: '#fbbf24', text: '#080808' };
    default:          return { bg: '#374151', text: '#9ca3af' };
  }
}

function relTime(iso: string | null | undefined): string {
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

function pct(n: number | null | undefined) {
  if (n == null) return '—';
  return `${(Number(n) * 100).toFixed(1)}%`;
}

function conv(n: number | null | undefined) {
  if (n == null) return '—';
  return Number(n).toFixed(3);
}

// Runtime management / exit strings (fallback for positions opened before this deploy)
function derivedManagementPlan(domain: string | null, bankroll: number): string {
  const maxSize = Math.round(bankroll * V2_MAX_POSITION_PCT);
  return (
    `ADD: conviction ≥ 0.65 and size < $${maxSize} (${(V2_MAX_POSITION_PCT * 100).toFixed(0)}% cap) · ` +
    `REDUCE: disagreement > ${V2_REDUCE_DISAGREEMENT} or |edge| < ${V2_REDUCE_EDGE_THRESHOLD} · ` +
    `CLOSE: disagreement > ${V2_CLOSE_DISAGREEMENT}`
  );
}

function derivedExitTrigger(domain: string | null): string {
  const minEdge      = V2_MIN_ENTRY_EDGE[domain ?? 'other'] ?? 0.12;
  const reversalEdge = (minEdge * V2_REVERSAL_EDGE_MULTIPLIER).toFixed(2);
  return (
    `CLOSE: within 24h of resolution · ` +
    `CLOSE: disagreement > ${V2_CLOSE_DISAGREEMENT} · ` +
    `REDUCE: |edge| < ${V2_REDUCE_EDGE_THRESHOLD} or disagreement > ${V2_REDUCE_DISAGREEMENT} · ` +
    `REVERSE: opposite edge ≥ ${reversalEdge}`
  );
}

// ── Data fetch ────────────────────────────────────────────────────────────────

async function loadLiveBook() {
  const pilots = await faSelect<V2Pilot>(
    'fa_v2_pilots',
    "status=in.(active,paused,manual_only)&order=created_at.asc&limit=1&select=*",
  ).catch(() => [] as V2Pilot[]);
  const pilot = pilots[0] ?? null;

  if (!pilot) return {
    pilot: null, positions: [], signals: {} as Record<string, V2Signal>,
    unpositioned: [], adjustments: [], aiCostToday: 0, aiCostTotal: 0,
  };

  const positions = await faSelect<V2Position>(
    'fa_v2_positions',
    `pilot_id=eq.${pilot.id}&status=in.(open,paused)&order=opened_at.desc&select=*`,
  ).catch(() => [] as V2Position[]);

  const mktIds = [...new Set(positions.map(p => p.market_id))];
  const mktMap: Record<string, { title: string; price: number | null }> = {};
  if (mktIds.length > 0) {
    const mkts = await faSelect<{ id: string; title: string; current_yes_price: number | null }>(
      'fa_markets',
      `id=in.(${mktIds.join(',')})&select=id,title,current_yes_price`,
    ).catch(() => []);
    for (const m of mkts) mktMap[m.id] = { title: m.title, price: m.current_yes_price };
  }

  const sigRows = mktIds.length > 0
    ? await faSelect<V2Signal>(
        'fa_v2_signals',
        `market_id=in.(${mktIds.join(',')})&select=*`,
      ).catch(() => [] as V2Signal[])
    : [] as V2Signal[];
  const signals: Record<string, V2Signal> = {};
  for (const s of sigRows) signals[s.market_id] = s;

  const hotSignals = await faSelect<V2Signal>(
    'fa_v2_signals',
    `tier=in.(hot,tradable)&is_stale=eq.false&order=conviction.desc&limit=15&select=*`,
  ).catch(() => [] as V2Signal[]);
  const openSet   = new Set(mktIds);
  const unpositioned = hotSignals.filter(s => !openSet.has(s.market_id));

  const upMktIds = [...new Set(unpositioned.map(s => s.market_id))];
  const upMap: Record<string, string> = {};
  if (upMktIds.length > 0) {
    const upMkts = await faSelect<{ id: string; title: string }>(
      'fa_markets',
      `id=in.(${upMktIds.join(',')})&select=id,title`,
    ).catch(() => []);
    for (const m of upMkts) upMap[m.id] = m.title;
  }

  const adjustments = await faSelect<V2Adjustment>(
    'fa_v2_adjustments',
    `pilot_id=eq.${pilot.id}&order=created_at.desc&limit=25&select=*`,
  ).catch(() => [] as V2Adjustment[]);

  // AI cost — aggregate from fa_v2_ai_usage if table exists, else from fa_submissions
  let aiCostToday = 0;
  let aiCostTotal = 0;
  try {
    const todayIso = new Date();
    todayIso.setUTCHours(0, 0, 0, 0);
    const pilotStart = pilot.started_at;

    const [todayCosts, totalCosts] = await Promise.all([
      faSelect<{ cost_usd: number }>(
        'fa_v2_ai_usage',
        `pilot_id=eq.${pilot.id}&created_at=gte.${todayIso.toISOString()}&select=cost_usd`,
      ).catch(() => [] as { cost_usd: number }[]),
      faSelect<{ cost_usd: number }>(
        'fa_v2_ai_usage',
        `pilot_id=eq.${pilot.id}&select=cost_usd`,
      ).catch(() => [] as { cost_usd: number }[]),
    ]);
    aiCostToday = todayCosts.reduce((s, r) => s + Number(r.cost_usd), 0);
    aiCostTotal = totalCosts.reduce((s, r) => s + Number(r.cost_usd), 0);
  } catch {}

  return {
    pilot,
    positions: positions.map(p => ({
      ...p,
      market_title:      mktMap[p.market_id]?.title ?? p.market_id,
      market_price_live: mktMap[p.market_id]?.price ?? null,
    })),
    signals,
    unpositioned: unpositioned.map(s => ({ ...s, market_title: upMap[s.market_id] ?? s.market_id })),
    adjustments,
    aiCostToday,
    aiCostTotal,
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function LiveBookPage() {
  const { pilot, positions, signals, unpositioned, adjustments, aiCostToday, aiCostTotal } = await loadLiveBook();

  const totalPnl     = pilot ? Number(pilot.realized_pnl_usd) + Number(pilot.unrealized_pnl_usd) : 0;
  const investedPct  = pilot ? Number(pilot.invested_usd) / Number(pilot.initial_bankroll_usd) * 100 : 0;
  const cashPct      = pilot ? Number(pilot.current_cash_usd) / Number(pilot.initial_bankroll_usd) * 100 : 0;
  const bankroll     = pilot ? Number(pilot.initial_bankroll_usd) : 1000;

  const statusColors: Record<string, string> = {
    active:      '#4ade80',
    paused:      '#fbbf24',
    manual_only: '#60a5fa',
    archived:    '#f87171',
  };
  const pilotStatusColor = statusColors[pilot?.status ?? 'archived'] ?? '#9ca3af';

  const panelStyle: React.CSSProperties = {
    background:   '#111',
    border:       '1px solid #1e1e1e',
    borderRadius: 8,
    padding:      '12px 16px',
    marginBottom: 10,
  };

  return (
    <div style={{ color: '#e5e7eb', fontFamily: 'monospace' }}>

      {/* ── Title ── */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700, color: '#fff' }}>Live Book</h1>
        <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>Phase 1 Pilot — $1,000 bankroll</span>
      </div>

      {/* ── Pilot status bar ── */}
      {pilot ? (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 12, background: '#111', border: '1px solid #1e1e1e',
          borderRadius: 8, padding: 16, marginBottom: 28,
        }}>
          <Stat label="Status"     value={pilot.status.toUpperCase().replace('_', ' ')} valueColor={pilotStatusColor} />
          <Stat label="Bankroll"   value={$(Number(pilot.initial_bankroll_usd))} />
          <Stat label="Cash"       value={`${$(Number(pilot.current_cash_usd))} (${cashPct.toFixed(0)}%)`} />
          <Stat label="Invested"   value={`${$(Number(pilot.invested_usd))} (${investedPct.toFixed(0)}%)`} />
          <Stat label="Real P&L"   value={pnlStr(Number(pilot.realized_pnl_usd))} valueColor={pnlColor(Number(pilot.realized_pnl_usd))} />
          <Stat label="Unreal P&L" value={pnlStr(Number(pilot.unrealized_pnl_usd))} valueColor={pnlColor(Number(pilot.unrealized_pnl_usd))} />
          <Stat label="Total P&L"  value={pnlStr(totalPnl)} valueColor={pnlColor(totalPnl)} />
          <Stat label="Positions"  value={String(positions.length)} />
        </div>
      ) : (
        <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 8, padding: 16, marginBottom: 28, color: '#9ca3af' }}>
          No active pilot found. Run the daily cycle to initialize.
        </div>
      )}

      {/* ── Operator controls ── */}
      {pilot && (
        <div style={{ marginBottom: 28 }}>
          <LiveBookControls pilotStatus={pilot.status} pilotId={pilot.id} />
        </div>
      )}

      {/* ── Open Positions ── */}
      <section style={{ marginBottom: 32 }}>
        <SectionHeader title={`Open Positions (${positions.length})`} />

        {positions.length === 0 ? (
          <div style={{ color: '#4b5563', fontSize: '0.85rem' }}>No open positions.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {(positions as any[]).map((pos) => {
              const sig        = signals[pos.market_id];
              const tc         = tierColor(sig?.tier ?? 'monitored');
              const unrealPnl  = Number(pos.unrealized_pnl);
              const livePrice  = pos.market_price_live;
              const mgmt       = pos.management_plan ?? derivedManagementPlan(pos.domain, bankroll);
              const exit       = pos.exit_trigger    ?? derivedExitTrigger(pos.domain);
              const edgeAtOpen = Number(pos.edge_at_open ?? 0);
              const sizePct    = (Number(pos.size_usd) / bankroll * 100).toFixed(1);

              return (
                <div key={pos.id} style={{
                  background:   '#111',
                  border:       `1px solid ${pos.status === 'paused' ? '#78350f' : '#1e1e1e'}`,
                  borderRadius: 8,
                  overflow:     'hidden',
                }}>

                  {/* ─ Header row ─ */}
                  <div style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                        <span style={{ background: tc.bg, color: tc.text, fontSize: '0.62rem', fontWeight: 700, padding: '2px 6px', borderRadius: 4 }}>
                          {sig?.tier?.toUpperCase() ?? 'NO SIG'}
                        </span>
                        <span style={{
                          background: pos.side === 'yes' ? '#166534' : '#7f1d1d',
                          color: pos.side === 'yes' ? '#4ade80' : '#fca5a5',
                          fontSize: '0.62rem', fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                        }}>
                          {pos.side.toUpperCase()}
                        </span>
                        {pos.status === 'paused' && (
                          <span style={{ background: '#78350f', color: '#fcd34d', fontSize: '0.62rem', fontWeight: 700, padding: '2px 6px', borderRadius: 4 }}>PAUSED</span>
                        )}
                        <DomainPill domain={pos.domain} />
                      </div>

                      <div style={{ fontSize: '0.9rem', color: '#fff', marginBottom: 8, fontWeight: 600 }}>
                        {pos.market_title}
                      </div>

                      {/* Core metrics row */}
                      <div style={{ display: 'flex', gap: 20, fontSize: '0.75rem', color: '#9ca3af', flexWrap: 'wrap' }}>
                        <span>Size <strong style={{ color: '#e5e7eb' }}>{$(Number(pos.size_usd))} ({sizePct}%)</strong></span>
                        <span>Entry <strong style={{ color: '#e5e7eb' }}>{pct(pos.entry_price)}</strong></span>
                        {livePrice != null && (
                          <span>Live <strong style={{ color: '#e5e7eb' }}>{pct(livePrice)}</strong></span>
                        )}
                        <span>Unreal P&L <strong style={{ color: pnlColor(unrealPnl) }}>{pnlStr(unrealPnl)}</strong></span>
                        <span>Real P&L <strong style={{ color: pnlColor(Number(pos.realized_pnl)) }}>{pnlStr(Number(pos.realized_pnl))}</strong></span>
                        <span style={{ color: '#4b5563' }}>opened {relTime(pos.opened_at)}</span>
                      </div>
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#374151', textAlign: 'right' }}>
                      #{pos.adjustment_count} adj
                    </div>
                  </div>

                  {/* ─ Entry reason ─ */}
                  <InfoPanel label="WHY WE ENTERED" borderColor="#1e4030">
                    {pos.thesis ? (
                      <div style={{ color: '#d1fae5', fontSize: '0.8rem', lineHeight: 1.6 }}>
                        {pos.thesis}
                      </div>
                    ) : (
                      <div style={{ color: '#6b7280', fontSize: '0.78rem', fontStyle: 'italic' }}>No entry thesis recorded.</div>
                    )}
                    <div style={{ display: 'flex', gap: 20, marginTop: 8, fontSize: '0.72rem', flexWrap: 'wrap' }}>
                      <MetricChip label="Edge at open"  value={(edgeAtOpen >= 0 ? '+' : '') + (edgeAtOpen * 100).toFixed(1) + 'pp'} color={edgeAtOpen > 0 ? '#4ade80' : '#f87171'} />
                      <MetricChip label="Conviction"    value={conv(pos.conviction)} color="#e5e7eb" />
                      <MetricChip label="Disagreement"  value={conv(pos.disagreement)} color="#e5e7eb" />
                      <MetricChip label="Min edge bar"  value={(V2_MIN_ENTRY_EDGE[pos.domain ?? 'other'] ?? 0.12) * 100 + 'pp'} color="#6b7280" />
                    </div>
                  </InfoPanel>

                  {/* ─ Current signal (live read from signals table) ─ */}
                  {sig && (
                    <InfoPanel label="CURRENT SIGNAL" borderColor="#1e2c40">
                      <div style={{ display: 'flex', gap: 20, fontSize: '0.72rem', flexWrap: 'wrap' }}>
                        <MetricChip label="Agg. prob"    value={pct(sig.aggregated_p)} color="#e5e7eb" />
                        <MetricChip label="Market"       value={pct(sig.market_price)} color="#e5e7eb" />
                        <MetricChip label="Edge"         value={(Number(sig.edge) >= 0 ? '+' : '') + (Number(sig.edge) * 100).toFixed(1) + 'pp'} color={Number(sig.edge) > 0 ? '#4ade80' : '#f87171'} />
                        <MetricChip label="Conviction"   value={conv(sig.conviction)} color="#e5e7eb" />
                        <MetricChip label="Disagreement" value={conv(sig.disagreement)} color="#e5e7eb" />
                        <MetricChip label="Models"       value={String(sig.n_models ?? '—')} color="#6b7280" />
                        <MetricChip label="Refreshed"    value={relTime(sig.last_refresh)} color="#6b7280" />
                      </div>
                    </InfoPanel>
                  )}

                  {/* ─ Sizing logic ─ */}
                  <InfoPanel label="SIZING LOGIC" borderColor="#2a1e40">
                    <div style={{ fontSize: '0.78rem', color: '#c4b5fd', lineHeight: 1.6 }}>
                      Starter size: {(V2_BASE_POSITION_PCT * 100).toFixed(0)}% of ${Math.round(bankroll)} bankroll → ${Math.round(bankroll * V2_BASE_POSITION_PCT)} gross.
                      After spread ({(1).toFixed(0)}%) + slippage (0.5%): ${Math.round(bankroll * V2_BASE_POSITION_PCT * 1.015)} net cost.
                      Max cap: {(V2_MAX_POSITION_PCT * 100).toFixed(0)}% per market (${Math.round(bankroll * V2_MAX_POSITION_PCT)}) ·
                      40% per domain · 75% gross total.
                    </div>
                  </InfoPanel>

                  {/* ─ Management plan ─ */}
                  <InfoPanel label="MANAGEMENT PLAN" borderColor="#1e2830">
                    <div style={{ fontSize: '0.78rem', color: '#93c5fd', lineHeight: 1.7 }}>
                      {mgmt.split(' · ').map((rule, i) => (
                        <div key={i}>
                          <span style={{ color: '#374151' }}>›</span> {rule}
                        </div>
                      ))}
                    </div>
                  </InfoPanel>

                  {/* ─ Exit strategy ─ */}
                  <InfoPanel label="EXIT STRATEGY" borderColor="#2a1a1a">
                    <div style={{ fontSize: '0.78rem', color: '#fca5a5', lineHeight: 1.7 }}>
                      {exit.split(' · ').map((rule, i) => (
                        <div key={i}>
                          <span style={{ color: '#374151' }}>›</span> {rule}
                        </div>
                      ))}
                    </div>
                  </InfoPanel>

                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Opportunity queue ── */}
      {unpositioned.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <SectionHeader title={`Signal Queue — Hot / Tradable (${unpositioned.length})`} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(unpositioned as any[]).map((sig) => {
              const tc = tierColor(sig.tier);
              return (
                <div key={sig.market_id} style={{
                  background: '#0d0d0d', border: '1px solid #1e1e1e',
                  borderRadius: 6, padding: '10px 14px',
                  display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.8rem', flexWrap: 'wrap',
                }}>
                  <span style={{ background: tc.bg, color: tc.text, fontSize: '0.6rem', fontWeight: 700, padding: '1px 5px', borderRadius: 3 }}>
                    {sig.tier.toUpperCase()}
                  </span>
                  <DomainPill domain={sig.domain} />
                  <span style={{ color: '#e5e7eb', flex: 1, lineHeight: 1.3, minWidth: 200 }}>{sig.market_title}</span>
                  <span style={{ color: Number(sig.edge) > 0 ? '#4ade80' : '#f87171' }}>
                    edge {sig.edge != null ? (Number(sig.edge) >= 0 ? '+' : '') + (Number(sig.edge) * 100).toFixed(1) + 'pp' : '—'}
                  </span>
                  <span style={{ color: '#9ca3af' }}>conv {conv(sig.conviction)}</span>
                  <span style={{ color: '#9ca3af' }}>σ {conv(sig.disagreement)}</span>
                  <span style={{ color: '#4b5563' }}>{relTime(sig.last_refresh)}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Recent adjustments ── */}
      {adjustments.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <SectionHeader title="Recent Adjustments" />
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
            <thead>
              <tr style={{ color: '#6b7280', borderBottom: '1px solid #1e1e1e' }}>
                {['Time', 'Action', 'Market ID', 'Δ Size', 'P&L Δ', 'Source', 'Reason'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(adjustments as any[]).map((adj) => {
                const delta = Number(adj.delta_usd);
                const pnl   = Number(adj.realized_pnl_delta);
                const actionColors: Record<string, string> = {
                  open: '#4ade80', add: '#86efac', reduce: '#fbbf24',
                  close: '#f87171', reverse: '#c084fc', pause: '#60a5fa', resume: '#60a5fa',
                };
                return (
                  <tr key={adj.id} style={{ borderBottom: '1px solid #111', color: '#9ca3af' }}>
                    <td style={{ padding: '5px 8px', color: '#4b5563' }}>{relTime(adj.created_at)}</td>
                    <td style={{ padding: '5px 8px' }}>
                      <span style={{ color: actionColors[adj.action] ?? '#9ca3af', fontWeight: 700 }}>
                        {adj.action.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '5px 8px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#9ca3af', fontSize: '0.68rem' }}>
                      {adj.market_id}
                    </td>
                    <td style={{ padding: '5px 8px', color: delta > 0 ? '#4ade80' : '#f87171' }}>
                      {delta > 0 ? '+' : ''}{$(Math.abs(delta))}
                    </td>
                    <td style={{ padding: '5px 8px', color: pnlColor(pnl) }}>
                      {pnl !== 0 ? pnlStr(pnl) : '—'}
                    </td>
                    <td style={{ padding: '5px 8px', color: adj.source === 'operator' ? '#60a5fa' : '#6b7280' }}>
                      {adj.source}
                    </td>
                    <td style={{ padding: '5px 8px', color: '#4b5563', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {adj.reason ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* ── AI Cost Summary ── */}
      {pilot && (
        <section style={{ marginBottom: 32 }}>
          <SectionHeader title="AI Inference Cost" />
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 12, background: '#111', border: '1px solid #1e1e1e', borderRadius: 8, padding: 16,
          }}>
            <Stat label="Today"      value={`$${aiCostToday.toFixed(4)}`} />
            <Stat label="Pilot Total" value={`$${aiCostTotal.toFixed(4)}`} />
            <Stat label="Per cycle est." value={`~$${(0.035).toFixed(3)}`} />
            <div>
              <div style={{ fontSize: '0.65rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Details</div>
              <a href="/api/forecast/v2/ai-costs" target="_blank" style={{ fontSize: '0.75rem', color: '#60a5fa', textDecoration: 'none' }}>
                View breakdown ↗
              </a>
            </div>
          </div>
          <div style={{ marginTop: 8, fontSize: '0.68rem', color: '#4b5563' }}>
            Costs logged per model call to fa_v2_ai_usage. Pricing: Opus $15/$75 · Sonnet $3/$15 · GPT-4.1 $2/$8 · Grok $5/$15 · Gemini $1.25/$10 · Qwen $0.40/$0.40 per M tokens.
          </div>
        </section>
      )}

    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Stat({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div>
      <div style={{ fontSize: '0.65rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontSize: '0.9rem', fontWeight: 700, color: valueColor ?? '#e5e7eb' }}>
        {value}
      </div>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h2 style={{
      margin: '0 0 12px', fontSize: '0.9rem', fontWeight: 600,
      color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em',
    }}>
      {title}
    </h2>
  );
}

function InfoPanel({ label, borderColor, children }: { label: string; borderColor: string; children: React.ReactNode }) {
  return (
    <div style={{
      borderTop: `1px solid ${borderColor}`,
      padding: '8px 16px',
    }}>
      <div style={{ fontSize: '0.6rem', color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function MetricChip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span>
      <span style={{ color: '#4b5563' }}>{label} </span>
      <strong style={{ color }}>{value}</strong>
    </span>
  );
}

function DomainPill({ domain }: { domain: string | null }) {
  const domainColors: Record<string, string> = {
    politics:    '#dbeafe',
    geopolitics: '#fecaca',
    tech:        '#d1fae5',
    sports:      '#fed7aa',
    crypto:      '#e9d5ff',
    macro:       '#fef3c7',
    culture:     '#fbcfe8',
    other:       '#374151',
  };
  const d = domain ?? 'other';
  return (
    <span style={{
      background: domainColors[d] ?? '#374151',
      color: d === 'other' ? '#9ca3af' : '#080808',
      fontSize: '0.6rem', fontWeight: 600, padding: '2px 6px', borderRadius: 4,
    }}>
      {d}
    </span>
  );
}
