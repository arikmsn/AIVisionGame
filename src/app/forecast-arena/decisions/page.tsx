/**
 * /forecast-arena/decisions — Decision Journal
 *
 * Every evaluated market: what the system saw, what each model said,
 * and ONE aggregated system decision (long / short / no-trade).
 *
 * Layout per round:
 *   1. Round header  — market name, price at open, timestamp
 *   2. System Decision banner — aggregated probability, edge, disagreement,
 *      vote counts, final action, position size, reasoning
 *   3. Model assessment table — per-model estimate, individual edge, signal,
 *      rationale (expert-witness view; no per-model position any more)
 */

import Link from 'next/link';
import { sfetch } from '@/lib/forecast/db';
import { AGG_MIN_EDGE } from '@/lib/forecast/aggregator';

export const dynamic = 'force-dynamic';

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

function pct(n: number, dp = 1) { return `${(n * 100).toFixed(dp)}%`; }
function pnlColor(n: number) { return n > 0 ? '#4ade80' : n < 0 ? '#f87171' : '#9ca3af'; }
function edgeColor(n: number) { return Math.abs(n) >= AGG_MIN_EDGE ? pnlColor(n) : '#555'; }

function disagreementColor(d: number) {
  if (d < 0.05)  return '#4ade80';   // strong consensus
  if (d < 0.12)  return '#fbbf24';   // moderate
  return '#f87171';                   // high disagreement
}

function disagreementLabel(d: number) {
  if (d < 0.05)  return 'Consensus';
  if (d < 0.12)  return 'Moderate';
  return 'Disputed';
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  strong_yes: { label: 'Strong Yes', color: '#4ade80' },
  lean_yes:   { label: 'Lean Yes',   color: '#86efac' },
  hold:       { label: 'Hold',       color: '#6b7280' },
  lean_no:    { label: 'Lean No',    color: '#fca5a5' },
  strong_no:  { label: 'Strong No',  color: '#f87171' },
};

const TH: React.CSSProperties = {
  padding: '6px 10px', textAlign: 'left', color: '#333',
  fontWeight: 500, fontSize: '0.58rem', letterSpacing: '0.06em',
  textTransform: 'uppercase', borderBottom: '1px solid #1a1a1a',
  whiteSpace: 'nowrap', background: '#090909',
};
const TD: React.CSSProperties = { padding: '8px 10px', verticalAlign: 'middle' };

// ── System Decision Banner ────────────────────────────────────────────────────

function SystemDecisionBanner({
  sysDecision,
  marketPrice,
  systemPos,
}: {
  sysDecision:   Record<string, any>;
  marketPrice:   number;
  systemPos:     any | null;   // fa_positions row if a position was opened
}) {
  const action: string  = sysDecision.action ?? 'no_trade';
  const aggP    = Number(sysDecision.aggregated_p    ?? marketPrice);
  const aggEdge = Number(sysDecision.aggregated_edge ?? 0);
  const sigma   = Number(sysDecision.disagreement    ?? 0);
  const sizeUsd = Number(sysDecision.size_usd        ?? 0);
  const longV   = Number(sysDecision.long_votes      ?? 0);
  const shortV  = Number(sysDecision.short_votes     ?? 0);
  const models  = Number(sysDecision.model_count     ?? longV + shortV);

  const actionColor =
    action === 'open_long'  ? '#4ade80' :
    action === 'open_short' ? '#f87171' : '#555';
  const actionLabel =
    action === 'open_long'  ? '▲ OPEN LONG' :
    action === 'open_short' ? '▼ OPEN SHORT' : '— NO TRADE';
  const actionBg =
    action === 'open_long'  ? '#071207' :
    action === 'open_short' ? '#120707' : '#0d0d0d';

  // P&L for the opened position (if any)
  let posInfo: React.ReactNode = null;
  if (systemPos) {
    const pnl = Number(systemPos.realized_pnl || 0) +
      (systemPos.status === 'open' ? Number(systemPos.unrealized_pnl || 0) : 0);
    posInfo = (
      <span style={{ fontSize: '0.65rem', color: pnlColor(pnl), marginLeft: '10px' }}>
        ${Number(systemPos.cost_basis_usd).toFixed(0)} · {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} P&L
        {systemPos.status === 'closed' && <span style={{ color: '#555' }}> (closed)</span>}
      </span>
    );
  }

  return (
    <div style={{
      margin: '0', padding: '12px 16px',
      background: actionBg,
      borderBottom: '1px solid #1a1a1a',
      display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap',
    }}>
      {/* Action badge */}
      <div style={{ minWidth: '110px' }}>
        <div style={{ fontSize: '0.52rem', color: '#333', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '3px' }}>
          System Decision
        </div>
        <div style={{
          fontFamily: 'monospace', fontWeight: 700,
          fontSize: '0.82rem', color: actionColor,
          letterSpacing: '0.02em',
        }}>
          {actionLabel}
        </div>
        {posInfo}
      </div>

      {/* Aggregated probability */}
      <div>
        <div style={{ fontSize: '0.52rem', color: '#333', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '2px' }}>Aggregated P</div>
        <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.88rem', color: edgeColor(aggEdge) }}>
          {pct(aggP)}
        </span>
        <span style={{ fontSize: '0.58rem', color: '#444', marginLeft: '6px' }}>
          mkt {pct(marketPrice)}
        </span>
      </div>

      {/* Aggregated edge */}
      <div>
        <div style={{ fontSize: '0.52rem', color: '#333', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '2px' }}>Agg Edge</div>
        <span style={{
          fontFamily: 'monospace', fontWeight: 700,
          fontSize: '0.88rem', color: edgeColor(aggEdge),
        }}>
          {aggEdge >= 0 ? '+' : ''}{pct(aggEdge)}
        </span>
        {Math.abs(aggEdge) >= AGG_MIN_EDGE && (
          <span style={{ fontSize: '0.55rem', color: '#4ade8055', marginLeft: '5px' }}>✓</span>
        )}
      </div>

      {/* Disagreement */}
      <div>
        <div style={{ fontSize: '0.52rem', color: '#333', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '2px' }}>Disagreement σ</div>
        <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.85rem', color: disagreementColor(sigma) }}>
          {pct(sigma)}
        </span>
        <span style={{ fontSize: '0.58rem', color: '#444', marginLeft: '6px' }}>
          {disagreementLabel(sigma)}
        </span>
      </div>

      {/* Vote counts */}
      <div>
        <div style={{ fontSize: '0.52rem', color: '#333', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '2px' }}>
          Votes ({models} models)
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '0.7rem', fontFamily: 'monospace' }}>
            <span style={{ color: '#4ade80' }}>▲{longV}</span>
            <span style={{ color: '#333', margin: '0 3px' }}>/</span>
            <span style={{ color: '#f87171' }}>▼{shortV}</span>
          </span>
        </div>
      </div>

      {/* Size */}
      {action !== 'no_trade' && sizeUsd > 0 && (
        <div>
          <div style={{ fontSize: '0.52rem', color: '#333', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '2px' }}>Position Size</div>
          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.82rem', color: '#d4d4d4' }}>
            ${sizeUsd.toFixed(0)}
          </span>
          {sysDecision.size_pct != null && (
            <span style={{ fontSize: '0.58rem', color: '#555', marginLeft: '5px' }}>
              ({pct(Number(sysDecision.size_pct), 2)} of bankroll)
            </span>
          )}
        </div>
      )}

      {/* Reason */}
      {sysDecision.reason && (
        <div style={{ flex: 1, minWidth: '200px' }}>
          <div style={{ fontSize: '0.52rem', color: '#333', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '2px' }}>Reasoning</div>
          <div style={{ fontSize: '0.65rem', color: '#555', lineHeight: 1.5 }}>
            {sysDecision.reason}
          </div>
        </div>
      )}
    </div>
  );
}

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
  let roundContexts: any[] = [];
  let totalCount   = 0;

  try {
    const countRes = await sfetch('fa_rounds?select=id')
      .then((r: any) => Array.isArray(r) ? r : []).catch(() => []);
    totalCount = countRes.length;

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
      [submissions, positions, roundContexts] = await Promise.all([
        sfetch(`fa_submissions?round_id=in.(${roundIds})&select=*&order=submitted_at.asc`)
          .then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
        // Fetch all positions for these rounds (system positions have submission_id=null)
        sfetch(`fa_positions?round_id=in.(${roundIds})&select=id,agent_id,submission_id,round_id,side,cost_basis_usd,realized_pnl,unrealized_pnl,status,avg_entry_price`)
          .then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
        // Fetch context_json for system decision data
        sfetch(`fa_rounds?id=in.(${roundIds})&select=id,context_json`)
          .then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
      ]);
    }
  } catch { /* ok */ }

  const agentMap         = new Map(agents.map((a: any) => [a.id, a]));
  const subsByRound      = new Map<string, any[]>();
  for (const s of submissions) {
    if (!subsByRound.has(s.round_id)) subsByRound.set(s.round_id, []);
    subsByRound.get(s.round_id)!.push(s);
  }

  // System position per round (submission_id = null)
  const systemPosByRound = new Map<string, any>();
  for (const p of positions) {
    if (!p.submission_id && p.round_id) {
      systemPosByRound.set(p.round_id, p);
    }
  }

  // context_json per round (for system_decision)
  const ctxByRound = new Map<string, any>();
  for (const r of roundContexts) {
    ctxByRound.set(r.id, r.context_json ?? null);
  }

  const totalPages = Math.ceil(totalCount / pageSize);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>

      {/* ── Page Header ── */}
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#e8e8e8', margin: '0 0 4px' }}>
          Decision Journal
        </h1>
        <p style={{ color: '#444', fontSize: '0.72rem', margin: 0 }}>
          Every market evaluated by the system. Models are expert advisors — the system trades as one brain,
          opening at most one position per market per round based on the aggregated model view.
        </p>
      </div>

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
            When the system runs a round it evaluates selected markets with all active models.
            Each model's estimate is aggregated into one system decision (long / short / no-trade),
            which appears here alongside the per-model expert views.
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

      {totalCount > 0 && rounds.length === 0 && (
        <div style={{
          padding: '24px', background: '#110a0a', border: '1px solid #2a1a1a',
          borderRadius: '8px', marginBottom: '16px',
        }}>
          <div style={{ color: '#f87171', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
            Unable to load decision entries
          </div>
          <div style={{ color: '#555', fontSize: '0.72rem' }}>
            {totalCount} round{totalCount !== 1 ? 's' : ''} exist but the summary view returned no data.
          </div>
        </div>
      )}

      {/* ── Decision Journal ── */}
      {rounds.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {rounds.map((round: any) => {
            const subs        = subsByRound.get(round.round_id) ?? [];
            const marketPrice = Number(round.market_yes_price_at_open ?? 0);
            const errorCount  = subs.filter((s: any) => !!s.error_text).length;
            const ageH        = round.opened_at
              ? (Date.now() - new Date(round.opened_at).getTime()) / 3_600_000 : 0;
            const isRecent    = ageH < 4;
            const roundDate   = round.opened_at
              ? new Date(round.opened_at).toLocaleString('en-US', {
                  month: 'short', day: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })
              : '--';

            const ctx        = ctxByRound.get(round.round_id) ?? null;
            const sysDecision: Record<string, any> | null = ctx?.system_decision ?? null;
            const systemPos  = systemPosByRound.get(round.round_id) ?? null;

            // Legacy compatibility: old rounds had per-agent positions linked by submission_id
            const possBySubmission = new Map(
              positions
                .filter((p: any) => p.submission_id && p.round_id === round.round_id)
                .map((p: any) => [p.submission_id, p]),
            );

            const actionStr = sysDecision?.action ?? null;
            const hasPosition = !!systemPos;

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
                  <div style={{ minWidth: '52px' }}>
                    <div style={{ fontSize: '0.55rem', color: '#333', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Round</div>
                    <div style={{ fontFamily: 'monospace', color: '#555', fontWeight: 700 }}>
                      #{round.round_number}
                    </div>
                  </div>

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
                      {round.category && <span style={{ color: '#333' }}>{round.category}</span>}
                      <span title={round.opened_at}>{relTime(round.opened_at)} · {roundDate}</span>
                    </div>
                  </div>

                  {/* Outcome badges */}
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                    {hasPosition && (
                      <span style={{
                        fontSize: '0.62rem', fontWeight: 600, padding: '2px 8px', borderRadius: '3px',
                        background: systemPos.side === 'long' ? '#122012' : '#201212',
                        color:      systemPos.side === 'long' ? '#4ade80' : '#f87171',
                        border: `1px solid ${systemPos.side === 'long' ? '#1e3a1e' : '#3a1e1e'}`,
                      }}>
                        {systemPos.side === 'long' ? '▲ Long' : '▼ Short'} opened
                      </span>
                    )}
                    {!hasPosition && actionStr === 'no_trade' && (
                      <span style={{
                        fontSize: '0.62rem', padding: '2px 8px', borderRadius: '3px',
                        background: '#111', color: '#555', border: '1px solid #1a1a1a',
                      }}>
                        No trade
                      </span>
                    )}
                    {!sysDecision && subs.length > 0 && (
                      <span style={{
                        fontSize: '0.62rem', padding: '2px 8px', borderRadius: '3px',
                        background: '#111', color: '#555', border: '1px solid #1a1a1a',
                      }}>
                        {subs.filter((s: any) => possBySubmission.has(s.id)).length > 0
                          ? `${subs.filter((s: any) => possBySubmission.has(s.id)).length} legacy pos`
                          : `${subs.length} submissions`}
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
                    <span style={{
                      fontSize: '0.58rem', padding: '2px 7px', borderRadius: '3px',
                      background: '#111', color: '#444', border: '1px solid #1a1a1a',
                    }}>
                      {round.round_status}
                    </span>
                  </div>
                </div>

                {/* ── System Decision Banner (new rounds only) ── */}
                {sysDecision && (
                  <SystemDecisionBanner
                    sysDecision={sysDecision}
                    marketPrice={marketPrice}
                    systemPos={systemPos}
                  />
                )}

                {/* ── No submissions ── */}
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
                          <th style={{ ...TH, textAlign: 'right' }}>Indiv. Edge</th>
                          <th style={TH}>Signal</th>
                          <th style={TH}>
                            {sysDecision ? 'Model Vote' : 'Outcome'}
                          </th>
                          <th style={TH}>Rationale</th>
                        </tr>
                      </thead>
                      <tbody>
                        {subs.map((sub: any) => {
                          const agent    = agentMap.get(sub.agent_id);
                          const prob     = Number(sub.probability_yes ?? 0);
                          const edge     = prob - marketPrice;
                          const absEdge  = Math.abs(edge);
                          const hasError = !!sub.error_text;
                          const actionInfo = ACTION_LABELS[sub.action] ?? { label: sub.action ?? '--', color: '#555' };

                          // Outcome column — different for new vs legacy rounds
                          let outcomeText  = '';
                          let outcomeColor = '#555';

                          if (hasError) {
                            outcomeText  = `Error: ${sub.error_text?.slice(0, 60)}`;
                            outcomeColor = '#7a2a2a';
                          } else if (sysDecision) {
                            // New aggregated-brain round — show model's directional vote
                            const direction = edge > 0 ? '▲ Bullish' : edge < 0 ? '▼ Bearish' : '= Neutral';
                            const dirColor  = edge > 0 ? '#4ade8088' : edge < 0 ? '#f8717188' : '#55555588';
                            outcomeText  = direction;
                            outcomeColor = dirColor;
                          } else {
                            // Legacy per-agent round — show position if opened
                            const pos = possBySubmission.get(sub.id);
                            if (pos) {
                              const side = pos.side === 'long' ? '▲ LONG' : '▼ SHORT';
                              const pnl  = Number(pos.realized_pnl || 0) + (pos.status === 'open' ? Number(pos.unrealized_pnl || 0) : 0);
                              outcomeText  = `${side} · $${Number(pos.cost_basis_usd).toFixed(0)} · ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
                              outcomeColor = pos.side === 'long' ? '#4ade80' : '#f87171';
                            } else if (absEdge < AGG_MIN_EDGE) {
                              outcomeText  = `Pass — edge ${(absEdge * 100).toFixed(1)}% < ${AGG_MIN_EDGE * 100}%`;
                              outcomeColor = '#333';
                            } else {
                              outcomeText  = 'Pass — edge sufficient but no position';
                              outcomeColor = '#444';
                            }
                          }

                          const rationale = hasError
                            ? sub.error_text?.slice(0, 100)
                            : (sub.rationale_short ?? '--');

                          return (
                            <tr key={sub.id} style={{
                              borderBottom: '1px solid #111',
                              opacity: hasError ? 0.55 : 1,
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

                              {/* Individual edge */}
                              <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>
                                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: edgeColor(edge) }}>
                                  {edge >= 0 ? '+' : ''}{(edge * 100).toFixed(1)}%
                                </span>
                              </td>

                              {/* Signal */}
                              <td style={TD}>
                                <span style={{ fontSize: '0.65rem', fontWeight: 600, color: actionInfo.color }}>
                                  {actionInfo.label}
                                </span>
                                {sub.confidence != null && (
                                  <div style={{ fontSize: '0.58rem', color: '#333', fontFamily: 'monospace' }}>
                                    conf {Number(sub.confidence).toFixed(2)}
                                  </div>
                                )}
                              </td>

                              {/* Vote / Outcome */}
                              <td style={{ ...TD, maxWidth: '160px' }}>
                                <span style={{ fontSize: '0.68rem', color: outcomeColor, lineHeight: 1.4 }}>
                                  {outcomeText}
                                </span>
                              </td>

                              {/* Rationale */}
                              <td style={{
                                ...TD, fontSize: '0.65rem', color: '#3d3d3d',
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
