/**
 * /forecast-arena/decisions — החלטות מודלים
 *
 * Shows every analyzed market with what each model said, why,
 * and whether a position was opened or not — with plain-language explanations.
 */

import Link from 'next/link';
import { sfetch } from '@/lib/forecast/db';

export const dynamic = 'force-dynamic';

// ── Helpers ───────────────────────────────────────────────────────────────────

const MIN_EDGE = 0.10; // must match positions.ts constant

function edgeExplanation(
  agentProb: number,
  marketPrice: number,
  positionOpened: boolean,
  side: string | null,
  sizeUsd: number | null,
  noReason: string | null,
): { text: string; color: string } {
  const edge = agentProb - marketPrice;
  const absEdge = Math.abs(edge);
  const dir = edge > 0 ? 'גבוה מ' : 'נמוך מ';
  const sideLabel = side === 'long' ? 'LONG (YES)' : 'SHORT (NO)';

  if (positionOpened && side) {
    return {
      text: `הסוכן העריך ${(agentProb*100).toFixed(1)}% לעומת שוק ${(marketPrice*100).toFixed(1)}%, יתרון ${(absEdge*100).toFixed(1)}% — נפתחה פוזיציית ${sideLabel} בגובה $${sizeUsd?.toFixed(2) ?? '--'}`,
      color: side === 'long' ? '#4ade80' : '#f87171',
    };
  }
  if (noReason) {
    return {
      text: `הסוכן העריך ${(agentProb*100).toFixed(1)}% לעומת שוק ${(marketPrice*100).toFixed(1)}%, יתרון ${(absEdge*100).toFixed(1)}% — לא נפתחה פוזיציה (${noReason})`,
      color: '#555',
    };
  }
  return {
    text: `הסוכן העריך ${(agentProb*100).toFixed(1)}% לעומת שוק ${(marketPrice*100).toFixed(1)}% — לא נפתחה פוזיציה`,
    color: '#444',
  };
}

function pnlColor(n: number) { return n > 0 ? '#4ade80' : n < 0 ? '#f87171' : '#9ca3af'; }

const ACTION_LABELS: Record<string, { he: string; color: string }> = {
  strong_yes: { he: 'כן חזק',    color: '#4ade80' },
  lean_yes:   { he: 'נטייה כן', color: '#86efac' },
  hold:       { he: 'המתן',      color: '#9ca3af' },
  lean_no:    { he: 'נטייה לא', color: '#fca5a5' },
  strong_no:  { he: 'לא חזק',   color: '#f87171' },
};

const TH: React.CSSProperties = {
  padding: '6px 12px', textAlign: 'left', color: '#444',
  fontWeight: 500, fontSize: '0.6rem', letterSpacing: '0.05em',
  textTransform: 'uppercase', borderBottom: '1px solid #1a1a1a',
  whiteSpace: 'nowrap', background: '#0a0a0a',
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function DecisionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string }>;
}) {
  const sp       = await (searchParams ?? Promise.resolve({}));
  const page     = Math.max(1, Number(sp.page ?? 1));
  const pageSize = 10;
  const offset   = (page - 1) * pageSize;

  let rounds:      any[] = [];
  let submissions: any[] = [];
  let agents:      any[] = [];
  let positions:   any[] = [];
  let totalCount   = 0;

  try {
    // Count total rounds for pagination
    const countRes = await sfetch('fa_rounds?select=id').then((r: any) => Array.isArray(r) ? r : []).catch(() => []);
    totalCount = countRes.length;

    [rounds, agents] = await Promise.all([
      sfetch(`fa_v_round_summary?select=round_id,round_number,market_id,market_title,market_category,market_yes_price_at_open,current_yes_price,round_status,opened_at,resolved_at&order=opened_at.desc&limit=${pageSize}&offset=${offset}`)
        .then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
      sfetch('fa_agents?select=id,slug,display_name,model_id,provider&is_active=eq.true')
        .then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
    ]);

    if (rounds.length > 0) {
      const roundIds = rounds.map((r: any) => r.round_id).join(',');
      [submissions, positions] = await Promise.all([
        sfetch(`fa_submissions?round_id=in.(${roundIds})&select=*&order=submitted_at.asc`)
          .then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
        sfetch(`fa_positions?round_id=in.(${roundIds})&select=id,agent_id,submission_id,side,cost_basis_usd,realized_pnl,unrealized_pnl,status,avg_entry_price`)
          .then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
      ]);
    }
  } catch { /* ok */ }

  const agentMap  = new Map(agents.map((a: any) => [a.id, a]));
  const subsByRound = new Map<string, any[]>();
  for (const s of submissions) {
    if (!subsByRound.has(s.round_id)) subsByRound.set(s.round_id, []);
    subsByRound.get(s.round_id)!.push(s);
  }
  const possBySubmission = new Map(positions.map((p: any) => [p.submission_id, p]));

  const totalPages = Math.ceil(totalCount / pageSize);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e8e8e8', margin: 0 }}>
            החלטות מודלים
          </h1>
          <p style={{ color: '#555', fontSize: '0.73rem', marginTop: '4px' }}>
            כל שוק שנותח — מה כל מודל העריך, למה, ומה נפתח
          </p>
        </div>
        <div style={{ fontSize: '0.7rem', color: '#444' }}>
          {totalCount} סבבים סה&quot;כ
        </div>
      </div>

      {rounds.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#444', fontSize: '0.85rem',
          background: '#0e0e0e', border: '1px solid #1a1a1a', borderRadius: '8px' }}>
          אין סבבי ניתוח עדיין. לחץ &ldquo;צור סבב&rdquo; ואז &ldquo;הרץ סבב&rdquo; בלוח השליטה.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {rounds.map((round: any) => {
            const subs       = subsByRound.get(round.round_id) ?? [];
            const marketPrice = Number(round.market_yes_price_at_open ?? 0);
            const positionsOpened = subs.filter((s: any) => possBySubmission.has(s.id)).length;

            return (
              <div key={round.round_id} style={{
                background: '#0c0c0c', border: '1px solid #1e1e1e',
                borderRadius: '8px', overflow: 'hidden',
              }}>
                {/* Round header */}
                <div style={{
                  padding: '14px 18px',
                  background: '#0e0e0e',
                  borderBottom: '1px solid #1a1a1a',
                  display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap',
                }}>
                  <div style={{ minWidth: '50px' }}>
                    <div style={{ fontSize: '0.58rem', color: '#444' }}>סבב</div>
                    <div style={{ fontFamily: 'monospace', color: '#777', fontWeight: 700, fontSize: '0.9rem' }}>
                      #{round.round_number}
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: '240px' }}>
                    <Link href={`/forecast-arena/rounds/${round.round_id}`} style={{ textDecoration: 'none' }}>
                      <div style={{ fontSize: '0.88rem', fontWeight: 600, color: '#d4f25a' }}>
                        {round.market_title}
                      </div>
                    </Link>
                    <div style={{ fontSize: '0.63rem', color: '#555', marginTop: '3px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      <span>
                        מחיר YES בפתיחה: <strong style={{ color: '#888' }}>
                          {marketPrice > 0 ? `${(marketPrice*100).toFixed(1)}%` : '--'}
                        </strong>
                      </span>
                      {round.market_category && <span style={{ color: '#444' }}>{round.market_category}</span>}
                      <span>{new Date(round.opened_at).toLocaleDateString('he-IL')}{' '}
                        {new Date(round.opened_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <span style={{
                      fontSize: '0.62rem', padding: '2px 8px', borderRadius: '3px',
                      background: positionsOpened > 0 ? '#162716' : '#111',
                      color: positionsOpened > 0 ? '#4ade80' : '#444',
                      border: `1px solid ${positionsOpened > 0 ? '#2a4a2a' : '#1a1a1a'}`,
                    }}>
                      {positionsOpened > 0 ? `נפתחו ${positionsOpened} פוזיציות` : 'לא נפתחו פוזיציות'}
                    </span>
                    <span style={{
                      fontSize: '0.62rem', padding: '2px 8px', borderRadius: '3px',
                      background: '#111',
                      color: round.round_status === 'resolved' ? '#60a5fa'
                        : round.round_status === 'completed' ? '#888'
                        : '#fbbf24',
                    }}>
                      {round.round_status}
                    </span>
                  </div>
                </div>

                {/* Submissions table */}
                {subs.length > 0 ? (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                      <thead>
                        <tr>
                          {['מודל', 'הסתברות', 'יתרון', 'ביטחון', 'המלצה', 'פוזיציה', 'הסבר', 'נימוק'].map(h => (
                            <th key={h} style={TH}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {subs.map((sub: any) => {
                          const agent    = agentMap.get(sub.agent_id);
                          const pos      = possBySubmission.get(sub.id);
                          const prob     = Number(sub.probability_yes ?? 0);
                          const edge     = prob - marketPrice;
                          const absEdge  = Math.abs(edge);
                          const hasPos   = !!pos;
                          const hasError = !!sub.error_text;
                          const actionInfo = ACTION_LABELS[sub.action] ?? { he: sub.action ?? '--', color: '#666' };
                          const explanation = !hasError ? edgeExplanation(
                            prob, marketPrice, hasPos,
                            pos?.side ?? null,
                            pos ? Number(pos.cost_basis_usd) : null,
                            !hasPos && !hasError
                              ? (absEdge < MIN_EDGE ? `יתרון ${(absEdge*100).toFixed(1)}% < סף 10%` : null)
                              : null,
                          ) : { text: `שגיאה: ${sub.error_text?.slice(0, 80)}`, color: '#f87171' };

                          return (
                            <tr key={sub.id} style={{
                              borderBottom: '1px solid #131313',
                              opacity: hasError ? 0.5 : 1,
                              background: hasPos ? (pos.side === 'long' ? '#0d140d' : '#140d0d') : 'transparent',
                            }}>
                              {/* Model name */}
                              <td style={{ padding: '9px 12px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                {agent ? (
                                  <Link href={`/forecast-arena/players/${agent.slug}`}
                                    style={{ color: '#ccc', textDecoration: 'none', fontSize: '0.78rem' }}>
                                    {agent.display_name}
                                  </Link>
                                ) : <span style={{ color: '#555', fontSize: '0.75rem' }}>{sub.agent_id?.slice(0, 8)}</span>}
                              </td>

                              {/* Probability */}
                              <td style={{ padding: '9px 12px', fontFamily: 'monospace', fontWeight: 700, fontSize: '0.85rem' }}>
                                <span style={{ color: prob > marketPrice ? '#4ade80' : prob < marketPrice ? '#f87171' : '#888' }}>
                                  {(prob*100).toFixed(1)}%
                                </span>
                              </td>

                              {/* Edge */}
                              <td style={{ padding: '9px 12px', fontFamily: 'monospace', fontSize: '0.78rem' }}>
                                <span style={{ color: pnlColor(edge) }}>
                                  {edge >= 0 ? '+' : ''}{(edge*100).toFixed(1)}%
                                </span>
                                {absEdge >= MIN_EDGE && (
                                  <span style={{ color: '#333', fontSize: '0.55rem', marginLeft: '3px' }}>✓</span>
                                )}
                              </td>

                              {/* Confidence */}
                              <td style={{ padding: '9px 12px', color: '#666', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                                {sub.confidence != null ? Number(sub.confidence).toFixed(2) : '--'}
                              </td>

                              {/* Action */}
                              <td style={{ padding: '9px 12px' }}>
                                <span style={{
                                  fontSize: '0.65rem', fontWeight: 700,
                                  color: actionInfo.color,
                                }}>
                                  {actionInfo.he}
                                </span>
                              </td>

                              {/* Position opened */}
                              <td style={{ padding: '9px 12px' }}>
                                {hasPos ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    <span style={{
                                      fontSize: '0.62rem', fontWeight: 700, padding: '2px 6px', borderRadius: '3px',
                                      background: pos.side === 'long' ? '#162716' : '#271616',
                                      color:      pos.side === 'long' ? '#4ade80' : '#f87171',
                                      whiteSpace: 'nowrap',
                                    }}>
                                      {pos.side === 'long' ? '▲ LONG' : '▼ SHORT'}
                                    </span>
                                    <span style={{ fontSize: '0.58rem', color: '#555', fontFamily: 'monospace' }}>
                                      ${Number(pos.cost_basis_usd).toFixed(2)}
                                    </span>
                                    {/* P&L if available */}
                                    {(Number(pos.realized_pnl) !== 0 || Number(pos.unrealized_pnl) !== 0) && (
                                      <span style={{
                                        fontSize: '0.58rem', fontFamily: 'monospace',
                                        color: pnlColor(Number(pos.realized_pnl) + Number(pos.unrealized_pnl)),
                                      }}>
                                        {(() => {
                                          const t = Number(pos.realized_pnl || 0) + (pos.status === 'open' ? Number(pos.unrealized_pnl || 0) : 0);
                                          return `${t >= 0 ? '+' : ''}$${Math.abs(t).toFixed(2)}`;
                                        })()}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span style={{ fontSize: '0.65rem', color: '#333' }}>—</span>
                                )}
                              </td>

                              {/* Plain-language explanation */}
                              <td style={{
                                padding: '9px 12px', fontSize: '0.65rem',
                                color: explanation.color, lineHeight: 1.5,
                                maxWidth: '300px',
                              }}>
                                {explanation.text}
                              </td>

                              {/* Rationale short */}
                              <td style={{
                                padding: '9px 12px', fontSize: '0.65rem',
                                color: '#4a4a4a', maxWidth: '220px',
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}>
                                {hasError
                                  ? <span style={{ color: '#7a2a2a' }}>{sub.error_text?.slice(0, 80)}</span>
                                  : (sub.rationale_short ?? '--')}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ padding: '16px 18px', color: '#444', fontSize: '0.75rem' }}>
                    אין הגשות עדיין לסבב זה.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '28px' }}>
          {page > 1 && (
            <Link href={`?page=${page-1}`} style={{
              padding: '6px 14px', background: '#111', border: '1px solid #222',
              borderRadius: '4px', color: '#888', textDecoration: 'none', fontSize: '0.78rem',
            }}>
              ← הקודם
            </Link>
          )}
          <span style={{ padding: '6px 14px', color: '#555', fontSize: '0.78rem' }}>
            עמוד {page} מתוך {totalPages}
          </span>
          {page < totalPages && (
            <Link href={`?page=${page+1}`} style={{
              padding: '6px 14px', background: '#111', border: '1px solid #222',
              borderRadius: '4px', color: '#888', textDecoration: 'none', fontSize: '0.78rem',
            }}>
              הבא →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
