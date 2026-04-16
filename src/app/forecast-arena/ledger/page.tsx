/**
 * /forecast-arena/ledger — Paper trading ledger
 */

import { sfetch } from '@/lib/forecast/db';

export const dynamic = 'force-dynamic';

export default async function LedgerPage() {
  let transactions: any[] = [];
  let wallets: any[] = [];
  let agents: any[] = [];

  try {
    [transactions, wallets, agents] = await Promise.all([
      sfetch('fa_transactions?select=*&order=created_at.desc&limit=100').then((r: any) => Array.isArray(r) ? r : []),
      sfetch('fa_agent_wallets?select=*').then((r: any) => Array.isArray(r) ? r : []),
      sfetch('fa_agents?select=id,slug,display_name').then((r: any) => Array.isArray(r) ? r : []),
    ]);
  } catch { /* ok */ }

  const agentMap = new Map(agents.map((a: any) => [a.id, a]));

  return (
    <div>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '16px', color: '#ccc' }}>
        Paper Trading Ledger
      </h2>

      {/* Wallets */}
      <section style={{ marginBottom: '28px' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#999' }}>
          Wallets
        </h3>
        {wallets.length === 0 ? (
          <p style={{ color: '#555', fontSize: '0.8rem' }}>No wallets. Seed agents first.</p>
        ) : (
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {wallets.map((w: any) => {
              const agent = agentMap.get(w.agent_id);
              return (
                <div key={w.id} style={{
                  background: '#111', border: '1px solid #222', borderRadius: '6px', padding: '12px 16px', minWidth: '180px',
                }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{agent?.display_name ?? w.agent_id?.slice(0, 8)}</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '4px' }}>
                    ${Number(w.paper_balance_usd).toLocaleString()}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: '#666', marginTop: '2px' }}>
                    Notional: ${Number(w.total_notional_usd).toLocaleString()}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Transactions */}
      <section>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#999' }}>
          Transactions ({transactions.length})
        </h3>
        {transactions.length === 0 ? (
          <p style={{ color: '#555', fontSize: '0.8rem' }}>
            No transactions yet. Transactions are created when agents make paper trades.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #333' }}>
                  {['Agent', 'Type', 'Side', 'Price', 'Size', 'PnL', 'Time'].map(h => (
                    <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: '#666', fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx: any) => {
                  const agent = agentMap.get(tx.agent_id);
                  return (
                    <tr key={tx.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                      <td style={{ padding: '6px 10px' }}>{agent?.display_name ?? '--'}</td>
                      <td style={{ padding: '6px 10px' }}>{tx.type}</td>
                      <td style={{ padding: '6px 10px', color: tx.side === 'yes' ? '#4ade80' : '#f87171' }}>{tx.side ?? '--'}</td>
                      <td style={{ padding: '6px 10px' }}>{tx.market_price_at_entry != null ? `${(Number(tx.market_price_at_entry) * 100).toFixed(1)}%` : '--'}</td>
                      <td style={{ padding: '6px 10px' }}>${Number(tx.paper_size_usd || 0).toFixed(2)}</td>
                      <td style={{ padding: '6px 10px', color: Number(tx.pnl_usd) > 0 ? '#4ade80' : Number(tx.pnl_usd) < 0 ? '#f87171' : '#888' }}>
                        {tx.pnl_usd != null ? `$${Number(tx.pnl_usd).toFixed(2)}` : '--'}
                      </td>
                      <td style={{ padding: '6px 10px', color: '#888' }}>{new Date(tx.created_at).toLocaleString()}</td>
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
