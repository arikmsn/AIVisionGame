'use client';

/**
 * Run Launcher — Phase 3
 *
 * Client component — lets admin trigger a run of N tournaments via
 * POST /api/arena/run. Requires CHAIN_SECRET as bearer token.
 */

import { useState } from 'react';

interface RunResult {
  run_id:         string;
  tournament_ids: string[];
  queued:         number;
  failures?:      string[];
}

export function RunLauncher() {
  const [tournaments, setTournaments]   = useState(2);
  const [rounds, setRounds]             = useState(20);
  const [budget, setBudget]             = useState(5.00);
  const [secret, setSecret]             = useState('');
  const [loading, setLoading]           = useState(false);
  const [result, setResult]             = useState<RunResult | null>(null);
  const [error, setError]               = useState<string | null>(null);

  async function launch() {
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const res = await fetch('/api/arena/run', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
        },
        body: JSON.stringify({ tournaments, rounds, budgetCapUsd: budget, confirm_intentional: true }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      const data = await res.json() as RunResult;
      setResult(data);
    } catch (err: any) {
      setError(err?.message ?? 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    padding:      '4px 8px',
    border:       '1px solid #ccc',
    borderRadius: '4px',
    fontFamily:   'monospace',
    fontSize:     '0.85rem',
    width:        '80px',
  };

  return (
    <div style={{ fontSize: '0.85rem' }}>
      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ color: '#555' }}>Tournaments</span>
          <input
            type="number" min={1} max={10} value={tournaments}
            onChange={e => setTournaments(Number(e.target.value))}
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ color: '#555' }}>Rounds each</span>
          <input
            type="number" min={1} max={50} value={rounds}
            onChange={e => setRounds(Number(e.target.value))}
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ color: '#555' }}>Budget/tournament ($)</span>
          <input
            type="number" min={0.5} max={100} step={0.5} value={budget}
            onChange={e => setBudget(Number(e.target.value))}
            style={{ ...inputStyle, width: '90px' }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ color: '#555' }}>Chain secret</span>
          <input
            type="password" value={secret} placeholder="CHAIN_SECRET"
            onChange={e => setSecret(e.target.value)}
            style={{ ...inputStyle, width: '150px' }}
          />
        </label>

        <button
          onClick={launch}
          disabled={loading}
          style={{
            padding:         '6px 20px',
            background:      loading ? '#94a3b8' : '#1d4ed8',
            color:           '#fff',
            border:          'none',
            borderRadius:    '4px',
            cursor:          loading ? 'not-allowed' : 'pointer',
            fontFamily:      'monospace',
            fontSize:        '0.85rem',
            alignSelf:       'flex-end',
          }}
        >
          {loading ? 'Launching…' : 'Launch Run'}
        </button>
      </div>

      <p style={{ color: '#888', fontSize: '0.75rem', marginBottom: '1rem' }}>
        Estimated max cost: ${(tournaments * budget).toFixed(2)} total (${budget}/tournament &times; {tournaments})
      </p>

      {error && (
        <div style={{ padding: '10px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '4px', color: '#991b1b', marginBottom: '1rem' }}>
          Error: {error}
        </div>
      )}

      {result && (
        <div style={{ padding: '10px', background: '#dcfce7', border: '1px solid #86efac', borderRadius: '4px', color: '#166534' }}>
          <strong>Run launched!</strong>
          <br />Run ID: <code>{result.run_id}</code>
          <br />{result.queued}/{result.tournament_ids.length} tournaments queued via QStash
          {result.failures && result.failures.length > 0 && (
            <div style={{ color: '#dc2626', marginTop: '4px' }}>
              Failures: {result.failures.join(', ')}
            </div>
          )}
          <div style={{ marginTop: '8px', color: '#166534', fontSize: '0.75rem' }}>
            Tournament IDs:
            <ul style={{ margin: '4px 0 0', paddingLeft: '1.5rem' }}>
              {result.tournament_ids.map(id => <li key={id}><code>{id}</code></li>)}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
