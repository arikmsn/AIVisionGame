/**
 * /forecast-arena/costs — Costs/usage breakdown
 */

import { sfetch } from '@/lib/forecast/db';

export const dynamic = 'force-dynamic';

export default async function CostsPage() {
  let submissions: any[] = [];
  let agents: any[] = [];

  try {
    [submissions, agents] = await Promise.all([
      sfetch('fa_submissions?select=agent_id,cost_usd,input_tokens,output_tokens,latency_ms,submitted_at,error_text&order=submitted_at.desc&limit=1000').then((r: any) => Array.isArray(r) ? r : []),
      sfetch('fa_agents?select=id,slug,display_name,model_id,provider').then((r: any) => Array.isArray(r) ? r : []),
    ]);
  } catch { /* ok */ }

  const agentMap = new Map(agents.map((a: any) => [a.id, a]));

  // Aggregate by agent
  const byAgent: Record<string, {
    slug: string; display_name: string; model_id: string; provider: string;
    total_cost: number; total_input: number; total_output: number;
    avg_latency: number; call_count: number; error_count: number;
  }> = {};

  for (const sub of submissions) {
    const agent = agentMap.get(sub.agent_id);
    if (!agent) continue;
    const key = agent.slug;
    if (!byAgent[key]) {
      byAgent[key] = {
        slug: agent.slug, display_name: agent.display_name,
        model_id: agent.model_id, provider: agent.provider,
        total_cost: 0, total_input: 0, total_output: 0,
        avg_latency: 0, call_count: 0, error_count: 0,
      };
    }
    byAgent[key].total_cost   += Number(sub.cost_usd) || 0;
    byAgent[key].total_input  += Number(sub.input_tokens) || 0;
    byAgent[key].total_output += Number(sub.output_tokens) || 0;
    byAgent[key].avg_latency  += Number(sub.latency_ms) || 0;
    byAgent[key].call_count   += 1;
    if (sub.error_text) byAgent[key].error_count += 1;
  }

  for (const v of Object.values(byAgent)) {
    if (v.call_count > 0) v.avg_latency = Math.round(v.avg_latency / v.call_count);
  }

  const agentRows = Object.values(byAgent).sort((a, b) => b.total_cost - a.total_cost);
  const totalCost = agentRows.reduce((s, v) => s + v.total_cost, 0);

  return (
    <div>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '8px', color: '#ccc' }}>
        Costs & Usage
      </h2>
      <p style={{ fontSize: '0.8rem', color: '#666', marginBottom: '20px' }}>
        Total spend: <span style={{ color: '#f0f0f0', fontWeight: 700 }}>${totalCost.toFixed(4)}</span>
        &nbsp;&middot;&nbsp; {submissions.length} API calls
      </p>

      {agentRows.length === 0 ? (
        <p style={{ color: '#555', fontSize: '0.85rem' }}>No cost data yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #333' }}>
                {['Agent', 'Model', 'Provider', 'Calls', 'Errors', 'Total Cost', 'Input Tokens', 'Output Tokens', 'Avg Latency'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: '#666', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agentRows.map(row => (
                <tr key={row.slug} style={{ borderBottom: '1px solid #1a1a1a' }}>
                  <td style={{ padding: '8px 12px', fontWeight: 600 }}>{row.display_name}</td>
                  <td style={{ padding: '8px 12px', color: '#888' }}>{row.model_id}</td>
                  <td style={{ padding: '8px 12px', color: '#888' }}>{row.provider}</td>
                  <td style={{ padding: '8px 12px' }}>{row.call_count}</td>
                  <td style={{ padding: '8px 12px', color: row.error_count > 0 ? '#f87171' : '#555' }}>
                    {row.error_count}
                  </td>
                  <td style={{ padding: '8px 12px', fontWeight: 700 }}>${row.total_cost.toFixed(5)}</td>
                  <td style={{ padding: '8px 12px', color: '#888' }}>{row.total_input.toLocaleString()}</td>
                  <td style={{ padding: '8px 12px', color: '#888' }}>{row.total_output.toLocaleString()}</td>
                  <td style={{ padding: '8px 12px', color: '#888' }}>{row.avg_latency}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
