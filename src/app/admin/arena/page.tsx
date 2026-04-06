/**
 * Arena Admin Dashboard — Phase 3
 *
 * Server component. Reads v_model_career_stats and v_run_cost_summary from
 * Supabase using the service role key. Middleware handles /admin/* auth.
 */

import { RunLauncher } from './RunLauncher';

// ── Supabase helper (server-side only) ────────────────────────────────────────

async function fetchView<T>(view: string): Promise<T[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];
  try {
    const res = await fetch(`${url}/rest/v1/${view}?select=*&order=total_score.desc`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
      next:    { revalidate: 60 }, // cache for 60s
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function fetchRunSummary(): Promise<RunSummary[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];
  try {
    const res = await fetch(
      `${url}/rest/v1/v_run_cost_summary?select=*&order=run_started_at.desc&limit=10`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
        next:    { revalidate: 30 },
      },
    );
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface CareerStat {
  model_id:                string;
  tournaments_played:      number;
  total_rounds:            number;
  avg_round_score:         number;
  total_score:             number;
  correct_pct:             number;
  dnf_pct:                 number;
  total_cost_usd:          number;
  score_per_dollar:        number;
  standing_perception_pct: number;
  rationality_pct:         number | null;
}

interface RunSummary {
  run_id:              string;
  tournaments_in_run:  number;
  run_total_cost_usd:  number;
  run_started_at:      string;
  completed:           number;
  running:             number;
  cancelled:           number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, decimals = 1): string {
  if (n == null) return '—';
  return n.toFixed(decimals);
}

function pct(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n.toFixed(1)}%`;
}

function usd(n: number | null | undefined): string {
  if (n == null) return '—';
  return `$${n.toFixed(4)}`;
}

const MODEL_LABELS: Record<string, string> = {
  'gemini-2.5-pro':                            'Gemini 2.5 Pro',
  'gemma-3-27b-it':                            'Gemma 3 27B',
  'claude-opus-4-6':                           'Claude Opus 4.6',
  'claude-sonnet-4-6':                         'Claude Sonnet 4.6',
  'gpt-4.1':                                   'GPT-4.1',
  'grok-4.20-0309-non-reasoning':              'Grok 4.20',
  'meta-llama/llama-4-scout-17b-16e-instruct': 'Llama 4 Scout',
  'mistral-large-latest':                      'Mistral Large',
  'pixtral-large-latest':                      'Pixtral Large',
  'qwen/qwen2.5-vl-72b-instruct':             'Qwen 2.5-VL 72B',
  'moonshotai/Kimi-K2.5':                     'Kimi K2.5',
};

function label(modelId: string): string {
  return MODEL_LABELS[modelId] ?? modelId;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ArenaAdminPage() {
  const [stats, runs] = await Promise.all([
    fetchView<CareerStat>('v_model_career_stats'),
    fetchRunSummary(),
  ]);

  return (
    <div style={{ fontFamily: 'monospace', padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Arena Admin Dashboard</h1>
      <p style={{ color: '#666', marginBottom: '2rem', fontSize: '0.85rem' }}>
        Phase 3 · {stats.length} models · auto-refreshes on page reload
      </p>

      {/* ── Career Stats ───────────────────────────────────────────────────── */}
      <section style={{ marginBottom: '3rem' }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>Model Career Stats</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ background: '#f0f0f0' }}>
                {[
                  '#', 'Model', 'Tnmts', 'Rounds', 'Avg Score', 'Total Score',
                  'Correct%', 'DNF%', 'Cost', 'Score/$',
                  'Standing%', 'Rational%',
                ].map(h => (
                  <th key={h} style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '2px solid #ccc', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.length === 0 ? (
                <tr>
                  <td colSpan={12} style={{ padding: '1rem', color: '#666' }}>
                    No data yet. Run some tournaments first.
                  </td>
                </tr>
              ) : stats.map((s, idx) => (
                <tr key={s.model_id} style={{ background: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                  <td style={{ padding: '5px 10px', color: '#888' }}>{idx + 1}</td>
                  <td style={{ padding: '5px 10px', fontWeight: 600 }}>{label(s.model_id)}</td>
                  <td style={{ padding: '5px 10px' }}>{s.tournaments_played}</td>
                  <td style={{ padding: '5px 10px' }}>{s.total_rounds}</td>
                  <td style={{ padding: '5px 10px' }}>{fmt(s.avg_round_score)}</td>
                  <td style={{ padding: '5px 10px', fontWeight: 600 }}>{fmt(s.total_score, 0)}</td>
                  <td style={{ padding: '5px 10px', color: s.correct_pct >= 50 ? '#16a34a' : '#dc2626' }}>
                    {pct(s.correct_pct)}
                  </td>
                  <td style={{ padding: '5px 10px', color: s.dnf_pct > 10 ? '#dc2626' : '#374151' }}>
                    {pct(s.dnf_pct)}
                  </td>
                  <td style={{ padding: '5px 10px' }}>{usd(s.total_cost_usd)}</td>
                  <td style={{ padding: '5px 10px' }}>{fmt(s.score_per_dollar)}</td>
                  <td style={{ padding: '5px 10px' }}>{pct(s.standing_perception_pct)}</td>
                  <td style={{ padding: '5px 10px' }}>{pct(s.rationality_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Run History ────────────────────────────────────────────────────── */}
      <section style={{ marginBottom: '3rem' }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>Recent Runs (last 10)</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ background: '#f0f0f0' }}>
                {['Run ID', 'Tournaments', 'Total Cost', 'Completed', 'Running', 'Started'].map(h => (
                  <th key={h} style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '2px solid #ccc' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '1rem', color: '#666' }}>No runs yet.</td>
                </tr>
              ) : runs.map((r, idx) => (
                <tr key={r.run_id} style={{ background: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                  <td style={{ padding: '5px 10px', color: '#888', fontFamily: 'monospace' }}>
                    {r.run_id.slice(0, 8)}…
                  </td>
                  <td style={{ padding: '5px 10px' }}>{r.tournaments_in_run}</td>
                  <td style={{ padding: '5px 10px', fontWeight: 600 }}>{usd(r.run_total_cost_usd)}</td>
                  <td style={{ padding: '5px 10px', color: '#16a34a' }}>{r.completed}</td>
                  <td style={{ padding: '5px 10px', color: '#2563eb' }}>{r.running}</td>
                  <td style={{ padding: '5px 10px', color: '#666' }}>
                    {new Date(r.run_started_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Run Launcher ───────────────────────────────────────────────────── */}
      <section>
        <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>Launch a Run</h2>
        <RunLauncher />
      </section>
    </div>
  );
}
