/**
 * Guesses — per-event Supabase persistence.
 *
 * Schema (run supabase/migrations/001_create_guesses.sql to provision):
 *
 *   guesses (
 *     id               uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
 *     room_id          text         NOT NULL,
 *     round_id         text         NOT NULL,
 *     agent_name       text         NOT NULL,
 *     session_id       text,
 *     guess            text         NOT NULL,
 *     is_correct       boolean      NOT NULL DEFAULT false,
 *     solve_time_ms    bigint       NOT NULL DEFAULT 0,
 *     latency_ms       bigint,           -- agent think time (LLM call or external)
 *     potential_reward integer,
 *     attempt_number   smallint,
 *     zero_learning    boolean      NOT NULL DEFAULT false,
 *     rationale        text,
 *     is_external      boolean      NOT NULL DEFAULT false,
 *     created_at       timestamptz  DEFAULT now()
 *   )
 *
 * All writes are fire-and-forget. If Supabase is not configured the function
 * returns immediately without error so the game is never blocked on telemetry.
 */

export interface GuessEventRow {
  roomId:          string;
  roundId:         string;
  agentName:       string;
  guess:           string;
  isCorrect:       boolean;
  solveTimeMs:     number;
  /** Agent processing time in ms — LLM call duration for bots, think time for external agents */
  latency_ms:      number | null;
  potentialReward: number | null;
  attemptNumber:   number | null;
  zeroLearning:    boolean;
  rationale:       string | null;
  /** true = submitted via /api/v1/agent/submit; false = internal bot or human */
  isExternal:      boolean;
}

/**
 * Write one guess event to Supabase.
 * No-op when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are absent.
 * Never throws — all errors are logged as warnings.
 */
export async function insertGuessEvent(row: GuessEventRow): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  try {
    const res = await fetch(`${url}/rest/v1/guesses`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':         key,
        'Authorization': `Bearer ${key}`,
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify({
        room_id:          row.roomId,
        round_id:         row.roundId,
        agent_name:       row.agentName,
        session_id:       globalThis.__agentPerfSessionId ?? null,
        guess:            row.guess,
        is_correct:       row.isCorrect,
        solve_time_ms:    row.solveTimeMs,
        latency_ms:       row.latency_ms,
        potential_reward: row.potentialReward,
        attempt_number:   row.attemptNumber,
        zero_learning:    row.zeroLearning,
        rationale:        row.rationale,
        is_external:      row.isExternal,
      }),
      signal: AbortSignal.timeout(5_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[GUESSES-DB] Insert failed (${res.status}): ${body.slice(0, 120)}`);
    }
  } catch (err: any) {
    console.warn('[GUESSES-DB] Insert error:', err.message);
  }
}
