/**
 * /forecast-arena/live-book — v2 Operator Live Book
 *
 * Real-time view of the Phase 1 pilot:
 *   • Pilot status bar (bankroll, cash, P&L, mode)
 *   • Open positions with conviction/edge/tier badges
 *   • Hot signals not yet positioned (opportunity queue)
 *   • Recent adjustments log
 */

import { faSelect }         from '@/lib/forecast/db';
import type { V2Pilot, V2Position, V2Signal, V2Adjustment } from '@/lib/forecast/v2/types';
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

// ── Data fetch ────────────────────────────────────────────────────────────────

async function loadLiveBook() {
  // Pilot
  const pilots = await faSelect<V2Pilot>(
    'fa_v2_pilots',
    "status=in.(active,paused,manual_only)&order=created_at.asc&limit=1&select=*",
  ).catch(() => [] as V2Pilot[]);
  const pilot = pilots[0] ?? null;

  if (!pilot) return { pilot: null, positions: [], signals: {} as Record<string, V2Signal>, unpositioned: [], adjustments: [] };

  // Open positions
  const positions = await faSelect<V2Position>(
    'fa_v2_positions',
    `pilot_id=eq.${pilot.id}&status=in.(open,paused)&order=opened_at.desc&select=*`,
  ).catch(() => [] as V2Position[]);

  // Market titles + live prices
  const mktIds = [...new Set(positions.map(p => p.market_id))];
  const mktMap: Record<string, { title: string; price: number | null }> = {};
  if (mktIds.length > 0) {
    const mkts = await faSelect<{ id: string; title: string; current_yes_price: number | null }>(
      'fa_markets',
      `id=in.(${mktIds.join(',')})&select=id,title,current_yes_price`,
    ).catch(() => []);
    for (const m of mkts) mktMap[m.id] = { title: m.title, price: m.current_yes_price };
  }

  // Signals for open positions
  const sigRows = mktIds.length > 0
    ? await faSelect<V2Signal>(
        'fa_v2_signals',
        `market_id=in.(${mktIds.join(',')})&select=*`,
      ).catch(() => [] as V2Signal[])
    : [] as V2Signal[];
  const signals: Record<string, V2Signal> = {};
  for (const s of sigRows) signals[s.market_id] = s;

  // Hot signals without positions
  const hotSignals = await faSelect<V2Signal>(
    'fa_v2_signals',
    `tier=in.(hot,tradable)&is_stale=eq.false&order=conviction.desc&limit=15&select=*`,
  ).catch(() => [] as V2Signal[]);
  const openSet = new Set(mktIds);
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

  // Recent adjustments
  const adjustments = await faSelect<V2Adjustment & { position_market_id?: string }>(
    'fa_v2_adjustments',
    `pilot_id=eq.${pilot.id}&order=created_at.desc&limit=25&select=*`,
  ).catch(() => [] as V2Adjustment[]);

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
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function LiveBookPage() {
  const { pilot, positions, signals, unpositioned, adjustments } = await loadLiveBook();

  const totalPnl     = pilot ? Number(pilot.realized_pnl_usd) + Number(pilot.unrealized_pnl_usd) : 0;
  const investedPct  = pilot ? Number(pilot.invested_usd) / Number(pilot.initial_bankroll_usd) * 100 : 0;
  const cashPct      = pilot ? Number(pilot.current_cash_usd) / Number(pilot.initial_bankroll_usd) * 100 : 0;

  const statusColors: Record<string, string> = {
    active:      '#4ade80',
    paused:      '#fbbf24',
    manual_only: '#60a5fa',
    archived:    '#f87171',
  };
  const pilotStatusColor = statusColors[pilot?.status ?? 'archived'] ?? '#9ca3af';

  return (
    <div style={{ color: '#e5e7eb', fontFamily: 'monospace' }}>

      {/* ── Title ── */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700, color: '#fff' }}>
          Live Book
        </h1>
        <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>Phase 1 Pilot — $1,000 bankroll</span>
      </div>

      {/* ── Pilot status bar ── */}
      {pilot ? (
        <div style={{
          display:       'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap:           12,
          background:    '#111',
          border:        '1px solid #1e1e1e',
          borderRadius:  8,
          padding:       16,
          marginBottom:  28,
        }}>
          <Stat label="Status"    value={pilot.status.toUpperCase().replace('_', ' ')} valueColor={pilotStatusColor} />
          <Stat label="Bankroll"  value={$(Number(pilot.initial_bankroll_usd))} />
          <Stat label="Cash"      value={`${$(Number(pilot.current_cash_usd))} (${cashPct.toFixed(0)}%)`} />
          <Stat label="Invested"  value={`${$(Number(pilot.invested_usd))} (${investedPct.toFixed(0)}%)`} />
          <Stat label="Real P&L"  value={pnlStr(Number(pilot.realized_pnl_usd))} valueColor={pnlColor(Number(pilot.realized_pnl_usd))} />
          <Stat label="Unreal P&L" value={pnlStr(Number(pilot.unrealized_pnl_usd))} valueColor={pnlColor(Number(pilot.unrealized_pnl_usd))} />
          <Stat label="Total P&L" value={pnlStr(totalPnl)} valueColor={pnlColor(totalPnl)} />
          <Stat label="Positions" value={String(positions.length)} />
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

      {/* ── Open positions ── */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ margin: '0 0 12px', fontSize: '0.9rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Open Positions ({positions.length})
        </h2>

        {positions.length === 0 ? (
          <div style={{ color: '#4b5563', fontSize: '0.85rem' }}>No open positions.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {positions.map((pos: any) => {
              const sig   = signals[pos.market_id];
              const tc    = tierColor(sig?.tier ?? 'monitored');
              const unrealPnl = Number(pos.unrealized_pnl);
              const livePrice = pos.market_price_live;

              return (
                <div key={pos.id} style={{
                  background:   '#111',
                  border:       `1px solid ${pos.status === 'paused' ? '#78350f' : '#1e1e1e'}`,
                  borderRadius: 8,
                  padding:      '12px 16px',
                  display:      'grid',
                  gridTemplateColumns: '1fr auto',
                  gap:          8,
                }}>
                  {/* Left */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      {/* Tier badge */}
                      <span style={{ background: tc.bg, color: tc.text, fontSize: '0.65rem', fontWeight: 700, padding: '2px 6px', borderRadius: 4 }}>
                        {sig?.tier?.toUpperCase() ?? 'NO SIG'}
                      </span>
                      {/* Side badge */}
                      <span style={{
                        background: pos.side === 'yes' ? '#166534' : '#7f1d1d',
                        color: pos.side === 'yes' ? '#4ade80' : '#fca5a5',
                        fontSize: '0.65rem', fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                      }}>
                        {pos.side.toUpperCase()}
                      </span>
                      {pos.status === 'paused' && (
                        <span style={{ background: '#78350f', color: '#fcd34d', fontSize: '0.65rem', fontWeight: 700, padding: '2px 6px', borderRadius: 4 }}>
                          PAUSED
                        </span>
                      )}
                      <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                        {pos.domain ?? 'other'}
                      </span>
                    </div>

                    {/* Market title */}
                    <div style={{ fontSize: '0.85rem', color: '#e5e7eb', marginBottom: 6, lineHeight: 1.3 }}>
                      {pos.market_title}
                    </div>

                    {/* Stats row */}
                    <div style={{ display: 'flex', gap: 20, fontSize: '0.75rem', color: '#9ca3af', flexWrap: 'wrap' }}>
                      <span>Size <strong style={{ color: '#e5e7eb' }}>{$(Number(pos.size_usd))}</strong></span>
                      <span>Entry <strong style={{ color: '#e5e7eb' }}>{pct(pos.entry_price)}</strong></span>
                      {livePrice != null && (
                        <span>Live <strong style={{ color: '#e5e7eb' }}>{pct(livePrice)}</strong></span>
                      )}
                      <span>P&L <strong style={{ color: pnlColor(unrealPnl) }}>{pnlStr(unrealPnl)}</strong></span>
                      {sig && (
                        <>
                          <span>Edge <strong style={{ color: Number(sig.edge) > 0 ? '#4ade80' : '#f87171' }}>{sig.edge != null ? (Number(sig.edge) >= 0 ? '+' : '') + Number(sig.edge).toFixed(3) : '—'}</strong></span>
                          <span>Conv <strong style={{ color: '#e5e7eb' }}>{conv(sig.conviction)}</strong></span>
                        </>
                      )}
                      <span style={{ color: '#4b5563' }}>opened {relTime(pos.opened_at)}</span>
                    </div>

                    {/* Thesis */}
                    {pos.thesis && (
                      <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: 6, fontStyle: 'italic' }}>
                        {pos.thesis}
                      </div>
                    )}
                  </div>

                  {/* Right: actions placeholder — client component handles them */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', justifyContent: 'flex-start' }}>
                    <span style={{ fontSize: '0.7rem', color: '#374151' }}>#{pos.adjustment_count} adj</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Opportunity queue ── */}
      {unpositioned.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ margin: '0 0 12px', fontSize: '0.9rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Signal Queue — Hot / Tradable ({unpositioned.length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(unpositioned as any[]).map((sig) => {
              const tc = tierColor(sig.tier);
              return (
                <div key={sig.market_id} style={{
                  background: '#0d0d0d',
                  border: '1px solid #1e1e1e',
                  borderRadius: 6,
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  fontSize: '0.8rem',
                }}>
                  <span style={{ background: tc.bg, color: tc.text, fontSize: '0.6rem', fontWeight: 700, padding: '1px 5px', borderRadius: 3 }}>
                    {sig.tier.toUpperCase()}
                  </span>
                  <span style={{ color: '#e5e7eb', flex: 1, lineHeight: 1.3 }}>{sig.market_title}</span>
                  <span style={{ color: '#6b7280' }}>{sig.domain ?? 'other'}</span>
                  <span style={{ color: Number(sig.edge) > 0 ? '#4ade80' : '#f87171' }}>
                    edge {sig.edge != null ? (Number(sig.edge) >= 0 ? '+' : '') + Number(sig.edge).toFixed(3) : '—'}
                  </span>
                  <span style={{ color: '#9ca3af' }}>conv {conv(sig.conviction)}</span>
                  <span style={{ color: '#4b5563' }}>{relTime(sig.last_refresh)}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Recent adjustments ── */}
      {adjustments.length > 0 && (
        <section>
          <h2 style={{ margin: '0 0 12px', fontSize: '0.9rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Recent Adjustments
          </h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
            <thead>
              <tr style={{ color: '#6b7280', borderBottom: '1px solid #1e1e1e' }}>
                {['Time', 'Action', 'Market', 'Δ Size', 'P&L', 'Source', 'Reason'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(adjustments as any[]).map((adj) => {
                const delta = Number(adj.delta_usd);
                const pnl   = Number(adj.realized_pnl_delta);
                const actionColors: Record<string, string> = {
                  open:   '#4ade80', add: '#86efac', reduce: '#fbbf24',
                  close:  '#f87171', reverse: '#c084fc', pause: '#60a5fa', resume: '#60a5fa',
                };
                return (
                  <tr key={adj.id} style={{ borderBottom: '1px solid #111', color: '#9ca3af' }}>
                    <td style={{ padding: '5px 8px', color: '#4b5563' }}>{relTime(adj.created_at)}</td>
                    <td style={{ padding: '5px 8px' }}>
                      <span style={{ color: actionColors[adj.action] ?? '#9ca3af', fontWeight: 700 }}>
                        {adj.action.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '5px 8px', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#e5e7eb' }}>
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
                    <td style={{ padding: '5px 8px', color: '#4b5563', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {adj.reason ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
