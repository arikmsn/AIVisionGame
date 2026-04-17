/**
 * /forecast-arena/ledger — Paper trading ledger: wallets + live positions + transactions
 */

import { sfetch } from '@/lib/forecast/db';

export const dynamic = 'force-dynamic';

function pnlColor(n: number) {
  return n > 0 ? '#4ade80' : n < 0 ? '#f87171' : '#888';
}
function pnlStr(n: number) {
  return `${n >= 0 ? '+' : ''}$${n.toFixed(2)}`;
}
function pctStr(n: number) {
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
}

const TX_TYPE_COLOR: Record<string, string> = {
  open_position: '#4ade80',
  scale_in:      '#86efac',
  scale_out:     '#60a5fa',
  stop_loss:     '#f87171',
  expiry_exit:   '#f59e0b',
  close:         '#a78bfa',
};

const thStyle: React.CSSProperties = {
  padding:       '7px 10px',
  textAlign:     'left',
  color:         '#555',
  fontWeight:    500,
  whiteSpace:    'nowrap',
  fontSize:      '0.68rem',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  borderBottom:  '1px solid #222',
};

export default async function LedgerPage() {
  let openPositions: any[] = [];
  let transactions:  any[] = [];
  let wallets:       any[] = [];
  let agents:        any[] = [];
  let positionTicks: any[] = [];

  try {
    [openPositions, transactions, wallets, agents] = await Promise.all([
      sfetch('fa_v_open_positions?select=*&order=opened_at.desc').then((r: any) => Array.isArray(r) ? r : []),
      sfetch('fa_transactions?select=*&order=created_at.desc&limit=150').then((r: any) => Array.isArray(r) ? r : []),
      sfetch('fa_agent_wallets?select=*').then((r: any) => Array.isArray(r) ? r : []),
      sfetch('fa_agents?select=id,slug,display_name,model_id,provider,is_active').then((r: any) => Array.isArray(r) ? r : []),
    ]);

    if (openPositions.length > 0) {
      const posIds = openPositions.map((p: any) => p.position_id).join(',');
      positionTicks = await sfetch(
        `fa_position_ticks?position_id=in.(${posIds})&select=*&order=created_at.desc&limit=100`,
      ).then((r: any) => Array.isArray(r) ? r : []).catch(() => []);
    }
  } catch { /* tables may not exist yet */ }

  const agentMap       = new Map(agents.map((a: any) => [a.id, a]));
  const totalUnrealized = openPositions.reduce((s: number, p: any) => s + Number(p.unrealized_pnl || 0), 0);
  const totalRealized   = transactions
    .filter((t: any) => t.pnl_usd != null)
    .reduce((s: number, t: any) => s + Number(t.pnl_usd || 0), 0);

  return (
    <div>
      {/* ── Summary ── */}
      <div style={{ display: 'flex', gap: '14px', marginBottom: '28px', flexWrap: 'wrap' }}>
        {[
          { label: 'Open Positions', value: String(openPositions.length), color: '#f0f0f0' },
          { label: 'Unrealized P&L', value: pnlStr(totalUnrealized), color: pnlColor(totalUnrealized) },
          { label: 'Realized P&L', value: pnlStr(totalRealized), color: pnlColor(totalRealized) },
        ].map(card => (
          <div key={card.label} style={{ background: '#111', border: '1px solid #222', borderRadius: '6px', padding: '12px 20px' }}>
            <div style={{ fontSize: '0.63rem', color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{card.label}</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: card.color, marginTop: '4px' }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* ── Wallets ── */}
      <section style={{ marginBottom: '32px' }}>
        <h3 style={{ fontSize: '0.78rem', fontWeight: 600, color: '#555', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '10px' }}>
          Paper Wallets
        </h3>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {wallets.map((w: any) => {
            const agent = agentMap.get(w.agent_id);
            if (!agent?.is_active) return null;
            const bal = Number(w.paper_balance_usd);
            const delta = bal - 10000;
            return (
              <div key={w.id} style={{
                background: '#111', border: '1px solid #222', borderRadius: '6px', padding: '12px 18px', minWidth: '160px',
              }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#ccc' }}>{agent.display_name}</div>
                <div style={{ fontSize: '1.05rem', fontWeight: 700, marginTop: '4px' }}>
                  ${bal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div style={{ fontSize: '0.65rem', marginTop: '2px', color: pnlColor(delta) }}>
                  {delta >= 0 ? '+' : ''}{pctStr(delta / 10000)} vs start
                </div>
              </div>
            );
          }).filter(Boolean)}
        </div>
      </section>

      {/* ── Open Positions ── */}
      <section style={{ marginBottom: '32px' }}>
        <h3 style={{ fontSize: '0.78rem', fontWeight: 600, color: '#555', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '10px' }}>
          Open Positions ({openPositions.length})
        </h3>
        {openPositions.length === 0 ? (
          <p style={{ color: '#555', fontSize: '0.8rem' }}>
            No open positions. Positions open automatically after <code style={{ color: '#d4f25a' }}>run-round</code> when agent edge ≥ 10%.
          </p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    {['Agent', 'Market', 'Side', 'Size', 'Entry', 'Current', 'Unrealized', 'Realized', 'Ticks', 'Last', 'Age'].map(h => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {openPositions.map((p: any) => {
                    const unr   = Number(p.unrealized_pnl || 0);
                    const rlz   = Number(p.realized_pnl   || 0);
                    const pct   = p.cost_basis_usd > 0 ? unr / Number(p.cost_basis_usd) : 0;
                    const ageMs = Date.now() - new Date(p.opened_at).getTime();
                    const age   = ageMs < 3_600_000 ? `${Math.round(ageMs/60000)}m`
                      : ageMs < 86_400_000 ? `${Math.round(ageMs/3_600_000)}h`
                      : `${Math.round(ageMs/86_400_000)}d`;
                    return (
                      <tr key={p.position_id} style={{ borderBottom: '1px solid #141414' }}>
                        <td style={{ padding: '9px 10px', fontSize: '0.8rem', fontWeight: 600 }}>{p.agent_display_name}</td>
                        <td style={{ padding: '9px 10px', fontSize: '0.75rem', color: '#999', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.market_title}
                        </td>
                        <td style={{ padding: '9px 10px' }}>
                          <span style={{
                            fontSize: '0.65rem', fontWeight: 700, padding: '2px 6px', borderRadius: '3px',
                            background: p.side === 'long' ? '#1a2e1a' : '#2e1a1a',
                            color:      p.side === 'long' ? '#4ade80' : '#f87171',
                          }}>
                            {p.side === 'long' ? '▲ LONG' : '▼ SHORT'}
                          </span>
                        </td>
                        <td style={{ padding: '9px 10px', fontSize: '0.8rem' }}>${Number(p.size_usd || 0).toFixed(2)}</td>
                        <td style={{ padding: '9px 10px', fontSize: '0.8rem', color: '#888' }}>
                          {p.avg_entry_price != null ? `${(Number(p.avg_entry_price)*100).toFixed(1)}%` : '--'}
                        </td>
                        <td style={{ padding: '9px 10px', fontSize: '0.8rem' }}>
                          {p.current_price != null ? `${(Number(p.current_price)*100).toFixed(1)}%` : '--'}
                        </td>
                        <td style={{ padding: '9px 10px', fontSize: '0.85rem', fontWeight: 700 }}>
                          <span style={{ color: pnlColor(unr) }}>{pnlStr(unr)}</span>
                          <span style={{ color: '#555', fontSize: '0.65rem', marginLeft: '4px' }}>({pctStr(pct)})</span>
                        </td>
                        <td style={{ padding: '9px 10px', fontSize: '0.8rem', color: pnlColor(rlz) }}>
                          {rlz !== 0 ? pnlStr(rlz) : '—'}
                        </td>
                        <td style={{ padding: '9px 10px', fontSize: '0.8rem', color: '#888' }}>{p.tick_count ?? 0}</td>
                        <td style={{ padding: '9px 10px', fontSize: '0.7rem', color: '#666' }}>{p.last_action ?? 'open'}</td>
                        <td style={{ padding: '9px 10px', fontSize: '0.7rem', color: '#555' }}>{age}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {positionTicks.length > 0 && (
              <div style={{ marginTop: '12px', padding: '10px 14px', background: '#0a0a0a', borderRadius: '4px', border: '1px solid #1a1a1a' }}>
                <div style={{ fontSize: '0.65rem', color: '#444', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '6px' }}>
                  Tick history (latest {Math.min(positionTicks.length, 20)})
                </div>
                {positionTicks.slice(0, 20).map((t: any) => (
                  <div key={t.id} style={{ display: 'flex', gap: '10px', fontSize: '0.7rem', color: '#555', marginBottom: '3px', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'monospace', color: '#3a3a3a', minWidth: '150px' }}>
                      {new Date(t.created_at).toLocaleString()}
                    </span>
                    <span style={{ color: '#444' }}>#{t.tick_number}</span>
                    <span style={{
                      fontWeight: 600,
                      color: t.action === 'hold' ? '#555'
                        : t.action === 'scale_in' ? '#4ade80'
                        : t.action === 'scale_out' ? '#60a5fa'
                        : '#f87171',
                    }}>{t.action}</span>
                    <span style={{ color: '#666' }}>{(Number(t.market_price)*100).toFixed(1)}%</span>
                    {t.notes && <span style={{ color: '#444' }}>{t.notes}</span>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Transactions ── */}
      <section>
        <h3 style={{ fontSize: '0.78rem', fontWeight: 600, color: '#555', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '10px' }}>
          Transactions ({transactions.length})
        </h3>
        {transactions.length === 0 ? (
          <p style={{ color: '#555', fontSize: '0.8rem' }}>No transactions yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  {['Agent', 'Type', 'Side', 'Price', 'Size', 'P&L', 'Time'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx: any) => {
                  const agent = agentMap.get(tx.agent_id);
                  const pnl   = Number(tx.pnl_usd ?? 0);
                  return (
                    <tr key={tx.id} style={{ borderBottom: '1px solid #141414' }}>
                      <td style={{ padding: '7px 10px', fontSize: '0.78rem', fontWeight: 600 }}>{agent?.display_name ?? '--'}</td>
                      <td style={{ padding: '7px 10px', fontSize: '0.7rem', color: TX_TYPE_COLOR[tx.type] ?? '#888' }}>{tx.type}</td>
                      <td style={{ padding: '7px 10px', fontSize: '0.7rem', color: tx.side === 'yes' ? '#4ade80' : '#f87171' }}>
                        {tx.side ?? '--'}
                      </td>
                      <td style={{ padding: '7px 10px', fontSize: '0.78rem' }}>
                        {tx.market_price_at_entry != null ? `${(Number(tx.market_price_at_entry)*100).toFixed(1)}%` : '--'}
                      </td>
                      <td style={{ padding: '7px 10px', fontSize: '0.78rem' }}>${Number(tx.paper_size_usd || 0).toFixed(2)}</td>
                      <td style={{ padding: '7px 10px', fontSize: '0.78rem', color: pnlColor(pnl) }}>
                        {tx.pnl_usd != null ? pnlStr(pnl) : '—'}
                      </td>
                      <td style={{ padding: '7px 10px', fontSize: '0.7rem', color: '#555' }}>
                        {new Date(tx.created_at).toLocaleString()}
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
