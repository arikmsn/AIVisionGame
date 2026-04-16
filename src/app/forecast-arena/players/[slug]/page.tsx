/**
 * /forecast-arena/players/[slug] — Agent detail page
 */

import Link from 'next/link';
import { sfetch } from '@/lib/forecast/db';

export const dynamic = 'force-dynamic';

export default async function PlayerDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let agent: any = null;
  let submissions: any[] = [];
  let scores: any[] = [];
  let wallet: any = null;

  try {
    const agentArr = await sfetch(`fa_agents?slug=eq.${slug}&select=*`);
    agent = Array.isArray(agentArr) && agentArr[0] ? agentArr[0] : null;

    if (agent) {
      [submissions, scores, wallet] = await Promise.all([
        sfetch(`fa_submissions?agent_id=eq.${agent.id}&select=*&order=submitted_at.desc&limit=50`).then((r: any) => Array.isArray(r) ? r : []),
        sfetch(`fa_scores?agent_id=eq.${agent.id}&select=*&order=scored_at.desc&limit=50`).then((r: any) => Array.isArray(r) ? r : []),
        sfetch(`fa_agent_wallets?agent_id=eq.${agent.id}&select=*`).then((r: any) => Array.isArray(r) && r[0] ? r[0] : null),
      ]);
    }
  } catch { /* ok */ }

  if (!agent) {
    return <p style={{ color: '#888' }}>Agent not found.</p>;
  }

  const totalCost = submissions.reduce((s: number, sub: any) => s + (Number(sub.cost_usd) || 0), 0);
  const totalTokens = submissions.reduce((s: number, sub: any) => s + (Number(sub.input_tokens) || 0) + (Number(sub.output_tokens) || 0), 0);
  const avgLatency = submissions.length > 0
    ? Math.round(submissions.reduce((s: number, sub: any) => s + (Number(sub.latency_ms) || 0), 0) / submissions.length)
    : 0;
  const errorCount = submissions.filter((s: any) => s.error_text).length;

  const avgBrier = scores.length > 0
    ? scores.reduce((s: number, sc: any) => s + (Number(sc.brier_score) || 0), 0) / scores.length
    : null;
  const avgEdge = scores.length > 0
    ? scores.reduce((s: number, sc: any) => s + (Number(sc.edge_at_submission) || 0), 0) / scores.length
    : null;

  return (
    <div>
      <Link href="/forecast-arena/players" style={{ color: '#666', textDecoration: 'none', fontSize: '0.75rem' }}>
        &larr; Players
      </Link>

      <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginTop: '12px', color: '#f0f0f0' }}>
        {agent.display_name}
      </h2>
      <p style={{ fontSize: '0.8rem', color: '#666', marginTop: '4px' }}>
        {agent.model_id} / {agent.provider} / {agent.prompt_version} /
        Strategy: {agent.strategy_profile_json?.strategy ?? '--'}
      </p>

      {/* Stats */}
      <div style={{ display: 'flex', gap: '16px', marginTop: '16px', flexWrap: 'wrap', fontSize: '0.8rem' }}>
        <div style={{ background: '#111', border: '1px solid #222', borderRadius: '6px', padding: '12px 16px' }}>
          <div style={{ color: '#666', fontSize: '0.68rem' }}>SUBMISSIONS</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{submissions.length}</div>
          {errorCount > 0 && <div style={{ color: '#f87171', fontSize: '0.68rem' }}>{errorCount} errors</div>}
        </div>
        <div style={{ background: '#111', border: '1px solid #222', borderRadius: '6px', padding: '12px 16px' }}>
          <div style={{ color: '#666', fontSize: '0.68rem' }}>AVG BRIER</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{avgBrier != null ? avgBrier.toFixed(4) : '--'}</div>
        </div>
        <div style={{ background: '#111', border: '1px solid #222', borderRadius: '6px', padding: '12px 16px' }}>
          <div style={{ color: '#666', fontSize: '0.68rem' }}>AVG EDGE</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 700, color: avgEdge != null && avgEdge > 0 ? '#4ade80' : '#f87171' }}>
            {avgEdge != null ? `${avgEdge > 0 ? '+' : ''}${avgEdge.toFixed(4)}` : '--'}
          </div>
        </div>
        <div style={{ background: '#111', border: '1px solid #222', borderRadius: '6px', padding: '12px 16px' }}>
          <div style={{ color: '#666', fontSize: '0.68rem' }}>TOTAL COST</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>${totalCost.toFixed(4)}</div>
        </div>
        <div style={{ background: '#111', border: '1px solid #222', borderRadius: '6px', padding: '12px 16px' }}>
          <div style={{ color: '#666', fontSize: '0.68rem' }}>AVG LATENCY</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{avgLatency}ms</div>
        </div>
        <div style={{ background: '#111', border: '1px solid #222', borderRadius: '6px', padding: '12px 16px' }}>
          <div style={{ color: '#666', fontSize: '0.68rem' }}>TOKENS</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{totalTokens.toLocaleString()}</div>
        </div>
        {wallet && (
          <div style={{ background: '#111', border: '1px solid #222', borderRadius: '6px', padding: '12px 16px' }}>
            <div style={{ color: '#666', fontSize: '0.68rem' }}>PAPER BALANCE</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>${Number(wallet.paper_balance_usd).toLocaleString()}</div>
          </div>
        )}
      </div>

      {/* Recent submissions */}
      <section style={{ marginTop: '28px' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#ccc' }}>
          Recent Submissions
        </h3>
        {submissions.length === 0 ? (
          <p style={{ color: '#555', fontSize: '0.8rem' }}>No submissions yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #333' }}>
                  {['Time', 'P(Yes)', 'Action', 'Brier', 'Edge', 'Latency', 'Cost', 'Rationale'].map(h => (
                    <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: '#666', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {submissions.map((sub: any) => {
                  const sc = scores.find((s: any) => s.submission_id === sub.id);
                  return (
                    <tr key={sub.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                      <td style={{ padding: '6px 10px', color: '#888', whiteSpace: 'nowrap' }}>
                        {new Date(sub.submitted_at).toLocaleString()}
                      </td>
                      <td style={{ padding: '6px 10px', fontWeight: 700 }}>
                        {(Number(sub.probability_yes) * 100).toFixed(1)}%
                      </td>
                      <td style={{ padding: '6px 10px', color: sub.action?.includes('yes') ? '#4ade80' : sub.action?.includes('no') ? '#f87171' : '#888' }}>
                        {sub.action ?? '--'}
                      </td>
                      <td style={{ padding: '6px 10px' }}>{sc ? Number(sc.brier_score).toFixed(4) : '--'}</td>
                      <td style={{ padding: '6px 10px' }}>
                        {sc ? (
                          <span style={{ color: Number(sc.edge_at_submission) > 0 ? '#4ade80' : '#f87171' }}>
                            {Number(sc.edge_at_submission).toFixed(4)}
                          </span>
                        ) : '--'}
                      </td>
                      <td style={{ padding: '6px 10px', color: '#888' }}>{sub.latency_ms ?? '--'}ms</td>
                      <td style={{ padding: '6px 10px', color: '#888' }}>${Number(sub.cost_usd || 0).toFixed(5)}</td>
                      <td style={{ padding: '6px 10px', color: '#888', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {sub.error_text ? <span style={{ color: '#f87171' }}>{sub.error_text.slice(0, 50)}</span> : (sub.rationale_short ?? '--')}
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
