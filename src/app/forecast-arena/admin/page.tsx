/**
 * /forecast-arena/admin — ניהול
 *
 * Secondary admin screen: system stats, sync jobs, audit trail,
 * LLM cost breakdown, API reference. These are operational/diagnostic
 * details that don't belong in the primary investment workflow.
 */

import { sfetch } from '@/lib/forecast/db';

export const dynamic = 'force-dynamic';

const TH: React.CSSProperties = {
  padding: '6px 12px', textAlign: 'left', color: '#3a3a3a',
  fontWeight: 500, fontSize: '0.6rem', letterSpacing: '0.05em',
  textTransform: 'uppercase', borderBottom: '1px solid #161616',
  background: '#090909', whiteSpace: 'nowrap',
};
const TD: React.CSSProperties = { padding: '7px 12px', fontSize: '0.72rem' };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '32px' }}>
      <h2 style={{
        fontSize: '0.68rem', fontWeight: 600, color: '#444',
        textTransform: 'uppercase', letterSpacing: '0.05em',
        marginBottom: '10px', borderBottom: '1px solid #141414',
        paddingBottom: '6px',
      }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default async function AdminPage() {
  let markets:     any[] = [];
  let rounds:      any[] = [];
  let submissions: any[] = [];
  let agents:      any[] = [];
  let scores:      any[] = [];
  let syncJobs:    any[] = [];
  let auditEvents: any[] = [];

  try {
    [markets, rounds, submissions, agents, scores, syncJobs, auditEvents] = await Promise.all([
      sfetch('fa_markets?select=id,status').then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
      sfetch('fa_rounds?select=id,status,opened_at').then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
      sfetch('fa_submissions?select=id,cost_usd,error_text,agent_id,submitted_at&limit=2000').then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
      sfetch('fa_agents?select=id,slug,display_name,model_id,provider,is_active').then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
      sfetch('fa_scores?select=id,brier_score').then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
      sfetch('fa_sync_jobs?select=*&order=started_at.desc&limit=10').then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
      sfetch('fa_audit_events?select=*&order=created_at.desc&limit=40').then((r: any) => Array.isArray(r) ? r : []).catch(() => []),
    ]);
  } catch { /* ok */ }

  const agentMap = new Map(agents.map((a: any) => [a.id, a]));

  const activeMarkets   = markets.filter((m: any) => m.status === 'active').length;
  const openRounds      = rounds.filter((r: any) => r.status === 'open').length;
  const completedRounds = rounds.filter((r: any) => ['completed','resolved'].includes(r.status)).length;
  const errorSubs       = submissions.filter((s: any) => s.error_text).length;
  const totalCost       = submissions.reduce((s: number, sub: any) => s + Number(sub.cost_usd || 0), 0);
  const avgBrier        = scores.length > 0
    ? scores.reduce((s: number, sc: any) => s + Number(sc.brier_score || 0), 0) / scores.length
    : null;

  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const roundsToday = rounds.filter((r: any) => new Date(r.opened_at) >= todayStart).length;

  // LLM cost by agent
  const costByAgent = new Map<string, number>();
  for (const s of submissions) {
    if (!costByAgent.has(s.agent_id)) costByAgent.set(s.agent_id, 0);
    costByAgent.set(s.agent_id, costByAgent.get(s.agent_id)! + Number(s.cost_usd || 0));
  }

  const EVENT_COLORS: Record<string, string> = {
    position_opened:  '#4ade80',
    tick_cycle:       '#d4f25a',
    round_scored:     '#60a5fa',
    agent_error:      '#f87171',
    agent_submission: '#888',
    round_created:    '#fbbf24',
    markets_synced:   '#60a5fa',
  };

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#888', margin: 0 }}>ניהול מערכת</h1>
        <p style={{ color: '#444', fontSize: '0.7rem', marginTop: '4px' }}>
          נתוני מערכת, לוגים, עלויות API ותצורה — מסך משני
        </p>
      </div>

      {/* ── System Stats ── */}
      <Section title="נתוני מערכת">
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {[
            { label: 'שווקים פעילים',   value: activeMarkets,             sub: `${markets.length} סה"כ` },
            { label: 'סבבים פתוחים',    value: openRounds,                sub: `${completedRounds} הושלמו` },
            { label: 'סבבים היום',      value: roundsToday },
            { label: 'הגשות',           value: submissions.length,         color: errorSubs > 0 ? '#f87171' : undefined, sub: errorSubs > 0 ? `${errorSubs} שגיאות` : undefined },
            { label: 'נבדקו',           value: scores.length },
            { label: 'Brier ממוצע',     value: avgBrier != null ? avgBrier.toFixed(4) : '--', sub: 'נמוך = טוב יותר' },
            { label: 'עלות LLM סה"כ',  value: `$${totalCost.toFixed(4)}` },
            { label: 'סוכנים פעילים',   value: agents.filter((a: any) => a.is_active).length },
          ].map((card, i) => (
            <div key={i} style={{
              background: '#0e0e0e', border: '1px solid #1a1a1a',
              borderRadius: '6px', padding: '10px 14px', flex: '1 1 110px',
            }}>
              <div style={{ fontSize: '0.58rem', color: '#444', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{card.label}</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: (card as any).color ?? '#888', marginTop: '4px' }}>{card.value}</div>
              {card.sub && <div style={{ fontSize: '0.58rem', color: '#3a3a3a', marginTop: '2px' }}>{card.sub}</div>}
            </div>
          ))}
        </div>
      </Section>

      {/* ── Active Agents ── */}
      <Section title="סוכנים פעילים">
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {agents.filter((a: any) => a.is_active).map((a: any) => (
            <div key={a.id} style={{
              background: '#0a0a0a', border: '1px solid #1a1a1a',
              borderRadius: '5px', padding: '8px 14px', minWidth: '160px',
            }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 600, color: '#888' }}>{a.display_name}</div>
              <div style={{ fontSize: '0.6rem', color: '#444', marginTop: '2px', fontFamily: 'monospace' }}>{a.model_id}</div>
              <div style={{ fontSize: '0.58rem', color: '#333', marginTop: '1px' }}>{a.provider}</div>
              <div style={{ fontSize: '0.6rem', color: '#3a3a3a', marginTop: '3px' }}>
                עלות: ${costByAgent.get(a.id)?.toFixed(4) ?? '0.0000'}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Sync Jobs ── */}
      <Section title="משימות סנכרון">
        {syncJobs.length === 0 ? (
          <p style={{ color: '#3a3a3a', fontSize: '0.75rem' }}>אין משימות סנכרון עדיין.</p>
        ) : (
          <div style={{ border: '1px solid #141414', borderRadius: '6px', overflow: 'hidden' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  {['סטטוס', 'התחלה', 'סיום', 'רשומות', 'שגיאה'].map(h => (
                    <th key={h} style={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {syncJobs.map((job: any, i: number) => (
                  <tr key={job.id ?? i} style={{ borderBottom: '1px solid #111' }}>
                    <td style={TD}>
                      <span style={{
                        color: job.status === 'completed' ? '#4ade80'
                          : job.status === 'failed' ? '#f87171' : '#fbbf24',
                        fontSize: '0.7rem',
                      }}>
                        {job.status}
                      </span>
                    </td>
                    <td style={{ ...TD, color: '#555' }}>
                      {job.started_at ? new Date(job.started_at).toLocaleString('he-IL') : '--'}
                    </td>
                    <td style={{ ...TD, color: '#444' }}>
                      {job.completed_at ? new Date(job.completed_at).toLocaleString('he-IL') : '--'}
                    </td>
                    <td style={{ ...TD, color: '#666' }}>{job.records_processed ?? 0}</td>
                    <td style={{ ...TD, color: '#5a2a2a', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {job.error_text ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── Audit Trail ── */}
      <Section title="יומן ביקורת">
        {auditEvents.length === 0 ? (
          <p style={{ color: '#333', fontSize: '0.75rem' }}>אין אירועים.</p>
        ) : (
          <div style={{ border: '1px solid #111', borderRadius: '6px', overflow: 'hidden' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  {['אירוע', 'שחקן', 'ישות', 'זמן', 'פרטים'].map(h => (
                    <th key={h} style={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {auditEvents.map((ev: any) => (
                  <tr key={ev.id} style={{ borderBottom: '1px solid #0d0d0d' }}>
                    <td style={TD}>
                      <span style={{ color: EVENT_COLORS[ev.event_type] ?? '#555', fontSize: '0.68rem' }}>
                        {ev.event_type}
                      </span>
                    </td>
                    <td style={{ ...TD, color: '#555', fontSize: '0.68rem' }}>{ev.actor ?? '--'}</td>
                    <td style={{ ...TD, color: '#3a3a3a', fontFamily: 'monospace', fontSize: '0.62rem' }}>
                      {ev.entity_id ? ev.entity_id.slice(0, 12) + '…' : '--'}
                    </td>
                    <td style={{ ...TD, color: '#3a3a3a', fontSize: '0.65rem' }}>
                      {new Date(ev.created_at).toLocaleString('he-IL')}
                    </td>
                    <td style={{ ...TD, color: '#2e2e2e', fontSize: '0.62rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                      {ev.payload_json ? JSON.stringify(ev.payload_json).slice(0, 80) : '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── API Reference ── */}
      <Section title="ממשקי API">
        <div style={{
          background: '#090909', border: '1px solid #141414',
          borderRadius: '6px', padding: '14px 18px',
          fontSize: '0.68rem', color: '#3a3a3a', lineHeight: 2.2, fontFamily: 'monospace',
        }}>
          {[
            ['POST', '/api/forecast/sync-markets',  'סנכרן נתוני Polymarket'],
            ['POST', '/api/forecast/seed-agents',   'אפס הגדרות סוכנים'],
            ['POST', '/api/forecast/create-round',  'פתח סבב על שווקים'],
            ['POST', '/api/forecast/run-round',     'הרץ סוכנים על סבב'],
            ['POST', '/api/forecast/score-round',   'בדוק סבב שנסגר'],
            ['GET',  '/api/forecast/tick',          'cron endpoint (CRON_SECRET)'],
            ['POST', '/api/forecast/tick',          'טיק ידני (x-admin-password)'],
          ].map(([method, path, desc]) => (
            <div key={path} style={{ display: 'flex', gap: '12px' }}>
              <span style={{ color: method === 'POST' ? '#f59e0b' : '#60a5fa', minWidth: '40px' }}>{method}</span>
              <span style={{ color: '#555', minWidth: '280px' }}>{path}</span>
              <span style={{ color: '#2e2e2e' }}>— {desc}</span>
            </div>
          ))}
          <p style={{ marginTop: '10px', fontFamily: 'sans-serif', fontSize: '0.62rem', color: '#2e2e2e' }}>
            כל POST דורש header: <code style={{ color: '#444' }}>x-admin-password</code>
          </p>
        </div>
      </Section>
    </div>
  );
}
