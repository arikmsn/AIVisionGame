/**
 * /forecast-arena/decisions — Decision Journal
 *
 * Every evaluated market: what the system saw, what each model said,
 * what the edge was, and what action was taken — including when no
 * position was opened and why.
 */

import Link from 'next/link';
import { sfetch } from '@/lib/forecast/db';

export const dynamic = 'force-dynamic';

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_EDGE = 0.10; // must match positions.ts

// ── Helpers ───────────────────────────────────────────────────────────────────

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m  = Math.floor(ms / 60_000);
  const h  = Math.floor(ms / 3_600_000);
  const d  = Math.floor(ms / 86_400_000);
  if (m < 2)  return 'just now';
  if (m < 90) return `${m}m ago`;
  if (h < 36) return `${h}h ago`;
  return `${d}d ago`;
}

function pnlColor(n: number) { return n > 0 ? '#4ade80' : n < 0 ? '#f87171' : '#9ca3af'; }

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  strong_yes: { label: 'Strong Yes', color: '#4ade80' },
  lean_yes:   { label: 'Lean Yes',   color: '#86efac' },
  hold:       { label: 'Hold',       color: '#6b7280' },
  lean_no:    { label: 'Lean No',    color: '#fca5a5' },
  strong_no:  { label: 'Strong No',  color: '#f87171' },
};

const TH: React.CSSProperties = {
  padding: '6px 10px', textAlign: 'left', color: '#3a3a3a',
  fontWeight: 500, fontSize: '0.58rem', letterSpacing: '0.06em',
  textTransform: 'uppercase', borderBottom: '1px solid #1a1a1a',
  whiteSpace: 'nowrap', background: '#090909',
};
const TD: React.CSSProperties = { padding: '8px 10px', verticalAlign: 'middle' };

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function DecisionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string }>;
}) {
  const sp       = await (searchParams ?? Promise.resolve({} as { page?: string }));
  const page     = Math.max(1, Number(sp.page ?? 1));
  const pageSize = 8;
  const offset   = (page - 1) * pageSize;

  let rounds:      any[] = [];
  let submissions: any[] = [];
  let agents:      any[] = [];
  let positions:   any[] = [];
  let totalCount   = 0;

  try {
    // Count using fa_rounds directly (reliable)
    const countRes = await sfetch('fa_rounds?select=id').then((r: any) => Array.isArray(r) ? r : []).catch(() => []);
    totalCount = countRes.length;

    // Fetch round summaries — note: column is `category` not `market_category`
    [rounds, agents] = await Promise.all([
      sfetch(
        `fa_v_round_summary?select=round_id,round_number,market_id,market_title,category,market_yes_price_at_open,current_yes_price,round_status,opened_at,resolved_at` +
        `&order=opened_at.desc&limit=${pageSize}&offset=${offset}`,
      ).then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
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

  const agentMap        = new Map(agents.map((a: any) => [a.id, a]));
  const subsByRound     = new Map<string, any[]>();
  for (const s of submissions) {
    if (!subsByRound.has(s.round_id)) subsByRound.set(s.round_id, []);
    subsByRound.get(s.round_id)!.push(s);
  }
  const possBySubmission = new Map(positions.map((p: any) => [p.submission_id, p]));
  const totalPages       = Math.ceil(totalCount / pageSize);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>

      {/* ── Page Header ── */}
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#e8e8e8', margin: '0 0 4px' }}>
          Decision Journal
        </h1>
        <p style={{ color: '#444', fontSize: '0.72rem', margin: 0 }}>
          Every market the system evaluated — model estimates, computed edges, and position outcomes.
          {' '}Shows both entries taken and passes with reasons.
        </p>
      </div>

      {/* ── Empty state when rounds genuinely don't exist ── */}
      {totalCount === 0 && (
        <div style={{
          padding: '48px 32px', textAlign: 'center',
          background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '8px',
        }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '12px' }}>📋</div>
          <div style={{ color: '#666', fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px' }}>
            No evaluations yet
          </div>
          <div style={{ color: '#3a3a3a', fontSize: '0.75rem', lineHeight: 1.7, maxWidth: '420px', margin: '0 auto' }}>
            When the system runs a round — via the daily cycle, light cycle, or manually — it evaluates
            selected markets with all active models. Each model's probability estimate, edge, and decision
            will appear here, along with whether a position was opened and why.
          </div>
          <div style={{ marginTop: '20px' }}>
            <Link href="/forecast-arena/dashboard" style={{
              fontSize: '0.75rem', color: '#555', textDecoration: 'none',
              border: '1px solid #2a2a2a', borderRadius: '4px', padding: '6px 14px',
            }}>
              ← Back to Dashboard
            </Link>
          </div>
        </div>
      )}

      {/* ── Rounds exist but this page's sfetch failed (schema mismatch etc.) ── */}
      {totalCount > 0 && rounds.length === 0 && (
        <div style={{
          padding: '24px', background: '#110a0a', border: '1px solid #2a1a1a',
          borderRadius: '8px', marginBottom: '16px',
        }}>
          <div style={{ color: '#f87171', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
            Unable to load decision entries
          </div>
          <div style={{ color: '#555', fontSize: '0.72rem' }}>
            {totalCount} evaluation round{totalCount !== 1 ? 's' : ''} exist in the database,
            but the summary view returned no data. This usually resolves on refresh.
          </div>
        </div>
      )}

      {/* ── Decision Journal ── */}
      {rounds.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {rounds.map((round: any) => {
            const subs            = subsByRound.get(round.round_id) ?? [];
            const marketPrice     = Number(round.market_yes_price_at_open ?? 0);
            const posCount        = subs.filter((s: any) => possBySubmission.has(s.id)).length;
            const passCount       = subs.filter((s: any) => !possBySubmission.has(s.id) && !s.error_text).length;
            const errorCount      = subs.filter((s: any) => !!s.error_text).length;
            const ageH            = round.opened_at
              ? (Date.now() - new Date(round.opened_at).getTime()) / 3_600_000 : 0;
            const isRecent        = ageH < 4;
            const roundDate       = round.opened_at
              ? new Date(round.opened_at).toLocaleString('en-US', {
                  month: 'short', day: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })
              : '--';

            return (
              <div key={round.round_id} style={{
                background: '#0b0b0b',
                border: `1px solid ${isRecent ? '#1a2a1a' : '#1a1a1a'}`,
                borderRadius: '8px', overflow: 'hidden',
              }}>

                {/* ── Round header ── */}
                <div style={{
                  padding: '13px 16px',
                  background: isRecent ? '#0d110d' : '#0d0d0d',
                  borderBottom: '1px solid #161616',
                  display: 'flex', gap: '14px', alignItems: 'flex-start', flexWrap: 'wrap',
                }}>
                  {/* Round number + time */}
                  <div style={{ minWidth: '52px' }}>
                    <div style={{ fontSize: '0.55rem', color: '#333', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Round</div>
                    <div style={{ fontFamily: 'monospace', color: '#555', fontWeight: 700 }}>
                      #{round.round_number}
                    </div>
                  </div>

                  {/* Market */}
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <div style={{ fontSize: '0.88rem', fontWeight: 600, color: '#d4d4d4', lineHeight: 1.3 }}>
                      {round.market_title}
                    </div>
                    <div style={{ fontSize: '0.62rem', color: '#444', marginTop: '4px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      <span>
                        YES at open:{' '}
                        <strong style={{ color: '#888', fontFamily: 'monospace' }}>
                          {marketPrice > 0 ? `${(marketPrice * 100).toFixed(1)}%` : '--'}
                        </strong>
                      </span>
                      {round.category && (
                        <span style={{ color: '#333' }}>{round.category}</span>
                      )}
                      <span title={round.opened_at}>{relTime(round.opened_at)} · {roundDate}</span>
                    </div>
                  </div>

                  {/* Outcome summary */}
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                    {posCount > 0 && (
                      <span style={{
                        fontSize: '0.62rem', fontWeight: 600, padding: '2px 8px', borderRadius: '3px',
                        background: '#122012', color: '#4ade80', border: '1px solid #1e3a1e',
                      }}>
                        {posCount} position{posCount !== 1 ? 's' : ''} opened
                      </span>
                    )}
                    {passCount > 0 && (
                      <span style={{
                        fontSize: '0.62rem', padding: '2px 8px', borderRadius: '3px',
                        background: '#111', color: '#555', border: '1px solid #1a1a1a',
                      }}>
                        {passCount} pass{passCount !== 1 ? 'es' : ''}
                      </span>
                    )}
                    {errorCount > 0 && (
                      <span style={{
                        fontSize: '0.62rem', padding: '2px 8px', borderRadius: '3px',
                        background: '#1a0a0a', color: '#7a2a2a', border: '1px solid #2a1212',
                      }}>
                        {errorCount} error{errorCount !== 1 ? 's' : ''}
                      </span>
                    )}
                    {subs.length === 0 && (
                      <span style={{ fontSize: '0.62rem', color: '#333' }}>no submissions</span>
                    )}
                    <span style={{
                      fontSize: '0.58rem', padding: '2px 7px', borderRadius: '3px',
                      background: '#111', color: '#444', border: '1px solid #1a1a1a',
                    }}>
                      {round.round_status}
                    </span>
                  </div>
                </div>

                {/* ── No submissions yet ── */}
                {subs.length === 0 && (
                  <div style={{ padding: '14px 16px', color: '#333', fontSize: '0.73rem' }}>
                    No model submissions recorded for this round.
                  </div>
                )}

                {/* ── Model assessment table ── */}
                {subs.length > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                      <thead>
                        <tr>
                          <th style={TH}>Model</th>
                          <th style={{ ...TH, textAlign: 'right' }}>Estimate</th>
                          <th style={{ ...TH, textAlign: 'right' }}>Edge</th>
                          <th style={TH}>Signal</th>
                          <th style={TH}>Outcome</th>
                          <th style={TH}>Reason / Rationale</th>
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
                          const actionInfo = ACTION_LABELS[sub.action] ?? { label: sub.action ?? '--', color: '#555' };

                          // Compute why position was/wasn't opened
                          let outcomeText = '';
                          let outcomeColor = '#333';
                          if (hasError) {
                            outcomeText = `Error: ${sub.error_text?.slice(0, 60)}`;
                            outcomeColor = '#7a2a2a';
                          } else if (hasPos) {
                            const side = pos.side === 'long' ? '▲ LONG' : '▼ SHORT';
                            const pnl  = Number(pos.realized_pnl || 0) + (pos.status === 'open' ? Number(pos.unrealized_pnl || 0) : 0);
                            outcomeText = `${side} · $${Number(pos.cost_basis_usd).toFixed(0)} · ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} P&L`;
                            outcomeColor = pos.side === 'long' ? '#4ade80' : '#f87171';
                          } else if (absEdge < MIN_EDGE) {
                            outcomeText = `Pass — edge ${(absEdge * 100).toFixed(1)}% < ${MIN_EDGE * 100}% threshold`;
                            outcomeColor = '#444';
                          } else {
                            outcomeText = `Pass — edge sufficient but no position opened`;
                            outcomeColor = '#444';
                          }

                          const rationale = hasError
                            ? sub.error_text?.slice(0, 100)
                            : (sub.rationale_short ?? '--');

                          return (
                            <tr key={sub.id} style={{
                              borderBottom: '1px solid #111',
                              opacity: hasError ? 0.55 : 1,
                              background: hasPos
                                ? (pos.side === 'long' ? '#0b120b' : '#120b0b')
                                : 'transparent',
                            }}>
                              {/* Model */}
                              <td style={{ ...TD, fontWeight: 600, whiteSpace: 'nowrap' }}>
                                {agent ? (
                                  <div>
                                    <div style={{ color: '#bbb', fontSize: '0.78rem' }}>{agent.display_name}</div>
                                    <div style={{ color: '#333', fontSize: '0.6rem', fontFamily: 'monospace' }}>{agent.model_id}</div>
                                  </div>
                                ) : (
                                  <span style={{ color: '#444', fontSize: '0.72rem' }}>{sub.agent_id?.slice(0, 8)}</span>
                                )}
                              </td>

                              {/* Estimate */}
                              <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>
                                <span style={{
                                  fontSize: '0.9rem', fontWeight: 700,
                                  color: prob > marketPrice ? '#4ade80' : prob < marketPrice ? '#f87171' : '#888',
                                }}>
                                  {(prob * 100).toFixed(1)}%
                                </span>
                                <div style={{ fontSize: '0.58rem', color: '#333' }}>
                                  mkt {(marketPrice * 100).toFixed(1)}%
                                </div>
                              </td>

                              {/* Edge */}
                              <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>
                                <span style={{
                                  fontSize: '0.82rem', fontWeight: 600,
                                  color: pnlColor(edge),
                                }}>
                                  {edge >= 0 ? '+' : ''}{(edge * 100).toFixed(1)}%
                                </span>
                                {absEdge >= MIN_EDGE && (
                                  <div style={{ fontSize: '0.55rem', color: '#4ade8055' }}>✓ threshold</div>
                                )}
                              </td>

                              {/* Signal */}
                              <td style={TD}>
                                <span style={{
                                  fontSize: '0.65rem', fontWeight: 600,
                                  color: actionInfo.color,
                                }}>
                                  {actionInfo.label}
                                </span>
                                {sub.confidence != null && (
                                  <div style={{ fontSize: '0.58rem', color: '#333', fontFamily: 'monospace' }}>
                                    conf {Number(sub.confidence).toFixed(2)}
                                  </div>
                                )}
                              </td>

                              {/* Outcome */}
                              <td style={{ ...TD, maxWidth: '200px' }}>
                                <span style={{ fontSize: '0.68rem', color: outcomeColor, lineHeight: 1.4 }}>
                                  {outcomeText}
                                </span>
                              </td>

                              {/* Rationale */}
                              <td style={{
                                ...TD,
                                fontSize: '0.65rem', color: '#3d3d3d',
                                maxWidth: '240px', lineHeight: 1.5,
                              }}>
                                {rationale}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', alignItems: 'center', marginTop: '32px' }}>
          {page > 1 && (
            <Link href={`?page=${page - 1}`} style={{
              padding: '6px 14px', background: '#111', border: '1px solid #222',
              borderRadius: '4px', color: '#777', textDecoration: 'none', fontSize: '0.75rem',
            }}>
              ← Previous
            </Link>
          )}
          <span style={{ padding: '6px 14px', color: '#444', fontSize: '0.75rem' }}>
            Page {page} of {totalPages} · {totalCount} evaluations total
          </span>
          {page < totalPages && (
            <Link href={`?page=${page + 1}`} style={{
              padding: '6px 14px', background: '#111', border: '1px solid #222',
              borderRadius: '4px', color: '#777', textDecoration: 'none', fontSize: '0.75rem',
            }}>
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
