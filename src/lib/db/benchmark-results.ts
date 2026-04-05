/**
 * Benchmark Results — persistent log of every probe run.
 *
 * Schema (run supabase/migrations/005_create_benchmark_results.sql):
 *
 *   benchmark_results (
 *     id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
 *     created_at    timestamptz  NOT NULL DEFAULT now(),
 *     idiom_phrase  text         NOT NULL,
 *     model_id      text         NOT NULL,
 *     guess         text         NOT NULL DEFAULT '',
 *     is_correct    boolean      NOT NULL DEFAULT false,
 *     latency_ms    integer,
 *     strategy      text         NOT NULL DEFAULT '',
 *     image_url     text         NOT NULL DEFAULT '',
 *     error         text
 *   )
 *
 * insertBenchmarkResult() is awaited in the probe route — Vercel serverless
 * functions terminate as soon as the response is sent, so fire-and-forget
 * is unreliable.  The 3 s timeout keeps the write well within maxDuration=60.
 * Silently no-ops when Supabase is not configured.
 *
 * fetchAllBenchmarkResults() is used by /api/benchmark/stats to pull the
 * full dataset for in-process aggregation. Capped at 5000 rows (newest first)
 * which covers thousands of benchmark runs before needing SQL-side aggregation.
 */

export interface BenchmarkResultRow {
  idiomPhrase: string;
  modelId:     string;
  guess:       string;
  isCorrect:   boolean;
  latencyMs:   number | null;
  strategy:    string;
  imageUrl:    string;
  error?:      string;   // undefined = clean run
}

export interface RawBenchmarkResult {
  id:           string;
  created_at:   string;
  idiom_phrase: string;
  model_id:     string;
  guess:        string;
  is_correct:   boolean;
  latency_ms:   number | null;
  strategy:     string;
  image_url:    string;
  error:        string | null;
}

// ── Internal helpers ─────────────────────────────────────────────��────────────

function supabaseCreds(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

const ENDPOINT = (url: string) => `${url}/rest/v1/benchmark_results`;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Insert a single probe result row.
 *
 * Designed to be called fire-and-forget (caller does NOT await):
 *   insertBenchmarkResult({ ... }).catch(() => {});
 *
 * Returns true on success, false on any failure (including unconfigured).
 */
export async function insertBenchmarkResult(row: BenchmarkResultRow): Promise<boolean> {
  const creds = supabaseCreds();
  if (!creds) return false; // silently skip — Supabase not configured

  try {
    const res = await fetch(ENDPOINT(creds.url), {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':         creds.key,
        'Authorization': `Bearer ${creds.key}`,
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify({
        idiom_phrase: row.idiomPhrase,
        model_id:     row.modelId,
        guess:        row.guess,
        is_correct:   row.isCorrect,
        latency_ms:   row.latencyMs ?? null,
        strategy:     row.strategy,
        image_url:    row.imageUrl,
        error:        row.error ?? null,
      }),
      signal: AbortSignal.timeout(3_000), // 3 s fits within maxDuration=60 even after a 55 s inference
    });

    return res.ok;
  } catch {
    return false; // network error — never propagate, this is fire-and-forget
  }
}

/**
 * Fetch the newest N benchmark result rows for analytics aggregation.
 * Returns [] when Supabase is unconfigured or any error occurs.
 */
export async function fetchAllBenchmarkResults(limit = 5000): Promise<RawBenchmarkResult[]> {
  const creds = supabaseCreds();
  if (!creds) return [];

  try {
    const res = await fetch(
      `${ENDPOINT(creds.url)}?select=*&order=created_at.desc&limit=${limit}`,
      {
        headers: {
          'apikey':         creds.key,
          'Authorization': `Bearer ${creds.key}`,
        },
        signal: AbortSignal.timeout(8_000),
      },
    );

    if (!res.ok) return [];
    return (await res.json()) as RawBenchmarkResult[];
  } catch {
    return [];
  }
}
