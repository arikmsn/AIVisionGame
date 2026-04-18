/**
 * /forecast-arena/positions — פוזיציות
 *
 * Open + closed positions, each with full lifecycle timeline.
 * Every adjustment (scale-in, trim, exit) is shown with price and reason.
 */

import Link from 'next/link';
import { sfetch } from '@/lib/forecast/db';

export const dynamic = 'force-dynamic';

// ── Helpers ───────────────────────────────────────────────────────────────────

function pnlColor(n: number) { return n > 0 ? '#4ade80' : n < 0 ? '#f87171' : '#9ca3af'; }
function pnlStr(n: number) {
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}`;
}
function pctStr(n: number) {
  return `${n >= 0 ? '+' : ''}${(n*100).toFixed(1)}%`;
}

const ACTION_COLORS: Record<string, string> = {
  scale_in:    '#4ade80',
  scale_out:   '#60a5fa',
  stop_loss:   '#f87171',
  expiry_exit: '#f59e0b',
  close:       '#a78bfa',
  hold:        '#3a3a3a',
};
const ACTION_LABELS_HE: Record<string, string> = {
  scale_in:    'הגדלה',
  scale_out:   'קיצוץ',
  stop_loss:   'סטופ לוס',
  expiry_exit: 'יציאת פקיעה',
  close:       'סגירה',
  hold:        'המתנה',
};

function buildStory(pos: any, ticks: any[]): string {
  const sideHe = pos.side === 'long' ? 'LONG YES' : 'SHORT NO';
  const entry  = (Number(pos.avg_entry_price) * 100).toFixed(1);
  const cost   = Number(pos.cost_basis_usd).toFixed(2);
  const parts: string[] = [`נפתחה פוזיציית ${sideHe} ב-${entry}% עם $${cost}.`];

  for (const t of ticks) {
    const mp = (Number(t.market_price) * 100).toFixed(1);
    if (t.action === 'scale_in') {
      const delta = t.size_delta_usd ? `+$${Number(t.size_delta_usd).toFixed(2)}` : '';
      parts.push(`הגדלה ${delta} ב-${mp}% (טיק ${t.tick_number}).`);
    } else if (t.action === 'scale_out') {
      const rlz = t.realized_pnl != null ? `, ממומש ${pnlStr(Number(t.realized_pnl))}` : '';
      parts.push(`קוצצה 50% ב-${mp}%${rlz} (טיק ${t.tick_number}).`);
    } else if (t.action === 'stop_loss') {
      parts.push(`סטופ-לוס הופעל ב-${mp}% (טיק ${t.tick_number}).`);
    } else if (t.action === 'expiry_exit') {
      parts.push(`יציאה לפני פקיעה ב-${mp}% (טיק ${t.tick_number}).`);
    } else if (t.action === 'hold') {
      parts.push(`המתנה ב-${mp}% (טיק ${t.tick_number}).`);
    }
  }

  const totalPnl = Number(pos.realized_pnl || 0) +
    (pos.status === 'open' ? Number(pos.unrealized_pnl || 0) : 0);
  const retPct = pos.cost_basis_usd > 0 ? totalPnl / Number(pos.cost_basis_usd) : 0;

  if (pos.status === 'closed') {
    parts.push(`P&L סופי: ${pnlStr(totalPnl)} (${pctStr(retPct)}).`);
  } else {
    parts.push(`פתוחה — לא ממומש ${pnlStr(totalPnl)} (${pctStr(retPct)}).`);
  }
  return parts.join(' ');
}

const TH: React.CSSProperties = {
  padding: '6px 12px', textAlign: 'left', color: '#444',
  fontWeight: 500, fontSize: '0.6rem', letterSpacing: '0.05em',
  textTransform: 'uppercase', borderBottom: '1px solid #1a1a1a',
  whiteSpace: 'nowrap', background: '#0a0a0a',
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function PositionsPage() {
  let openPositions:   any[] = [];
  let closedPositions: any[] = [];
  let allTicks:        any[] = [];

  try {
    [openPositions, closedPositions] = await Promise.all([
      sfetch('fa_v_open_positions?select=*&order=opened_at.desc')
        .then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
      sfetch('fa_positions?status=eq.closed&select=*&order=closed_at.desc&limit=50')
        .then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
    ]);

    // Enrich closed positions with agent + market names
    if (closedPositions.length > 0) {
      const agentIds  = [...new Set(closedPositions.map((p: any) => p.agent_id))].join(',');
      const marketIds = [...new Set(closedPositions.map((p: any) => p.market_id))].join(',');
      const [agentsArr, marketsArr] = await Promise.all([
        sfetch(`fa_agents?id=in.(${agentIds})&select=id,slug,display_name`).then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
        sfetch(`fa_markets?id=in.(${marketIds})&select=id,title`).then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
      ]);
      const agentMap  = new Map(agentsArr.map((a: any) => [a.id, a]));
      const marketMap = new Map(marketsArr.map((m: any) => [m.id, m.title]));
      closedPositions = closedPositions.map((p: any) => ({
        ...p,
        agent_slug:         agentMap.get(p.agent_id)?.slug,
        agent_display_name: agentMap.get(p.agent_id)?.display_name ?? '--',
        market_title:       marketMap.get(p.market_id) ?? '--',
      }));
    }

    // Load all ticks for open + closed positions
    const allPosIds = [
      ...openPositions.map((p: any) => p.position_id),
      ...closedPositions.map((p: any) => p.id),
    ];
    if (allPosIds.length > 0) {
      allTicks = await sfetch(
        `fa_position_ticks?position_id=in.(${allPosIds.join(',')})&select=*&order=created_at.asc`,
      ).then((r: any) => Array.isArray(r) ? r : []).catch(() => []);
    }
  } catch { /* ok */ }

  const ticksByPos = new Map<string, any[]>();
  for (const t of allTicks) {
    if (!ticksByPos.has(t.position_id)) ticksByPos.set(t.position_id, []);
    ticksByPos.get(t.position_id)!.push(t);
  }

  const totalUnrealized = openPositions.reduce((s: number, p: any) => s + Number(p.unrealized_pnl || 0), 0);
  const totalRealized   = closedPositions.reduce((s: number, p: any) => s + Number(p.realized_pnl || 0), 0);

  // ── Position card component ────────────────────────────────────────────────

  function PositionCard({ p, ticks, idKey }: { p: any; ticks: any[]; idKey: string }) {
    const rlz     = Number(p.realized_pnl  || 0);
    const unr     = Number(p.unrealized_pnl || 0);
    const isOpen  = p.status === 'open';
    const totalPnl = rlz + (isOpen ? unr : 0);
    const ret     = p.cost_basis_usd > 0 ? totalPnl / Number(p.cost_basis_usd) : 0;
    const story   = buildStory(p, ticks);
    const ageMs   = Date.now() - new Date(p.opened_at).getTime();
    const ageName = p.agent_display_name;
    const agentSlug = p.agent_slug;
    const mktTitle = p.market_title ?? p.market_id;

    return (
      <div style={{
        background: '#0c0c0c',
        border: `1px solid ${isOpen ? '#1e2a1e' : '#1a1a1a'}`,
        borderRadius: '8px',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 18px',
          background: isOpen ? '#0d120d' : '#0a0a0a',
          borderBottom: '1px solid #1a1a1a',
          display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap',
        }}>
          <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#d4f25a' }}>
            {agentSlug ? (
              <Link href={`/forecast-arena/players/${agentSlug}`}
                style={{ color: '#d4f25a', textDecoration: 'none' }}>
                {ageName}
              </Link>
            ) : ageName}
          </span>
          <span style={{
            fontSize: '0.62rem', fontWeight: 700, padding: '2px 7px', borderRadius: '3px',
            background: p.side === 'long' ? '#162716' : '#271616',
            color:      p.side === 'long' ? '#4ade80' : '#f87171',
          }}>
            {p.side === 'long' ? '▲ LONG' : '▼ SHORT'}
          </span>
          <span style={{
            fontSize: '0.62rem', padding: '2px 7px', borderRadius: '3px',
            background: isOpen ? '#0e1f0e' : '#111',
            color:      isOpen ? '#4ade80' : '#555',
            border: `1px solid ${isOpen ? '#2a4a2a' : '#222'}`,
          }}>
            {isOpen ? 'פתוחה' : 'סגורה'}
          </span>
          <span style={{ color: '#666', fontSize: '0.72rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {mktTitle}
          </span>
          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: pnlColor(totalPnl), marginLeft: 'auto', whiteSpace: 'nowrap' }}>
            {pnlStr(totalPnl)}
            <span style={{ fontSize: '0.65rem', color: '#555', marginLeft: '4px' }}>
              ({pctStr(ret)})
            </span>
          </span>
        </div>

        {/* Metrics row */}
        <div style={{
          padding: '10px 18px',
          display: 'flex', gap: '24px', flexWrap: 'wrap',
          fontSize: '0.72rem', color: '#555',
          borderBottom: '1px solid #131313',
        }}>
          <span>כניסה <strong style={{ color: '#888', fontFamily: 'monospace' }}>
            {(Number(p.avg_entry_price||p.open_price)*100).toFixed(1)}%
          </strong></span>
          <span>עלות <strong style={{ color: '#888', fontFamily: 'monospace' }}>
            ${Number(p.cost_basis_usd).toFixed(2)}
          </strong></span>
          <span>חוזים <strong style={{ color: '#888', fontFamily: 'monospace' }}>
            {Number(p.contracts).toFixed(4)}
          </strong></span>
          {isOpen && p.current_price != null && (
            <span>נוכחי <strong style={{ color: '#aaa', fontFamily: 'monospace' }}>
              {(Number(p.current_price)*100).toFixed(1)}%
            </strong></span>
          )}
          {rlz !== 0 && (
            <span>ממומש <strong style={{ color: pnlColor(rlz) }}>{pnlStr(rlz)}</strong></span>
          )}
          {isOpen && unr !== 0 && (
            <span>לא ממומש <strong style={{ color: pnlColor(unr) }}>{pnlStr(unr)}</strong></span>
          )}
          <span>{ticks.length} טיקים</span>
          <span style={{ marginLeft: 'auto', color: '#444' }}>
            {isOpen
              ? `${Math.floor(ageMs/3600000)}ש מזה`
              : p.closed_at ? new Date(p.closed_at).toLocaleDateString('he-IL') : '--'}
          </span>
        </div>

        {/* Position story */}
        <div style={{
          padding: '10px 18px',
          fontSize: '0.68rem', color: '#555', lineHeight: 1.7,
          background: '#080808',
          borderBottom: '1px solid #111',
          fontStyle: 'italic',
          borderLeft: `3px solid ${isOpen ? '#1e4a1e' : '#2a2a2a'}`,
        }}>
          {story}
        </div>

        {/* Timeline */}
        <div style={{ padding: '14px 18px', overflowX: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', minWidth: 'max-content', gap: '0' }}>
            {/* t0 entry */}
            <TimelineNode
              label="כניסה"
              color="#d4f25a"
              line1={`${(Number(p.avg_entry_price||p.open_price)*100).toFixed(1)}%`}
              line2={`$${Number(p.cost_basis_usd).toFixed(0)}`}
            />
            {ticks.map((t: any) => (
              <TimelineNode
                key={t.id}
                label={`t${t.tick_number}`}
                sublabel={ACTION_LABELS_HE[t.action] ?? t.action}
                color={ACTION_COLORS[t.action] ?? '#555'}
                line1={`${(Number(t.market_price)*100).toFixed(1)}%`}
                line2={t.unrealized_pnl != null ? pnlStr(Number(t.unrealized_pnl)) : undefined}
                pnlColor={t.unrealized_pnl != null ? pnlColor(Number(t.unrealized_pnl)) : undefined}
                connector
              />
            ))}
            {p.status === 'closed' && ticks.length > 0 && (
              <TimelineNode
                label="סגירה"
                color={pnlColor(rlz)}
                line1={pnlStr(rlz)}
                connector
              />
            )}
            {ticks.length === 0 && (
              <div style={{ fontSize: '0.62rem', color: '#2a2a2a', paddingLeft: '16px', alignSelf: 'center' }}>
                ממתינה לטיק הבא (03:00 UTC)
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Summary bar */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '28px', flexWrap: 'wrap' }}>
        {[
          { label: 'פוזיציות פתוחות', value: String(openPositions.length), color: '#d4f25a' },
          { label: 'פוזיציות סגורות', value: String(closedPositions.length), color: '#888' },
          { label: 'לא ממומש', value: `${totalUnrealized >= 0 ? '+' : '-'}$${Math.abs(totalUnrealized).toFixed(2)}`, color: pnlColor(totalUnrealized) },
          { label: 'ממומש (סגורים)', value: `${totalRealized >= 0 ? '+' : '-'}$${Math.abs(totalRealized).toFixed(2)}`, color: pnlColor(totalRealized) },
        ].map(card => (
          <div key={card.label} style={{
            background: '#0e0e0e', border: '1px solid #1e1e1e',
            borderRadius: '8px', padding: '12px 20px', flex: '1 1 160px',
          }}>
            <div style={{ fontSize: '0.6rem', color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{card.label}</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: card.color, marginTop: '5px' }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Open Positions */}
      <section style={{ marginBottom: '40px' }}>
        <h2 style={{ fontSize: '0.82rem', fontWeight: 600, color: '#888', margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          פוזיציות פתוחות ({openPositions.length})
        </h2>
        {openPositions.length === 0 ? (
          <div style={{ padding: '28px', textAlign: 'center', color: '#444', fontSize: '0.82rem',
            background: '#0e0e0e', border: '1px solid #1a1a1a', borderRadius: '8px' }}>
            אין פוזיציות פתוחות.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {openPositions.map((p: any) => (
              <PositionCard
                key={p.position_id}
                p={{ ...p, id: p.position_id }}
                ticks={ticksByPos.get(p.position_id) ?? []}
                idKey={p.position_id}
              />
            ))}
          </div>
        )}
      </section>

      {/* Closed Positions */}
      <section>
        <h2 style={{ fontSize: '0.82rem', fontWeight: 600, color: '#555', margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          פוזיציות סגורות ({closedPositions.length})
        </h2>
        {closedPositions.length === 0 ? (
          <div style={{ padding: '28px', textAlign: 'center', color: '#333', fontSize: '0.82rem',
            background: '#0a0a0a', border: '1px solid #151515', borderRadius: '8px' }}>
            אין פוזיציות סגורות.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {closedPositions.map((p: any) => (
              <PositionCard
                key={p.id}
                p={p}
                ticks={ticksByPos.get(p.id) ?? []}
                idKey={p.id}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Timeline Node component ────────────────────────────────────────────────────

function TimelineNode({
  label, sublabel, color, line1, line2, pnlColor: pColor, connector = false,
}: {
  label: string; sublabel?: string; color: string;
  line1?: string; line2?: string; pnlColor?: string; connector?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start' }}>
      {connector && (
        <div style={{ width: '24px', height: '2px', background: '#1e1e1e', marginTop: '7px', flexShrink: 0 }} />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '72px' }}>
        <div style={{
          width: '12px', height: '12px', borderRadius: '50%',
          background: color, marginTop: '1px', flexShrink: 0,
          boxShadow: `0 0 6px ${color}44`,
        }} />
        <div style={{ fontSize: '0.56rem', marginTop: '4px', textAlign: 'center', lineHeight: 1.6 }}>
          <span style={{ color, fontWeight: 700 }}>{label}</span>
          {sublabel && <><br /><span style={{ color: color + 'bb' }}>{sublabel}</span></>}
          {line1 && <><br /><span style={{ color: '#666', fontFamily: 'monospace' }}>{line1}</span></>}
          {line2 && <><br /><span style={{ color: pColor ?? '#555', fontFamily: 'monospace' }}>{line2}</span></>}
        </div>
      </div>
    </div>
  );
}
