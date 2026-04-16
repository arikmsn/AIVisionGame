/**
 * /forecast-arena/players — Agents/players overview
 */

import Link from 'next/link';
import { sfetch } from '@/lib/forecast/db';

export const dynamic = 'force-dynamic';

export default async function PlayersPage() {
  let agents: any[] = [];
  let leaderboard: any[] = [];

  try {
    [agents, leaderboard] = await Promise.all([
      sfetch('fa_agents?select=*&order=created_at.asc').then((r: any) => Array.isArray(r) ? r : []),
      sfetch('fa_v_leaderboard?select=*').then((r: any) => Array.isArray(r) ? r : []),
    ]);
  } catch { /* ok */ }

  const lbMap = new Map(leaderboard.map((l: any) => [l.agent_id, l]));

  return (
    <div>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '16px', color: '#ccc' }}>
        Forecast Agents ({agents.length})
      </h2>

      {agents.length === 0 ? (
        <p style={{ color: '#555', fontSize: '0.85rem' }}>
          No agents registered. Run POST /api/forecast/seed-agents to set up the default agents.
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
          {agents.map((a: any) => {
            const lb = lbMap.get(a.id);
            return (
              <Link
                key={a.id}
                href={`/forecast-arena/players/${a.slug}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div style={{
                  background:   '#111',
                  border:       '1px solid #222',
                  borderRadius: '6px',
                  padding:      '16px 20px',
                  transition:   'border-color 0.15s',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f0f0f0' }}>
                        {a.display_name}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#666', marginTop: '2px' }}>
                        {a.model_id} / {a.provider}
                      </div>
                    </div>
                    <span style={{
                      fontSize: '0.68rem',
                      padding: '2px 8px',
                      borderRadius: '3px',
                      background: a.is_active ? '#1a2e1a' : '#2e1a1a',
                      color: a.is_active ? '#4ade80' : '#f87171',
                    }}>
                      {a.is_active ? 'active' : 'inactive'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '16px', marginTop: '12px', fontSize: '0.75rem' }}>
                    <div>
                      <span style={{ color: '#666' }}>Subs: </span>
                      <span style={{ fontWeight: 600 }}>{lb?.total_submissions ?? 0}</span>
                    </div>
                    <div>
                      <span style={{ color: '#666' }}>Brier: </span>
                      <span style={{ fontWeight: 600 }}>{lb?.avg_brier != null ? Number(lb.avg_brier).toFixed(4) : '--'}</span>
                    </div>
                    <div>
                      <span style={{ color: '#666' }}>Edge: </span>
                      <span style={{ fontWeight: 600, color: lb?.avg_edge > 0 ? '#4ade80' : '#f87171' }}>
                        {lb?.avg_edge != null ? Number(lb.avg_edge).toFixed(4) : '--'}
                      </span>
                    </div>
                    <div>
                      <span style={{ color: '#666' }}>Cost: </span>
                      <span>${lb?.total_cost_usd != null ? Number(lb.total_cost_usd).toFixed(4) : '0'}</span>
                    </div>
                  </div>

                  <div style={{ fontSize: '0.68rem', color: '#555', marginTop: '8px' }}>
                    Strategy: {a.strategy_profile_json?.strategy ?? a.prompt_version}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
