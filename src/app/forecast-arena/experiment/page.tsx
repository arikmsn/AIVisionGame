/**
 * /forecast-arena/experiment — Experiment Evaluation Dashboard
 */

import { sfetch } from '@/lib/forecast/db';

export const dynamic = 'force-dynamic';

// ── Helpers ───────────────────────────────────────────────────────────────────

const $ = (n: number, dec = 2) =>
  `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;

function pnlColor(n: number) { return n > 0 ? '#4ade80' : n < 0 ? '#f87171' : '#9ca3af'; }
function pnlStr(n: number) {
  const s = $(n);
  return n >= 0 ? `+${s}` : `-${s}`;
}

const TH: React.CSSProperties = {
  padding: '6px 12px', textAlign: 'left', color: '#444',
  fontWeight: 500, fontSize: '0.62rem', letterSpacing: '0.05em',
  textTransform: 'uppercase', borderBottom: '1px solid #1a1a1a',
  whiteSpace: 'nowrap',
};
const TD: React.CSSProperties = { padding: '8px 12px', fontSize: '0.78rem' };

function KpiCard({
  label, value, sub, color,
}: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div style={{
      background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: '8px',
      padding: '12px 16px', minWidth: '110px', flex: '1 1 110px',
    }}>
      <div style={{ fontSize: '0.58rem', color: '#444', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '5px' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: color ?? '#e8e8e8', lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '0.6rem', color: '#444', marginTop: '4px' }}>{sub}</div>}
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h2 style={{
      fontSize: '0.72rem', fontWeight: 600, color: '#444',
      letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '10px',
    }}>
      {title}
    </h2>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ExperimentPage() {
  let experimentCfg: any   = null;
  let bankroll:      any   = null;
  let openPositions: any[] = [];
  let closedPositions: any[] = [];
  let transactions:  any[] = [];
  let selectedMarkets: any[] = [];
  let agents:        any[] = [];

  try {
    [experimentCfg, bankroll, openPositions, closedPositions, transactions, agents] = await Promise.all([
      sfetch('fa_experiment_config?status=eq.active&order=created_at.desc&limit=1')
        .then((r: any) => Array.isArray(r) ? r[0] ?? null : null).catch(() => null),
      sfetch('fa_v_finance?select=*&limit=1')
        .then((r: any) => Array.isArray(r) ? r[0] ?? null : null).catch(() => null),
      sfetch('fa_v_open_positions?select=*&order=opened_at.desc')
        .then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
      sfetch('fa_positions?status=eq.closed&select=*&order=closed_at.desc&limit=50')
        .then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
      sfetch('fa_transactions?pnl_usd=not.is.null&select=*&order=created_at.desc&limit=100')
        .then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
      sfetch('fa_agents?is_active=eq.true&select=id,slug,display_name,model_id,provider')
        .then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
    ]);

    // Fetch selected markets from scores view
    const scoreRows = await sfetch('fa_v_market_strategy?is_selected=eq.true&select=market_id,title,score,sentiment&order=score.desc')
      .then((r: any) => Array.isArray(r) ? r : []).catch(() => []);
    selectedMarkets = scoreRows;
  } catch { /* tables may not exist */ }

  // ── Derived performance ────────────────────────────────────────────────────

  const totalDeposit  = Number(bankroll?.total_deposit_usd  ?? 60000);
  const availableUsd  = Number(bankroll?.available_usd       ?? 60000);
  const allocatedUsd  = Number(bankroll?.allocated_usd       ?? 0);
  const realizedPnl   = Number(bankroll?.total_realized_pnl  ?? 0);
  const unrealizedPnl = Number(bankroll?.total_unrealized_pnl ?? 0);
  const netValue      = Number(bankroll?.net_value_usd        ?? totalDeposit);

  const winTxns  = transactions.filter((t: any) => Number(t.pnl_usd) > 0);
  const lossTxns = transactions.filter((t: any) => Number(t.pnl_usd) < 0);
  const winRate  = transactions.length > 0 ? (winTxns.length / transactions.length * 100).toFixed(1) : '—';
  const avgWin   = winTxns.length  > 0 ? winTxns.reduce((s: number, t: any) => s + Number(t.pnl_usd), 0) / winTxns.length : 0;
  const avgLoss  = lossTxns.length > 0 ? lossTxns.reduce((s: number, t: any) => s + Number(t.pnl_usd), 0) / lossTxns.length : 0;

  // Max drawdown: running cumulative P&L, find max peak-to-trough
  let peak = 0, maxDrawdown = 0, running = 0;
  for (const t of [...transactions].reverse()) {
    running += Number(t.pnl_usd ?? 0);
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // P&L by agent — enrich closed positions
  const agentMap = new Map(agents.map((a: any) => [a.id, a]));
  const agentPnl = new Map<string, { open: number; closed: number; pnl: number }>();
  for (const p of closedPositions) {
    const id = p.agent_id;
    if (!agentPnl.has(id)) agentPnl.set(id, { open: 0, closed: 0, pnl: 0 });
    const row = agentPnl.get(id)!;
    row.closed++;
    row.pnl += Number(p.realized_pnl ?? 0);
  }
  for (const p of openPositions) {
    const id = p.agent_id ?? '';
    if (!agentPnl.has(id)) agentPnl.set(id, { open: 0, closed: 0, pnl: 0 });
    agentPnl.get(id)!.open++;
  }

  const agentPnlRows = agents.map((a: any) => ({
    ...a,
    ...(agentPnl.get(a.id) ?? { open: 0, closed: 0, pnl: 0 }),
  })).sort((a: any, b: any) => b.pnl - a.pnl);

  // Open position count per selected market
  const openByMarket = new Map<string, number>();
  for (const p of openPositions) {
    const mid = p.market_id ?? '';
    openByMarket.set(mid, (openByMarket.get(mid) ?? 0) + 1);
  }

  // Last 20 closed positions enriched
  const marketIds = [...new Set(closedPositions.slice(0, 20).map((p: any) => p.market_id))];
  let marketTitles = new Map<string, string>();
  if (marketIds.length > 0) {
    const mRows = await sfetch(`fa_markets?id=in.(${marketIds.join(',')})&select=id,title`)
      .then((r: any) => Array.isArray(r) ? r : []).catch(() => []);
    marketTitles = new Map(mRows.map((m: any) => [m.id, m.title]));
  }

  const expStarted = experimentCfg?.starts_at ? new Date(experimentCfg.starts_at) : null;
  const expDaysAgo = expStarted ? Math.floor((Date.now() - expStarted.getTime()) / 86_400_000) : null;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>

      {/* A. Experiment Header */}
      <section style={{ marginBottom: '28px' }}>
        <div style={{
          background: '#090909', border: '1px solid #1e2a1e', borderRadius: '8px',
          padding: '16px 20px',
        }}>
          {experimentCfg ? (
            <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '0.6rem', color: '#444', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Experiment</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#d4f25a', marginTop: '3px' }}>
                  {experimentCfg.name}
                </div>
              </div>
              <div style={{ fontSize: '0.78rem', color: '#888', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                <span><span style={{ color: '#555' }}>Domain: </span><strong style={{ color: '#fbbf24' }}>{experimentCfg.domain}</strong></span>
                <span><span style={{ color: '#555' }}>Status: </span><strong style={{ color: '#4ade80' }}>{experimentCfg.status}</strong></span>
                {expStarted && (
                  <span><span style={{ color: '#555' }}>Started: </span><strong>{expStarted.toLocaleDateString()} ({expDaysAgo}d ago)</strong></span>
                )}
                <span><span style={{ color: '#555' }}>Risk/pos: </span><strong>{(Number(experimentCfg.risk_per_position_pct ?? 0.02) * 100).toFixed(1)}%</strong></span>
                <span><span style={{ color: '#555' }}>Max markets/run: </span><strong>{experimentCfg.max_markets_per_run}</strong></span>
                <span><span style={{ color: '#555' }}>Min score: </span><strong>{experimentCfg.min_score_threshold}</strong></span>
              </div>
            </div>
          ) : (
            <p style={{ color: '#555', fontSize: '0.8rem', margin: 0 }}>
              No active experiment. Run migration 015 to initialise.
            </p>
          )}
        </div>
      </section>

      {/* B. Bankroll KPI Strip */}
      <section style={{ marginBottom: '28px' }}>
        <SectionHeader title="Bankroll" />
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <KpiCard label="Net Value"     value={$(netValue)}     color={netValue >= totalDeposit ? '#d4f25a' : '#f87171'} sub={`Deposit: ${$(totalDeposit)}`} />
          <KpiCard label="Available"     value={$(availableUsd)} color="#e8e8e8" />
          <KpiCard label="Allocated"     value={$(allocatedUsd)} color="#fbbf24" sub={`${openPositions.length} open`} />
          <KpiCard label="Unrealized P&L" value={pnlStr(unrealizedPnl)} color={pnlColor(unrealizedPnl)} />
          <KpiCard label="Realized P&L"   value={pnlStr(realizedPnl)}   color={pnlColor(realizedPnl)} />
        </div>
      </section>

      {/* C. Performance */}
      <section style={{ marginBottom: '28px' }}>
        <SectionHeader title="Performance" />
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <KpiCard label="Total P&L"      value={pnlStr(realizedPnl + unrealizedPnl)} color={pnlColor(realizedPnl + unrealizedPnl)} />
          <KpiCard label="Wins"           value={winTxns.length}  color="#4ade80" />
          <KpiCard label="Losses"         value={lossTxns.length} color="#f87171" />
          <KpiCard label="Win Rate"       value={`${winRate}%`}   color="#e8e8e8" />
          <KpiCard label="Avg Win"        value={avgWin  !== 0 ? pnlStr(avgWin)  : '—'} color="#4ade80" />
          <KpiCard label="Avg Loss"       value={avgLoss !== 0 ? pnlStr(avgLoss) : '—'} color="#f87171" />
          <KpiCard label="Max Drawdown"   value={maxDrawdown > 0 ? `-${$(maxDrawdown)}` : '—'} color={maxDrawdown > 0 ? '#f87171' : '#9ca3af'} />
        </div>
      </section>

      {/* D. P&L by Agent */}
      <section style={{ marginBottom: '28px' }}>
        <SectionHeader title="P&L by Agent" />
        <div style={{ overflowX: 'auto', border: '1px solid #1a1a1a', borderRadius: '6px' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead style={{ background: '#0a0a0a' }}>
              <tr>
                {['Agent', 'Model', 'Provider', 'Open', 'Closed', 'Realized P&L'].map(h => (
                  <th key={h} style={TH}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agentPnlRows.length === 0 ? (
                <tr><td colSpan={6} style={{ ...TD, color: '#444', textAlign: 'center' }}>No agent data</td></tr>
              ) : agentPnlRows.map((a: any) => (
                <tr key={a.id} style={{ borderBottom: '1px solid #141414' }}>
                  <td style={{ ...TD, fontWeight: 600, color: '#d4f25a' }}>{a.display_name}</td>
                  <td style={{ ...TD, color: '#888', fontFamily: 'monospace', fontSize: '0.72rem' }}>{a.model_id}</td>
                  <td style={{ ...TD, color: '#666' }}>{a.provider}</td>
                  <td style={{ ...TD }}>{a.open}</td>
                  <td style={{ ...TD, color: '#888' }}>{a.closed}</td>
                  <td style={{ ...TD, fontWeight: 700 }}>
                    <span style={{ color: pnlColor(a.pnl) }}>{a.pnl !== 0 ? pnlStr(a.pnl) : '—'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* E. Selected Markets */}
      <section style={{ marginBottom: '28px' }}>
        <SectionHeader title={`Selected Markets (${selectedMarkets.length})`} />
        {selectedMarkets.length === 0 ? (
          <p style={{ color: '#555', fontSize: '0.8rem' }}>No selected markets — run Score Markets first.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {selectedMarkets.map((m: any) => {
              const openCount = openByMarket.get(m.market_id) ?? 0;
              const sentColors: Record<string, string> = { positive: '#4ade80', negative: '#f87171', neutral: '#9ca3af' };
              return (
                <div key={m.market_id} style={{
                  background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '5px',
                  padding: '10px 14px', display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap',
                }}>
                  <span style={{ flex: 1, minWidth: '200px', fontSize: '0.78rem', color: '#ccc' }}>
                    {m.title?.slice(0, 80)}
                  </span>
                  <span style={{ fontSize: '0.68rem', color: '#888' }}>
                    Score: <strong style={{ color: '#fbbf24' }}>{Number(m.score ?? 0).toFixed(0)}</strong>
                  </span>
                  {m.sentiment && (
                    <span style={{ fontSize: '0.68rem', color: sentColors[m.sentiment] ?? '#9ca3af' }}>
                      {m.sentiment}
                    </span>
                  )}
                  <span style={{ fontSize: '0.68rem', color: openCount > 0 ? '#4ade80' : '#444' }}>
                    {openCount} open
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* F. Position Log — last 20 closed */}
      <section style={{ marginBottom: '28px' }}>
        <SectionHeader title={`Position Log — Last ${Math.min(20, closedPositions.length)} Closed`} />
        {closedPositions.length === 0 ? (
          <p style={{ color: '#555', fontSize: '0.8rem' }}>No closed positions yet.</p>
        ) : (
          <div style={{ overflowX: 'auto', border: '1px solid #1a1a1a', borderRadius: '6px' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead style={{ background: '#0a0a0a' }}>
                <tr>
                  {['Market', 'Agent', 'Side', 'Entry', 'Size', 'P&L', 'Closed'].map(h => (
                    <th key={h} style={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {closedPositions.slice(0, 20).map((p: any) => {
                  const rlz   = Number(p.realized_pnl ?? 0);
                  const agent = agentMap.get(p.agent_id);
                  const title = marketTitles.get(p.market_id) ?? '—';
                  const holdMs = p.opened_at && p.closed_at
                    ? new Date(p.closed_at).getTime() - new Date(p.opened_at).getTime()
                    : null;
                  const holdH = holdMs !== null ? Math.round(holdMs / 3_600_000) : null;
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid #111' }}>
                      <td style={{ ...TD, maxWidth: '260px', color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {title.slice(0, 55)}
                      </td>
                      <td style={{ ...TD, color: '#d4f25a', fontSize: '0.72rem' }}>{agent?.display_name ?? '—'}</td>
                      <td style={TD}>
                        <span style={{
                          fontSize: '0.6rem', fontWeight: 700, padding: '2px 6px', borderRadius: '3px',
                          background: p.side === 'long' ? '#162716' : '#271616',
                          color:      p.side === 'long' ? '#4ade80' : '#f87171',
                        }}>
                          {p.side === 'long' ? '▲ LONG' : '▼ SHORT'}
                        </span>
                      </td>
                      <td style={{ ...TD, fontFamily: 'monospace', color: '#888', fontSize: '0.72rem' }}>
                        {p.avg_entry_price != null ? `${(Number(p.avg_entry_price)*100).toFixed(1)}%` : '—'}
                      </td>
                      <td style={{ ...TD, fontFamily: 'monospace', color: '#666', fontSize: '0.72rem' }}>
                        ${Number(p.cost_basis_usd ?? 0).toFixed(2)}
                      </td>
                      <td style={{ ...TD, fontWeight: 700 }}>
                        <span style={{ color: pnlColor(rlz) }}>{rlz !== 0 ? pnlStr(rlz) : '—'}</span>
                      </td>
                      <td style={{ ...TD, color: '#444', fontSize: '0.7rem' }}>
                        {p.closed_at ? new Date(p.closed_at).toLocaleDateString() : '—'}
                        {holdH !== null && <span style={{ color: '#333', marginLeft: '5px' }}>({holdH}h)</span>}
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
