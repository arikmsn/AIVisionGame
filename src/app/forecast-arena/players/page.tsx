/**
 * /forecast-arena/players — Forecast Arena agent roster
 */

import Link from 'next/link';
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

export default async function PlayersPage() {
  let agents: any[]      = [];
  let leaderboard: any[] = [];

  try {
    [agents, leaderboard] = await Promise.all([
      sfetch('fa_agents?select=*&order=created_at.asc').then((r: any) => Array.isArray(r) ? r : []),
      sfetch('fa_v_leaderboard?select=*').then((r: any) => Array.isArray(r) ? r : []),
    ]);
  } catch { /* tables may not exist yet */ }

  const lbMap  = new Map(leaderboard.map((l: any) => [l.agent_id, l]));
  const core   = agents.filter((a: any) => a.is_active);
  const legacy = agents.filter((a: any) => !a.is_active);

  return (
    <div>
      {/* ── Core League ── */}
      <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'baseline', gap: '12px' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#ccc', margin: 0 }}>
          Core League
        </h2>
        <span style={{ fontSize: '0.72rem', color: '#555' }}>
          6 top models · same as idiom arena
        </span>
      </div>

      {core.length === 0 ? (
        <p style={{ color: '#555', fontSize: '0.85rem', marginBottom: '32px' }}>
          No active agents. Run{' '}
          <code style={{ color: '#d4f25a' }}>POST /api/forecast/seed-agents</code>{' '}
          to set up the 6-model league.
        </p>
      ) : (
        <div style={{
          display:             'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap:                 '12px',
          marginBottom:        '40px',
        }}>
          {core.map((a: any) => {
            const lb      = lbMap.get(a.id);
            const accent  = MODEL_COLOR[a.model_id] ?? PROVIDER_COLOR[a.provider] ?? '#444';
            const provLbl = PROVIDER_LABEL[a.provider] ?? a.provider;

            return (
              <Link key={a.id} href={`/forecast-arena/players/${a.slug}`}
                style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{
                  background:   '#111',
                  border:       `1px solid ${accent}44`,
                  borderLeft:   `3px solid ${accent}`,
                  borderRadius: '6px',
                  padding:      '16px 20px',
                }}>
                  {/* Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f0f0f0' }}>
                        {a.display_name}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
                        <span style={{
                          fontSize:      '0.63rem',
                          fontWeight:    600,
                          padding:       '2px 7px',
                          borderRadius:  '3px',
                          background:    `${accent}1a`,
                          color:         accent,
                          border:        `1px solid ${accent}33`,
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase' as const,
                        }}>
                          {provLbl}
                        </span>
                        <span style={{ fontSize: '0.67rem', color: '#555', fontFamily: 'monospace' }}>
                          {a.model_id}
                        </span>
                      </div>
                    </div>
                    <span style={{
                      fontSize:     '0.67rem',
                      padding:      '2px 8px',
                      borderRadius: '3px',
                      background:   '#1a2e1a',
                      color:        '#4ade80',
                      whiteSpace:   'nowrap' as const,
                    }}>
                      active
                    </span>
                  </div>

                  {/* Stats */}
                  <div style={{ display: 'flex', gap: '16px', marginTop: '12px', fontSize: '0.75rem' }}>
                    <div>
                      <span style={{ color: '#666' }}>Rounds: </span>
                      <span style={{ fontWeight: 600 }}>{lb?.total_submissions ?? 0}</span>
                    </div>
                    <div>
                      <span style={{ color: '#666' }}>Brier: </span>
                      <span style={{ fontWeight: 600 }}>
                        {lb?.avg_brier != null ? Number(lb.avg_brier).toFixed(4) : '—'}
                      </span>
                    </div>
                    <div>
                      <span style={{ color: '#666' }}>Edge: </span>
                      <span style={{
                        fontWeight: 600,
                        color: lb?.avg_edge > 0 ? '#4ade80' : lb?.avg_edge < 0 ? '#f87171' : '#888',
                      }}>
                        {lb?.avg_edge != null
                          ? `${Number(lb.avg_edge) > 0 ? '+' : ''}${Number(lb.avg_edge).toFixed(4)}`
                          : '—'}
                      </span>
                    </div>
                    <div>
                      <span style={{ color: '#666' }}>Cost: </span>
                      <span style={{ color: '#888' }}>
                        ${lb?.total_cost_usd != null ? Number(lb.total_cost_usd).toFixed(4) : '0'}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* ── Legacy agents ── */}
      {legacy.length > 0 && (
        <>
          <h3 style={{ fontSize: '0.8rem', fontWeight: 600, color: '#444', marginBottom: '10px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Legacy agents (disabled)
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '8px' }}>
            {legacy.map((a: any) => (
              <Link key={a.id} href={`/forecast-arena/players/${a.slug}`}
                style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{
                  background:   '#0a0a0a',
                  border:       '1px solid #1a1a1a',
                  borderRadius: '6px',
                  padding:      '12px 16px',
                  opacity:      0.6,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#555' }}>{a.display_name}</div>
                      <div style={{ fontSize: '0.67rem', color: '#3a3a3a', marginTop: '2px', fontFamily: 'monospace' }}>
                        {a.model_id}
                      </div>
                    </div>
                    <span style={{ fontSize: '0.63rem', padding: '2px 7px', borderRadius: '3px', background: '#111', color: '#3a3a3a' }}>
                      inactive
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
