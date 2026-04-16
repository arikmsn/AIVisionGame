/**
 * /forecast-arena/rounds/[id] — Round detail with submissions
 */

import Link from 'next/link';
import { sfetch } from '@/lib/forecast/db';

export const dynamic = 'force-dynamic';

export default async function RoundDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let round: any = null;
  let market: any = null;
  let submissions: any[] = [];
  let scores: any[] = [];
  let agents: any[] = [];

  try {
    const roundArr = await sfetch(`fa_rounds?id=eq.${id}&select=*`);
    round = Array.isArray(roundArr) && roundArr[0] ? roundArr[0] : null;

    if (round) {
      [market, submissions, scores, agents] = await Promise.all([
        sfetch(`fa_markets?id=eq.${round.market_id}&select=*`).then((r: any[]) => r?.[0] ?? null),
        sfetch(`fa_submissions?round_id=eq.${id}&select=*&order=probability_yes.desc`).then((r: any) => Array.isArray(r) ? r : []),
        sfetch(`fa_scores?round_id=eq.${id}&select=*`).then((r: any) => Array.isArray(r) ? r : []),
        sfetch('fa_agents?select=id,slug,display_name').then((r: any) => Array.isArray(r) ? r : []),
      ]);
    }
  } catch { /* ok */ }

  if (!round) {
    return <p style={{ color: '#888' }}>Round not found.</p>;
  }

  const agentMap = new Map(agents.map((a: any) => [a.id, a]));
  const scoreMap = new Map(scores.map((s: any) => [s.submission_id, s]));

  return (
    <div>
      <Link href="/forecast-arena/rounds" style={{ color: '#666', textDecoration: 'none', fontSize: '0.75rem' }}>
        &larr; Rounds
      </Link>

      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginTop: '12px', color: '#f0f0f0' }}>
        Round {round.round_number}
        <span style={{ color: '#666', fontWeight: 400, marginLeft: '8px' }}>
          {round.status}
        </span>
      </h2>

      {market && (
        <p style={{ fontSize: '0.8rem', color: '#888', marginTop: '4px' }}>
          Market: <Link href={`/forecast-arena/markets/${market.id}`} style={{ color: '#d4f25a', textDecoration: 'none' }}>
            {market.title?.slice(0, 80)}
          </Link>
        </p>
      )}

      <div style={{ display: 'flex', gap: '24px', marginTop: '12px', fontSize: '0.8rem', flexWrap: 'wrap' }}>
        <div><span style={{ color: '#666' }}>Market YES at open: </span>{round.market_yes_price_at_open != null ? `${(Number(round.market_yes_price_at_open) * 100).toFixed(1)}%` : '--'}</div>
        <div><span style={{ color: '#666' }}>Opened: </span>{new Date(round.opened_at).toLocaleString()}</div>
        {round.resolved_at && <div><span style={{ color: '#666' }}>Resolved: </span>{new Date(round.resolved_at).toLocaleString()}</div>}
      </div>

      {/* Submissions table */}
      <section style={{ marginTop: '24px' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#ccc' }}>
          Submissions ({submissions.length})
        </h3>

        {submissions.length === 0 ? (
          <p style={{ color: '#555', fontSize: '0.8rem' }}>No submissions yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #333' }}>
                  {['Agent', 'P(Yes)', 'Confidence', 'Action', 'Brier', 'Edge', 'Latency', 'Cost', 'Rationale'].map(h => (
                    <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: '#666', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {submissions.map((sub: any) => {
                  const agent = agentMap.get(sub.agent_id);
                  const score = scoreMap.get(sub.id);
                  const hasError = !!sub.error_text;

                  return (
                    <tr key={sub.id} style={{ borderBottom: '1px solid #1a1a1a', opacity: hasError ? 0.6 : 1 }}>
                      <td style={{ padding: '6px 10px', fontWeight: 600 }}>
                        {agent ? (
                          <Link href={`/forecast-arena/players/${agent.slug}`} style={{ color: '#d4f25a', textDecoration: 'none' }}>
                            {agent.display_name}
                          </Link>
                        ) : sub.agent_id?.slice(0, 8)}
                      </td>
                      <td style={{ padding: '6px 10px', fontWeight: 700 }}>
                        {(Number(sub.probability_yes) * 100).toFixed(1)}%
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        {sub.confidence != null ? Number(sub.confidence).toFixed(2) : '--'}
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        <span style={{
                          color: sub.action?.includes('yes') ? '#4ade80'
                            : sub.action?.includes('no') ? '#f87171'
                            : '#888',
                        }}>
                          {sub.action ?? '--'}
                        </span>
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        {score ? Number(score.brier_score).toFixed(4) : '--'}
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        {score ? (
                          <span style={{ color: Number(score.edge_at_submission) > 0 ? '#4ade80' : '#f87171' }}>
                            {Number(score.edge_at_submission) > 0 ? '+' : ''}{Number(score.edge_at_submission).toFixed(4)}
                          </span>
                        ) : '--'}
                      </td>
                      <td style={{ padding: '6px 10px', color: '#888' }}>
                        {sub.latency_ms != null ? `${sub.latency_ms}ms` : '--'}
                      </td>
                      <td style={{ padding: '6px 10px', color: '#888' }}>
                        {sub.cost_usd != null ? `$${Number(sub.cost_usd).toFixed(5)}` : '--'}
                      </td>
                      <td style={{ padding: '6px 10px', color: '#888', maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {hasError ? <span style={{ color: '#f87171' }}>{sub.error_text?.slice(0, 60)}</span> : (sub.rationale_short ?? '--')}
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
