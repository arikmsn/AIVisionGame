/**
 * /forecast-arena/dashboard — Overview with real stats
 *
 * Server component. Fetches from Supabase directly via service role.
 */

import { sfetch } from '@/lib/forecast/db';

export const dynamic = 'force-dynamic';

// ── Helpers ──────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div style={{
      background:    '#111',
      border:        '1px solid #222',
      borderRadius:  '6px',
      padding:       '16px 20px',
      minWidth:      '160px',
    }}>
      <div style={{ fontSize: '0.7rem', color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f0f0f0', marginTop: '4px' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '0.7rem', color: '#555', marginTop: '2px' }}>{sub}</div>}
    </div>
  );
}

export default async function DashboardPage() {
  let markets: any[] = [];
  let rounds: any[] = [];
  let submissions: any[] = [];
  let agents: any[] = [];
  let scores: any[] = [];
  let syncJobs: any[] = [];

  try {
    [markets, rounds, submissions, agents, scores, syncJobs] = await Promise.all([
      sfetch('fa_markets?select=id,status').catch(() => []),
      sfetch('fa_rounds?select=id,status,opened_at').catch(() => []),
      sfetch('fa_submissions?select=id,cost_usd,error_text,submitted_at&limit=1000').catch(() => []),
      sfetch('fa_agents?select=id,slug,is_active').catch(() => []),
      sfetch('fa_scores?select=id,brier_score').catch(() => []),
      sfetch('fa_sync_jobs?select=id,status,started_at,completed_at,records_processed,error_text&order=started_at.desc&limit=5').catch(() => []),
    ]);
  } catch {
    // Tables may not exist yet
  }

  // Ensure arrays
  if (!Array.isArray(markets)) markets = [];
  if (!Array.isArray(rounds)) rounds = [];
  if (!Array.isArray(submissions)) submissions = [];
  if (!Array.isArray(agents)) agents = [];
  if (!Array.isArray(scores)) scores = [];
  if (!Array.isArray(syncJobs)) syncJobs = [];

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

  return (
    <div>
      {/* Stats grid */}
      <div style={{
        display:  'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
        gap:      '12px',
        marginBottom: '32px',
      }}>
        <StatCard label="Active Markets" value={activeMarkets} sub={`${markets.length} total`} />
        <StatCard label="Open Rounds" value={openRounds} sub={`${rounds.length} total`} />
        <StatCard label="Rounds Today" value={roundsToday} />
        <StatCard label="Submissions" value={submissions.length} sub={errorCount > 0 ? `${errorCount} errors` : undefined} />
        <StatCard label="Scored" value={scores.length} />
        <StatCard label="Avg Brier" value={avgBrier} sub="lower is better" />
        <StatCard label="Total Cost" value={`$${totalCost.toFixed(4)}`} />
        <StatCard label="Active Agents" value={agents.filter(a => a.is_active).length} />
      </div>

      {/* Recent sync jobs */}
      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '12px', color: '#ccc' }}>
          Recent Sync Jobs
        </h2>
        {syncJobs.length === 0 ? (
          <p style={{ color: '#555', fontSize: '0.8rem' }}>
            No sync jobs yet. Use the API to trigger a market sync.
          </p>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #333' }}>
                {['Status', 'Started', 'Completed', 'Records', 'Errors'].map(h => (
                  <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: '#666', fontWeight: 500 }}>{h}</th>
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
                  <td style={{ padding: '6px 10px', color: '#888' }}>
                    {job.started_at ? new Date(job.started_at).toLocaleString() : '--'}
                  </td>
                  <td style={{ padding: '6px 10px', color: '#888' }}>
                    {job.completed_at ? new Date(job.completed_at).toLocaleString() : '--'}
                  </td>
                  <td style={{ padding: '6px 10px' }}>{job.records_processed ?? 0}</td>
                  <td style={{ padding: '6px 10px', color: job.error_text ? '#f87171' : '#555' }}>
                    {job.error_text ? job.error_text.slice(0, 80) : 'none'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Quick links */}
      <section>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '12px', color: '#ccc' }}>
          Quick Actions (API)
        </h2>
        <div style={{ fontSize: '0.75rem', color: '#666', lineHeight: 1.8 }}>
          <p>POST /api/forecast/sync-markets — sync Polymarket data</p>
          <p>POST /api/forecast/seed-agents — seed the 4 forecast agents</p>
          <p>POST /api/forecast/create-round — create forecast round(s)</p>
          <p>POST /api/forecast/run-round — run all agents on a round</p>
          <p>POST /api/forecast/score-round — score a resolved round</p>
          <p style={{ marginTop: '8px', color: '#555' }}>
            All require header: x-admin-password
          </p>
        </div>
      </section>
    </div>
  );
}
