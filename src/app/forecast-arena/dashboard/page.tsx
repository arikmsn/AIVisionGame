/**
 * /forecast-arena/dashboard — Operator overview
 *
 * Server component. Fetches from Supabase via service role.
 * OperatorActions is a client component embedded at the top for one-click ops.
 */

import { sfetch } from '@/lib/forecast/db';
import OperatorActions from '../_components/OperatorActions';

export const dynamic = 'force-dynamic';

// ── Helpers ───────────────────────────────────────────────────────────────────

function pnlColor(n: number) { return n > 0 ? '#4ade80' : n < 0 ? '#f87171' : '#888'; }
function pnlStr(n: number)   { return `${n >= 0 ? '+' : ''}$${n.toFixed(2)}`; }

function StatCard({
  label, value, sub, color, mono,
}: {
  label: string; value: string | number; sub?: string; color?: string; mono?: boolean;
}) {
  return (
    <div style={{
      background:   '#111',
      border:       '1px solid #222',
      borderRadius: '6px',
      padding:      '14px 18px',
      minWidth:     '140px',
    }}>
      <div style={{ fontSize: '0.63rem', color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{
        fontSize:    '1.4rem',
        fontWeight:  700,
        color:       color ?? '#f0f0f0',
        marginTop:   '4px',
        fontFamily:  mono ? 'monospace' : undefined,
      }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '0.65rem', color: '#555', marginTop: '2px' }}>{sub}</div>}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  let markets:     any[] = [];
  let rounds:      any[] = [];
  let submissions: any[] = [];
  let agents:      any[] = [];
  let scores:      any[] = [];
  let syncJobs:    any[] = [];
  let openPos:     any[] = [];
  let transactions: any[] = [];
  let tickAudit:   any[] = [];

  try {
    [markets, rounds, submissions, agents, scores, syncJobs, openPos, transactions, tickAudit] =
      await Promise.all([
        sfetch('fa_markets?select=id,status').catch(() => []),
        sfetch('fa_rounds?select=id,status,opened_at').catch(() => []),
        sfetch('fa_submissions?select=id,cost_usd,error_text,submitted_at&limit=1000').catch(() => []),
        sfetch('fa_agents?select=id,slug,is_active').catch(() => []),
        sfetch('fa_scores?select=id,brier_score').catch(() => []),
        sfetch('fa_sync_jobs?select=id,status,started_at,completed_at,records_processed,error_text&order=started_at.desc&limit=5').catch(() => []),
        sfetch('fa_v_open_positions?select=position_id,agent_display_name,market_title,side,unrealized_pnl,realized_pnl,cost_basis_usd,opened_at,tick_count,last_action&order=opened_at.desc').catch(() => []),
        sfetch('fa_transactions?select=id,pnl_usd&order=created_at.desc&limit=2000').catch(() => []),
        sfetch('fa_audit_events?event_type=eq.tick_cycle&select=*&order=created_at.desc&limit=3').catch(() => []),
      ]);
  } catch { /* tables may not exist yet */ }

  // Coerce
  if (!Array.isArray(markets))      markets      = [];
  if (!Array.isArray(rounds))       rounds       = [];
  if (!Array.isArray(submissions))  submissions  = [];
  if (!Array.isArray(agents))       agents       = [];
  if (!Array.isArray(scores))       scores       = [];
  if (!Array.isArray(syncJobs))     syncJobs     = [];
  if (!Array.isArray(openPos))      openPos      = [];
  if (!Array.isArray(transactions)) transactions = [];
  if (!Array.isArray(tickAudit))    tickAudit    = [];

  // ── Derived stats ──────────────────────────────────────────────────────────

  const activeMarkets   = markets.filter(m => m.status === 'active').length;
  const openRounds      = rounds.filter(r => r.status === 'open').length;
  const completedRounds = rounds.filter(r => r.status === 'completed' || r.status === 'resolved').length;
  const totalCost       = submissions.reduce((acc, s) => acc + (Number(s.cost_usd) || 0), 0);
  const errorCount      = submissions.filter(s => s.error_text).length;
  const avgBrier        = scores.length > 0
    ? (scores.reduce((acc, s) => acc + (Number(s.brier_score) || 0), 0) / scores.length).toFixed(4)
    : '--';

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const roundsToday = rounds.filter(r => new Date(r.opened_at) >= todayStart).length;

  // Position stats
  const totalUnrealized = openPos.reduce((s, p) => s + Number(p.unrealized_pnl || 0), 0);
  const totalRealized   = transactions
    .filter(t => t.pnl_usd != null)
    .reduce((s, t) => s + Number(t.pnl_usd || 0), 0);

  // Near-expiry: positions opened > 23 h ago (will be expiry_exited on next tick)
  const nearExpiry = openPos.filter(p => {
    const ageH = (Date.now() - new Date(p.opened_at).getTime()) / 3_600_000;
    return ageH >= 23;
  }).length;

  const lastTickTime = tickAudit[0]?.created_at
    ? new Date(tickAudit[0].created_at).toLocaleString()
    : 'never';

  const lastSyncTime = syncJobs[0]?.started_at
    ? new Date(syncJobs[0].started_at).toLocaleString()
    : 'never';

  const failedJobs = syncJobs.filter(j => j.status === 'failed').length;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>

      {/* ── Operator Actions (client component) ── */}
      <OperatorActions />

      {/* ── Position widgets ── */}
      <section style={{ marginBottom: '28px' }}>
        <h2 style={{
          fontSize: '0.78rem', fontWeight: 600, color: '#555',
          letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '10px',
        }}>
          Live Positions
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px', marginBottom: '16px' }}>
          <StatCard label="Open Positions"     value={openPos.length}       sub="across all agents" />
          <StatCard label="Unrealized P&L"     value={pnlStr(totalUnrealized)} color={pnlColor(totalUnrealized)} />
          <StatCard label="Realized P&L"       value={pnlStr(totalRealized)}   color={pnlColor(totalRealized)} />
          <StatCard label="Near Expiry"        value={nearExpiry}           color={nearExpiry > 0 ? '#f59e0b' : '#888'} sub="exit on next tick" />
          <StatCard label="Last Tick"          value={lastTickTime}         sub="cron: daily 03:00 UTC" mono />
          <StatCard label="Last Market Sync"   value={lastSyncTime}         mono />
          <StatCard label="Failed Sync Jobs"   value={failedJobs}           color={failedJobs > 0 ? '#f87171' : '#888'} />
        </div>

        {openPos.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.75rem' }}>
              <thead>
                <tr>
                  {['Agent', 'Market', 'Side', 'Unrealized', 'Realized', 'Ticks', 'Last Action', 'Age'].map(h => (
                    <th key={h} style={{
                      padding: '5px 10px', textAlign: 'left', color: '#444',
                      fontWeight: 500, fontSize: '0.63rem', letterSpacing: '0.04em',
                      textTransform: 'uppercase', borderBottom: '1px solid #1e1e1e',
                      whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {openPos.map((p: any) => {
                  const unr    = Number(p.unrealized_pnl || 0);
                  const rlz    = Number(p.realized_pnl   || 0);
                  const ageMs  = Date.now() - new Date(p.opened_at).getTime();
                  const age    = ageMs < 3_600_000 ? `${Math.round(ageMs/60000)}m`
                    : ageMs < 86_400_000 ? `${Math.round(ageMs/3_600_000)}h`
                    : `${Math.round(ageMs/86_400_000)}d`;
                  return (
                    <tr key={p.position_id} style={{ borderBottom: '1px solid #141414' }}>
                      <td style={{ padding: '7px 10px', fontWeight: 600, color: '#ccc' }}>{p.agent_display_name}</td>
                      <td style={{ padding: '7px 10px', color: '#777', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.market_title}
                      </td>
                      <td style={{ padding: '7px 10px' }}>
                        <span style={{
                          fontSize: '0.6rem', fontWeight: 700, padding: '2px 6px', borderRadius: '3px',
                          background: p.side === 'long' ? '#1a2e1a' : '#2e1a1a',
                          color:      p.side === 'long' ? '#4ade80' : '#f87171',
                        }}>
                          {p.side === 'long' ? '▲' : '▼'} {p.side?.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '7px 10px', fontWeight: 700, color: pnlColor(unr) }}>{pnlStr(unr)}</td>
                      <td style={{ padding: '7px 10px', color: rlz !== 0 ? pnlColor(rlz) : '#444' }}>
                        {rlz !== 0 ? pnlStr(rlz) : '—'}
                      </td>
                      <td style={{ padding: '7px 10px', color: '#666' }}>{p.tick_count ?? 0}</td>
                      <td style={{ padding: '7px 10px', color: '#555' }}>{p.last_action ?? 'open'}</td>
                      <td style={{ padding: '7px 10px', color: '#444' }}>{age}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── System stats ── */}
      <section style={{ marginBottom: '28px' }}>
        <h2 style={{
          fontSize: '0.78rem', fontWeight: 600, color: '#555',
          letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '10px',
        }}>
          System Stats
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px' }}>
          <StatCard label="Active Markets"  value={activeMarkets}   sub={`${markets.length} total`} />
          <StatCard label="Open Rounds"     value={openRounds}      sub={`${completedRounds} done`} />
          <StatCard label="Rounds Today"    value={roundsToday} />
          <StatCard label="Submissions"     value={submissions.length} sub={errorCount > 0 ? `${errorCount} errors` : undefined} color={errorCount > 0 ? '#f87171' : undefined} />
          <StatCard label="Scored"          value={scores.length} />
          <StatCard label="Avg Brier"       value={avgBrier}        sub="lower is better" />
          <StatCard label="Total LLM Cost"  value={`$${totalCost.toFixed(4)}`} />
          <StatCard label="Active Agents"   value={agents.filter(a => a.is_active).length} />
        </div>
      </section>

      {/* ── Recent sync jobs ── */}
      <section style={{ marginBottom: '28px' }}>
        <h2 style={{
          fontSize: '0.78rem', fontWeight: 600, color: '#555',
          letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '10px',
        }}>
          Recent Sync Jobs
        </h2>
        {syncJobs.length === 0 ? (
          <p style={{ color: '#555', fontSize: '0.8rem' }}>
            No sync jobs yet. Use "Sync Markets" above or POST /api/forecast/sync-markets.
          </p>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.78rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #222' }}>
                {['Status', 'Started', 'Completed', 'Records', 'Error'].map(h => (
                  <th key={h} style={{ padding: '5px 10px', textAlign: 'left', color: '#444', fontWeight: 500, fontSize: '0.63rem', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {syncJobs.map((job: any, i: number) => (
                <tr key={job.id ?? i} style={{ borderBottom: '1px solid #1a1a1a' }}>
                  <td style={{ padding: '6px 10px' }}>
                    <span style={{
                      color: job.status === 'completed' ? '#4ade80' : job.status === 'failed' ? '#f87171' : '#fbbf24',
                    }}>
                      {job.status}
                    </span>
                  </td>
                  <td style={{ padding: '6px 10px', color: '#666' }}>
                    {job.started_at ? new Date(job.started_at).toLocaleString() : '--'}
                  </td>
                  <td style={{ padding: '6px 10px', color: '#666' }}>
                    {job.completed_at ? new Date(job.completed_at).toLocaleString() : '--'}
                  </td>
                  <td style={{ padding: '6px 10px', color: '#888' }}>{job.records_processed ?? 0}</td>
                  <td style={{ padding: '6px 10px', color: job.error_text ? '#f87171' : '#3a3a3a' }}>
                    {job.error_text ? job.error_text.slice(0, 80) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Position management logic (architecture reference) ── */}
      <section style={{ marginBottom: '28px' }}>
        <h2 style={{
          fontSize: '0.78rem', fontWeight: 600, color: '#555',
          letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '10px',
        }}>
          Position Management Logic
        </h2>
        <div style={{
          background: '#080808', border: '1px solid #1a1a1a',
          borderRadius: '6px', padding: '16px 20px',
          fontSize: '0.73rem', lineHeight: 1.8, color: '#555',
        }}>
          <p style={{ marginBottom: '10px' }}>
            <strong style={{ color: '#888' }}>RUN ROUND — uses LLM (one call per agent per round).</strong>{' '}
            Each active agent receives the market question, description, current Polymarket YES price,
            and its strategy profile. It returns a probability estimate, confidence, action label,
            and rationale. If the agent&apos;s probability diverges from the market price by ≥ 10 pp,
            a paper position is opened automatically: LONG YES if the agent thinks market is underpriced,
            SHORT YES (long NO) if overpriced. Position size = 2% of paper wallet balance, capped at $200.
          </p>
          <p style={{ marginBottom: '12px' }}>
            <strong style={{ color: '#888' }}>TICK — rule-based, zero LLM calls.</strong>{' '}
            Fetches the current Polymarket price for every open position, then evaluates these rules
            in strict priority order:
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '8px' }}>
            {[
              { label: 'expiry_exit', color: '#f59e0b', trigger: 'Market closes within 24 h',          action: 'Close position fully at current price' },
              { label: 'stop_loss',   color: '#f87171', trigger: 'Unrealized loss ≥ 20% of cost basis', action: 'Close position fully, return funds to wallet' },
              { label: 'scale_out',   color: '#60a5fa', trigger: 'Unrealized gain ≥ 15%, no prior trim', action: 'Sell 50% of contracts, realize partial gain' },
              { label: 'scale_in',    color: '#4ade80', trigger: 'Edge ≥ 8%, tick ≤ 3, no prior add',   action: 'Buy 50% more at current price, blend avg entry' },
              { label: 'hold',        color: '#444',    trigger: 'None of the above',                   action: 'Update unrealized P&L, no size change' },
            ].map(r => (
              <div key={r.label} style={{
                background: '#0a0a0a', border: '1px solid #161616',
                borderRadius: '4px', padding: '10px 12px',
              }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: r.color, fontSize: '0.72rem' }}>{r.label}</span>
                </div>
                <div style={{ fontSize: '0.65rem', color: '#444', marginBottom: '2px' }}>
                  <span style={{ color: '#3a3a3a' }}>Trigger: </span>{r.trigger}
                </div>
                <div style={{ fontSize: '0.65rem', color: '#444' }}>
                  <span style={{ color: '#3a3a3a' }}>Effect: </span>{r.action}
                </div>
              </div>
            ))}
          </div>
          <p style={{ marginTop: '12px', fontSize: '0.68rem', color: '#3a3a3a' }}>
            Cron runs daily at <strong style={{ color: '#444' }}>03:00 UTC</strong> (Vercel Hobby limit).
            Use &ldquo;Run Tick Now&rdquo; above for manual execution. Each tick writes a row to
            <code style={{ color: '#555' }}>fa_position_ticks</code> and updates{' '}
            <code style={{ color: '#555' }}>fa_positions</code>. Closed positions return capital to the agent&apos;s
            paper wallet.
          </p>
        </div>
      </section>

      {/* ── API reference ── */}
      <section>
        <h2 style={{
          fontSize: '0.78rem', fontWeight: 600, color: '#555',
          letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '10px',
        }}>
          Direct API Endpoints
        </h2>
        <div style={{ fontSize: '0.73rem', color: '#444', lineHeight: 2, fontFamily: 'monospace' }}>
          {[
            ['POST', '/api/forecast/sync-markets', 'pull Polymarket data'],
            ['POST', '/api/forecast/seed-agents',  'upsert all 6 league agents'],
            ['POST', '/api/forecast/create-round', 'open round(s) on top markets'],
            ['POST', '/api/forecast/run-round',    'run agents on oldest open round'],
            ['POST', '/api/forecast/score-round',  'score a resolved round'],
            ['GET',  '/api/forecast/tick',         'cron endpoint (CRON_SECRET bearer)'],
            ['POST', '/api/forecast/tick',         'manual tick (x-admin-password)'],
          ].map(([method, path, desc]) => (
            <div key={path} style={{ display: 'flex', gap: '12px' }}>
              <span style={{ color: '#555', minWidth: '36px' }}>{method}</span>
              <span style={{ color: '#888' }}>{path}</span>
              <span style={{ color: '#3a3a3a' }}>— {desc}</span>
            </div>
          ))}
          <p style={{ marginTop: '8px', color: '#3a3a3a', fontFamily: 'sans-serif', fontSize: '0.68rem' }}>
            All POST endpoints require header: <code style={{ color: '#555' }}>x-admin-password</code>
          </p>
        </div>
      </section>
    </div>
  );
}
