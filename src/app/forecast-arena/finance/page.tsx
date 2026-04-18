/**
 * /forecast-arena/finance — כספים
 *
 * Central bankroll financial state.
 * Shows total/free/allocated capital, per-model P&L breakdown,
 * per-market allocation, and clearly separates trading capital from API spend.
 */

import { sfetch } from '@/lib/forecast/db';

export const dynamic = 'force-dynamic';

// ── Helpers ───────────────────────────────────────────────────────────────────

function pnlColor(n: number) { return n > 0 ? '#4ade80' : n < 0 ? '#f87171' : '#9ca3af'; }
function pnlStr(n: number)   { return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}`; }
function usd(n: number, dec = 2) {
  return `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

function BigCard({
  label, value, sub, color, pct, pctColor,
}: {
  label: string; value: string; sub?: string;
  color?: string; pct?: string; pctColor?: string;
}) {
  return (
    <div style={{
      background: '#0e0e0e', border: '1px solid #1e1e1e',
      borderRadius: '10px', padding: '20px 24px', flex: '1 1 180px',
    }}>
      <div style={{ fontSize: '0.6rem', color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.6rem', fontWeight: 700, color: color ?? '#e8e8e8', lineHeight: 1, fontFamily: 'monospace' }}>
        {value}
      </div>
      {pct && (
        <div style={{ fontSize: '0.72rem', color: pctColor ?? '#555', marginTop: '4px' }}>{pct}</div>
      )}
      {sub && (
        <div style={{ fontSize: '0.62rem', color: '#444', marginTop: '4px' }}>{sub}</div>
      )}
    </div>
  );
}

const TH: React.CSSProperties = {
  padding: '7px 14px', textAlign: 'left', color: '#444',
  fontWeight: 500, fontSize: '0.6rem', letterSpacing: '0.05em',
  textTransform: 'uppercase', borderBottom: '1px solid #1a1a1a',
  background: '#0a0a0a', whiteSpace: 'nowrap',
};
const TD: React.CSSProperties = { padding: '9px 14px', fontSize: '0.78rem' };

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function FinancePage() {
  let bankroll:       any   = null;
  let openPositions:  any[] = [];
  let allPositions:   any[] = [];
  let transactions:   any[] = [];
  let llmCosts:       any[] = [];

  try {
    [bankroll, openPositions, allPositions, transactions, llmCosts] = await Promise.all([
      sfetch('fa_central_bankroll?select=*&limit=1')
        .then((r: any) => Array.isArray(r) ? r[0] ?? null : null).catch(() => null),
      sfetch('fa_v_open_positions?select=position_id,agent_id,agent_display_name,market_title,side,cost_basis_usd,unrealized_pnl,realized_pnl&order=cost_basis_usd.desc')
        .then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
      sfetch('fa_v_position_summary?select=*')
        .then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
      sfetch('fa_transactions?select=agent_id,type,paper_size_usd,pnl_usd,created_at&order=created_at.desc&limit=100')
        .then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
      sfetch('fa_submissions?select=agent_id,cost_usd,input_tokens,output_tokens&limit=2000')
        .then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
    ]);
  } catch { /* ok */ }

  // ── Computed values ────────────────────────────────────────────────────────

  const totalDeposit  = Number(bankroll?.total_deposit_usd  ?? 60000);
  const availableUsd  = Number(bankroll?.available_usd       ?? 60000);
  const allocatedUsd  = Number(bankroll?.allocated_usd       ?? 0);
  const realizedPnl   = Number(bankroll?.total_realized_pnl  ?? 0);
  const unrealizedPnl = openPositions.reduce((s: number, p: any) => s + Number(p.unrealized_pnl || 0), 0);
  const netPnl        = realizedPnl + unrealizedPnl;
  const netValue      = totalDeposit + netPnl;

  // Capital by market
  const byMarket = new Map<string, { name: string; allocated: number; pnl: number; count: number }>();
  for (const p of openPositions) {
    const key = p.market_title ?? '--';
    if (!byMarket.has(key)) byMarket.set(key, { name: key, allocated: 0, pnl: 0, count: 0 });
    const entry = byMarket.get(key)!;
    entry.allocated += Number(p.cost_basis_usd || 0);
    entry.pnl       += Number(p.unrealized_pnl || 0);
    entry.count++;
  }
  const marketRows = [...byMarket.values()].sort((a, b) => b.allocated - a.allocated);

  // Capital by model (from position summary view)
  const modelRows = allPositions.filter((r: any) => Number(r.open_positions) > 0 || Number(r.total_deployed_usd) > 0);

  // LLM costs by model
  const llmByAgent = new Map<string, { cost: number; calls: number; tokens: number }>();
  for (const s of llmCosts) {
    if (!llmByAgent.has(s.agent_id)) llmByAgent.set(s.agent_id, { cost: 0, calls: 0, tokens: 0 });
    const entry = llmByAgent.get(s.agent_id)!;
    entry.cost   += Number(s.cost_usd || 0);
    entry.calls  += 1;
    entry.tokens += (Number(s.input_tokens || 0) + Number(s.output_tokens || 0));
  }

  // Enrich with agent names
  let agentNames = new Map<string, string>();
  try {
    const agentIds = [...new Set([
      ...allPositions.map((r: any) => r.agent_id),
      ...llmCosts.map((s: any) => s.agent_id),
    ])].filter(Boolean);
    if (agentIds.length > 0) {
      const agents = await sfetch(`fa_agents?id=in.(${agentIds.join(',')})&select=id,display_name`)
        .then((r: any) => Array.isArray(r) ? r : []).catch(() => []);
      agentNames = new Map(agents.map((a: any) => [a.id, a.display_name]));
    }
  } catch { /* ok */ }

  const totalLlmCost = llmCosts.reduce((s: number, c: any) => s + Number(c.cost_usd || 0), 0);

  // Recent transactions (closing events only, for realized P&L trail)
  const closingTx = transactions.filter((t: any) =>
    ['stop_loss','expiry_exit','close','scale_out'].includes(t.type) && t.pnl_usd != null,
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e8e8e8', margin: 0 }}>כספים</h1>
        <p style={{ color: '#555', fontSize: '0.73rem', marginTop: '4px' }}>
          מאגר הון מרכזי — הון מסחר בנפרד מעלויות LLM
        </p>
      </div>

      {/* ── Central Bankroll ── */}
      <section style={{ marginBottom: '36px' }}>
        <h2 style={{ fontSize: '0.72rem', fontWeight: 600, color: '#555', margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          מאגר הון מרכזי
        </h2>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <BigCard
            label="שווי תיק נטו"
            value={usd(netValue)}
            color={netPnl >= 0 ? '#d4f25a' : '#f87171'}
            pct={`${netPnl >= 0 ? '+' : ''}${((netPnl/totalDeposit)*100).toFixed(2)}% מפיקדון`}
            pctColor={pnlColor(netPnl)}
          />
          <BigCard
            label="מזומן פנוי"
            value={usd(availableUsd)}
            sub={`${((availableUsd/totalDeposit)*100).toFixed(1)}% מהפיקדון`}
          />
          <BigCard
            label="הון מושקע"
            value={usd(allocatedUsd)}
            color="#fbbf24"
            sub={`${openPositions.length} פוזיציות פתוחות`}
          />
          <BigCard
            label="P&L לא ממומש"
            value={pnlStr(unrealizedPnl)}
            color={pnlColor(unrealizedPnl)}
          />
          <BigCard
            label="P&L ממומש"
            value={pnlStr(realizedPnl)}
            color={pnlColor(realizedPnl)}
            sub="הצטבר מסגירות"
          />
          <BigCard
            label="פיקדון מקורי"
            value={usd(totalDeposit)}
            color="#666"
          />
        </div>
      </section>

      {/* ── Capital by Market ── */}
      {marketRows.length > 0 && (
        <section style={{ marginBottom: '36px' }}>
          <h2 style={{ fontSize: '0.72rem', fontWeight: 600, color: '#555', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            הון לפי שוק (פוזיציות פתוחות)
          </h2>
          <div style={{ border: '1px solid #1a1a1a', borderRadius: '6px', overflow: 'hidden' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  {['שוק', 'פוזיציות', 'הון מושקע', '% מהתיק', 'P&L לא ממומש'].map(h => (
                    <th key={h} style={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {marketRows.map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #131313' }}>
                    <td style={{ ...TD, color: '#ccc', maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.name}
                    </td>
                    <td style={{ ...TD, color: '#888' }}>{row.count}</td>
                    <td style={{ ...TD, fontFamily: 'monospace' }}>{usd(row.allocated)}</td>
                    <td style={{ ...TD, color: '#888' }}>
                      {totalDeposit > 0 ? `${(row.allocated/totalDeposit*100).toFixed(2)}%` : '--'}
                    </td>
                    <td style={{ ...TD, fontFamily: 'monospace', color: pnlColor(row.pnl) }}>
                      {pnlStr(row.pnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Capital by Model (analytical) ── */}
      {modelRows.length > 0 && (
        <section style={{ marginBottom: '36px' }}>
          <h2 style={{ fontSize: '0.72rem', fontWeight: 600, color: '#555', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            ביצועים לפי מודל (אנליטיקה בלבד — אין ארנקות נפרדים)
          </h2>
          <div style={{ border: '1px solid #1a1a1a', borderRadius: '6px', overflow: 'hidden' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  {['מודל', 'פוזיציות פתוחות', 'פוזיציות סגורות', 'הון פרוס', 'P&L ממומש', 'P&L לא ממומש', 'P&L כולל'].map(h => (
                    <th key={h} style={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {modelRows.map((row: any) => {
                  const name    = agentNames.get(row.agent_id) ?? row.slug ?? '--';
                  const realPnl = Number(row.total_realized_pnl || 0);
                  const unrPnl  = Number(row.total_unrealized_pnl || 0);
                  const totalPnl = realPnl + unrPnl;
                  return (
                    <tr key={row.agent_id} style={{ borderBottom: '1px solid #131313' }}>
                      <td style={{ ...TD, fontWeight: 600, color: '#d4f25a' }}>{name}</td>
                      <td style={{ ...TD, color: '#888' }}>{row.open_positions}</td>
                      <td style={{ ...TD, color: '#666' }}>{row.closed_positions}</td>
                      <td style={{ ...TD, fontFamily: 'monospace' }}>
                        {usd(Number(row.total_deployed_usd || 0))}
                      </td>
                      <td style={{ ...TD, fontFamily: 'monospace', color: pnlColor(realPnl) }}>
                        {pnlStr(realPnl)}
                      </td>
                      <td style={{ ...TD, fontFamily: 'monospace', color: pnlColor(unrPnl) }}>
                        {pnlStr(unrPnl)}
                      </td>
                      <td style={{ ...TD, fontFamily: 'monospace', fontWeight: 700, color: pnlColor(totalPnl) }}>
                        {pnlStr(totalPnl)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: '0.62rem', color: '#333', marginTop: '8px', paddingRight: '4px' }}>
            * הנתונים לעיל הם ניתוחיים בלבד. ההון אינו מחולק לארנקות נפרדים לפי מודל — כולם מושכים מאותו מאגר הון מרכזי.
          </p>
        </section>
      )}

      {/* ── API / LLM Costs — Separated from trading capital ── */}
      <section style={{ marginBottom: '36px' }}>
        <h2 style={{ fontSize: '0.72rem', fontWeight: 600, color: '#555', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          עלויות API / LLM — נפרד מהון המסחר
        </h2>

        <div style={{
          padding: '12px 18px', background: '#0e0e0e',
          border: '1px solid #1e1e1e', borderRadius: '8px',
          marginBottom: '14px', display: 'flex', gap: '28px', flexWrap: 'wrap',
        }}>
          <div>
            <div style={{ fontSize: '0.6rem', color: '#555', textTransform: 'uppercase', marginBottom: '4px' }}>סה&quot;כ עלות API</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#f59e0b', fontFamily: 'monospace' }}>
              ${totalLlmCost.toFixed(4)}
            </div>
            <div style={{ fontSize: '0.62rem', color: '#444', marginTop: '3px' }}>
              {llmCosts.length} קריאות · הון מסחר נפרד לחלוטין
            </div>
          </div>
          <div style={{ borderLeft: '1px solid #1a1a1a', paddingLeft: '28px' }}>
            <div style={{ fontSize: '0.6rem', color: '#444', marginBottom: '6px', textTransform: 'uppercase' }}>לפי מודל</div>
            {[...llmByAgent.entries()].map(([agentId, data]) => (
              <div key={agentId} style={{ display: 'flex', gap: '12px', fontSize: '0.7rem', marginBottom: '4px', color: '#555' }}>
                <span style={{ minWidth: '180px', color: '#777' }}>{agentNames.get(agentId) ?? agentId.slice(0, 8)}</span>
                <span style={{ fontFamily: 'monospace', color: '#f59e0b' }}>${data.cost.toFixed(4)}</span>
                <span style={{ color: '#444' }}>{data.calls} קריאות</span>
                <span style={{ color: '#333' }}>{(data.tokens / 1000).toFixed(1)}K tokens</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{
          padding: '10px 16px', background: '#080808',
          border: '1px solid #141414', borderRadius: '6px',
          fontSize: '0.68rem', color: '#333', lineHeight: 1.8,
        }}>
          <strong style={{ color: '#444' }}>הבחנה חשובה:</strong>{' '}
          עלויות ה-API הן הוצאה תפעולית על קריאות LLM לצורך ניתוח שווקים.
          הן אינן נלקחות מהון המסחר ואינן מופחתות מ-P&L הפוזיציות.
          הון המסחר (${usd(totalDeposit)}) הוא הון נייר ייעודי לסימולציית מסחר.
        </div>
      </section>

      {/* ── Recent Realized P&L Events ── */}
      {closingTx.length > 0 && (
        <section>
          <h2 style={{ fontSize: '0.72rem', fontWeight: 600, color: '#444', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            אירועי P&L ממומש אחרונים
          </h2>
          <div style={{ border: '1px solid #141414', borderRadius: '6px', overflow: 'hidden' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  {['סוג', 'גודל', 'P&L', 'תאריך'].map(h => (
                    <th key={h} style={{ ...TH, color: '#333' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {closingTx.slice(0, 20).map((t: any, i: number) => {
                  const pnl = Number(t.pnl_usd || 0);
                  const typeColors: Record<string, string> = {
                    stop_loss:   '#f87171',
                    expiry_exit: '#f59e0b',
                    close:       '#a78bfa',
                    scale_out:   '#60a5fa',
                  };
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid #0f0f0f' }}>
                      <td style={{ ...TD, color: typeColors[t.type] ?? '#666', fontSize: '0.72rem' }}>
                        {t.type}
                      </td>
                      <td style={{ ...TD, fontFamily: 'monospace', color: '#666', fontSize: '0.72rem' }}>
                        ${Number(t.paper_size_usd || 0).toFixed(2)}
                      </td>
                      <td style={{ ...TD, fontFamily: 'monospace', fontWeight: 600 }}>
                        <span style={{ color: pnlColor(pnl) }}>{pnlStr(pnl)}</span>
                      </td>
                      <td style={{ ...TD, color: '#444', fontSize: '0.68rem' }}>
                        {new Date(t.created_at).toLocaleDateString('he-IL')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
