/**
 * /forecast-arena/audit — Audit trail
 */

import { sfetch } from '@/lib/forecast/db';

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  let events: any[] = [];
  try {
    events = await sfetch('fa_audit_events?select=*&order=created_at.desc&limit=200');
    if (!Array.isArray(events)) events = [];
  } catch { /* ok */ }

  return (
    <div>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '16px', color: '#ccc' }}>
        Audit Trail ({events.length} events)
      </h2>

      {events.length === 0 ? (
        <p style={{ color: '#555', fontSize: '0.85rem' }}>
          No audit events yet. Events are logged automatically by system operations.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.78rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #333' }}>
                {['Time', 'Event', 'Entity', 'Actor', 'Details'].map(h => (
                  <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: '#666', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map((e: any) => (
                <tr key={e.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                  <td style={{ padding: '6px 10px', color: '#888', whiteSpace: 'nowrap' }}>
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <span style={{
                      padding:      '1px 6px',
                      borderRadius: '3px',
                      fontSize:     '0.72rem',
                      background:   e.event_type === 'agent_error' ? '#2e1a1a'
                        : e.event_type === 'agent_submission' ? '#1a2e1a'
                        : e.event_type === 'round_scored' ? '#1a1a2e'
                        : '#1a1a1a',
                      color:        e.event_type === 'agent_error' ? '#f87171'
                        : e.event_type === 'agent_submission' ? '#4ade80'
                        : e.event_type === 'round_scored' ? '#60a5fa'
                        : '#888',
                    }}>
                      {e.event_type}
                    </span>
                  </td>
                  <td style={{ padding: '6px 10px', color: '#888' }}>
                    {e.entity_type ? `${e.entity_type}/${(e.entity_id ?? '').slice(0, 8)}` : '--'}
                  </td>
                  <td style={{ padding: '6px 10px', color: '#888' }}>{e.actor ?? '--'}</td>
                  <td style={{ padding: '6px 10px', color: '#666', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.payload_json ? JSON.stringify(e.payload_json).slice(0, 120) : '--'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
