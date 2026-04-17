/**
 * /forecast-arena/costs — Per-agent, per-model cost breakdown
 */

import { sfetch } from '@/lib/forecast/db';
import { FORECAST_MODEL_REGISTRY } from '@/lib/forecast/registry';

export const dynamic = 'force-dynamic';

const PROVIDER_COLOR: Record<string, string> = {
  anthropic:  '#f97316',
  openai:     '#10a37f',
  xai:        '#ef4444',
  google:     '#4285f4',
  openrouter: '#8b5cf6',
};

const PROVIDER_LABEL: Record<string, string> = {
  anthropic:  'Anthropic',
  openai:     'OpenAI',
  xai:        'xAI',
  google:     'Google',
  openrouter: 'OpenRouter',
};

const MODEL_COLOR: Record<string, string> = Object.fromEntries(
  FORECAST_MODEL_REGISTRY.map(m => [m.modelId, m.accentColor]),
);

// Published rates from registry for display
const MODEL_RATES: Record<string, { input: number; output: number }> = Object.fromEntries(
  FORECAST_MODEL_REGISTRY.map(m => [m.modelId, { input: m.costPerMInput, output: m.costPerMOutput }]),
);

export default async function CostsPage() {
  let submissions: any[] = [];
  let agents: any[]      = [];

  try {
    [submissions, agents] = await Promise.all([
      sfetch('fa_submissions?select=agent_id,cost_usd,input_tokens,output_tokens,latency_ms,submitted_at,error_text&order=submitted_at.desc&limit=1000')
        .then((r: any) => Array.isArray(r) ? r : []),
      sfetch('fa_agents?select=id,slug,display_name,model_id,provider,is_active')
        .then((r: any) => Array.isArray(r) ? r : []),
    ]);
  } catch { /* ok */ }

  const agentMap = new Map(agents.map((a: any) => [a.id, a]));

  type AgentRow = {
    slug: string; display_name: string; model_id: string; provider: string; is_active: boolean;
    total_cost: number; total_input: number; total_output: number;
    avg_latency: number; call_count: number; error_count: number;
  };

  const byAgent: Record<string, AgentRow> = {};

  for (const sub of submissions) {
    const agent = agentMap.get(sub.agent_id);
    if (!agent) continue;
    const key = agent.slug;
    if (!byAgent[key]) {
      byAgent[key] = {
        slug: agent.slug, display_name: agent.display_name,
        model_id: agent.model_id, provider: agent.provider, is_active: agent.is_active,
        total_cost: 0, total_input: 0, total_output: 0,
        avg_latency: 0, call_count: 0, error_count: 0,
      };
    }
    byAgent[key].total_cost   += Number(sub.cost_usd)      || 0;
    byAgent[key].total_input  += Number(sub.input_tokens)  || 0;
    byAgent[key].total_output += Number(sub.output_tokens) || 0;
    byAgent[key].avg_latency  += Number(sub.latency_ms)    || 0;
    byAgent[key].call_count   += 1;
    if (sub.error_text) byAgent[key].error_count += 1;
  }

  for (const v of Object.values(byAgent)) {
    if (v.call_count > 0) v.avg_latency = Math.round(v.avg_latency / v.call_count);
  }

  const allRows   = Object.values(byAgent).sort((a, b) => b.total_cost - a.total_cost);
  const coreRows  = allRows.filter(r => r.is_active);
  const legacyRows = allRows.filter(r => !r.is_active);
  const totalCost = allRows.reduce((s, v) => s + v.total_cost, 0);
  const totalCalls = submissions.length;

  const thStyle: React.CSSProperties = {
    padding:       '8px 12px',
    textAlign:     'left',
    color:         '#555',
    fontWeight:    500,
    whiteSpace:    'nowrap',
    fontSize:      '0.7rem',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    borderBottom:  '1px solid #222',
  };

  const renderRow = (row: AgentRow) => {
    const accent  = MODEL_COLOR[row.model_id] ?? PROVIDER_COLOR[row.provider] ?? '#444';
    const provLbl = PROVIDER_LABEL[row.provider] ?? row.provider;
    const rates   = MODEL_RATES[row.model_id];

    return (
      <tr key={row.slug} style={{ borderBottom: '1px solid #141414' }}>
        <td style={{ padding: '10px 12px' }}>
          <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#f0f0f0' }}>{row.display_name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
            <span style={{
              fontSize:      '0.62rem',
              fontWeight:    600,
              padding:       '1px 6px',
              borderRadius:  '3px',
              background:    `${accent}1a`,
              color:         accent,
              border:        `1px solid ${accent}33`,
              letterSpacing: '0.04em',
              textTransform: 'uppercase' as const,
            }}>
              {provLbl}
            </span>
            <span style={{ fontSize: '0.65rem', color: '#555', fontFamily: 'monospace' }}>{row.model_id}</span>
          </div>
        </td>
        <td style={{ padding: '10px 12px', fontSize: '0.8rem', color: '#888' }}>
          {rates
            ? <span title="from registry">${rates.input} / ${rates.output} per M</span>
            : <span style={{ color: '#444' }}>—</span>}
        </td>
        <td style={{ padding: '10px 12px', fontSize: '0.8rem', color: '#888' }}>{row.call_count}</td>
        <td style={{ padding: '10px 12px', fontSize: '0.8rem', color: row.error_count > 0 ? '#f87171' : '#555' }}>
          {row.error_count > 0 ? row.error_count : '—'}
        </td>
        <td style={{ padding: '10px 12px', fontSize: '0.9rem', fontWeight: 700, color: accent }}>
          ${row.total_cost.toFixed(5)}
        </td>
        <td style={{ padding: '10px 12px', fontSize: '0.8rem', color: '#888' }}>
          {row.total_input.toLocaleString()}
        </td>
        <td style={{ padding: '10px 12px', fontSize: '0.8rem', color: '#888' }}>
          {row.total_output.toLocaleString()}
        </td>
        <td style={{ padding: '10px 12px', fontSize: '0.8rem', color: '#888' }}>
          {row.avg_latency > 0 ? `${row.avg_latency.toLocaleString()}ms` : '—'}
        </td>
      </tr>
    );
  };

  const headers = ['Agent / Model', 'Rate (in/out per M)', 'Calls', 'Errors', 'Total Cost', 'Input Tokens', 'Output Tokens', 'Avg Latency'];

  return (
    <div>
      {/* Summary */}
      <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#ccc', margin: 0 }}>
          Costs & Usage
        </h2>
        <span style={{ fontSize: '0.8rem', color: '#666' }}>
          Total spend:&nbsp;
          <span style={{ color: '#f0f0f0', fontWeight: 700 }}>${totalCost.toFixed(4)}</span>
          &nbsp;·&nbsp;{totalCalls} API calls
        </span>
      </div>

      {/* Rate card for reference */}
      {FORECAST_MODEL_REGISTRY.length > 0 && (
        <div style={{ marginBottom: '28px' }}>
          <div style={{ fontSize: '0.7rem', color: '#444', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '8px' }}>
            Registry rates (USD per 1M tokens)
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {FORECAST_MODEL_REGISTRY.map(m => {
              const accent = m.accentColor;
              return (
                <div key={m.modelId} style={{
                  background:   `${accent}0d`,
                  border:       `1px solid ${accent}33`,
                  borderRadius: '4px',
                  padding:      '6px 12px',
                  fontSize:     '0.72rem',
                  color:        '#888',
                }}>
                  <span style={{ color: accent, fontWeight: 600 }}>{m.displayName}</span>
                  <span style={{ color: '#555', margin: '0 4px' }}>·</span>
                  <span style={{ color: '#888' }}>${m.costPerMInput}</span>
                  <span style={{ color: '#444' }}> / </span>
                  <span style={{ color: '#888' }}>${m.costPerMOutput}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {allRows.length === 0 ? (
        <p style={{ color: '#555', fontSize: '0.85rem' }}>No cost data yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          {coreRows.length > 0 && (
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>{headers.map(h => <th key={h} style={thStyle}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {coreRows.map(row => renderRow(row))}
              </tbody>
            </table>
          )}

          {legacyRows.length > 0 && (
            <>
              <div style={{ marginTop: '28px', marginBottom: '8px', fontSize: '0.7rem', color: '#3a3a3a', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Legacy agents (inactive)
              </div>
              <table style={{ borderCollapse: 'collapse', width: '100%', opacity: 0.5 }}>
                <tbody>{legacyRows.map(row => renderRow(row))}</tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}
