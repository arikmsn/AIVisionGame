/**
 * Arena Results — Database persistence for arena rounds.
 *
 * Writes round results to Supabase tables created by migration 006:
 *   arena_rounds, arena_round_players, arena_guesses, arena_round_timeline
 *
 * All writes use the Supabase REST API with service_role key (same pattern
 * as benchmark-results.ts). Timeout is 5s per write — generous enough for
 * the ~3 table inserts per round.
 *
 * Silently no-ops when Supabase is not configured.
 */

import type { RoundResult, GuessRecord } from '@/lib/arena/round-orchestrator';

// ── Internal helpers ──────────────────────────────────────────────────────────

function supabaseCreds(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

const ENDPOINT = (url: string, table: string) => `${url}/rest/v1/${table}`;
const TIMEOUT  = 5_000;

async function insertRows(table: string, rows: Record<string, unknown>[]): Promise<boolean> {
  const creds = supabaseCreds();
  if (!creds || rows.length === 0) return false;

  try {
    const res = await fetch(ENDPOINT(creds.url, table), {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':         creds.key,
        'Authorization': `Bearer ${creds.key}`,
        'Prefer':        'return=minimal',
      },
      body:   JSON.stringify(rows),
      signal: AbortSignal.timeout(TIMEOUT),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[ARENA/DB] ${table} insert failed: HTTP ${res.status} — ${text.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error(`[ARENA/DB] ${table} insert error: ${err?.message ?? err}`);
    return false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Persist a completed arena round to Supabase.
 *
 * Writes to 3 tables:
 *   1. arena_rounds       — the round record
 *   2. arena_round_players — per-model summary
 *   3. arena_guesses       — individual guess records
 *   4. arena_round_timeline — timeline events for replay
 *
 * Returns true if all writes succeed.
 */
export async function persistArenaRound(result: RoundResult): Promise<boolean> {
  const creds = supabaseCreds();
  if (!creds) {
    console.log('[ARENA/DB] Supabase not configured — skipping persistence');
    return false;
  }

  console.log(`[ARENA/DB] Persisting round ${result.roundId} to Supabase...`);

  // 1. Insert round record
  const roundOk = await insertRows('arena_rounds', [{
    id:           result.roundId,
    idiom_phrase: result.idiomPhrase,
    image_url:    result.imageUrl,
    t_start:      result.tStartIso,
    t_end:        result.tEndIso,
    ground_truth: result.idiomPhrase,
    status:       'completed',
  }]);

  if (!roundOk) {
    console.error('[ARENA/DB] Failed to insert round record — aborting');
    return false;
  }

  // 2. Insert round_players
  const playerRows = result.models.map(m => ({
    round_id:            result.roundId,
    model_id:            m.modelId,
    attempts_used:       m.attemptsUsed,
    final_score:         m.finalScore,
    reasoning_text:      m.reasoning.slice(0, 2000),
    baseline_latency_ms: m.warmupLatencyMs,
    warmup_ok:           m.warmupOk,
  }));
  await insertRows('arena_round_players', playerRows);

  // 3. Insert individual guesses
  const guessRows: Record<string, unknown>[] = [];
  for (const model of result.models) {
    for (const g of model.guesses) {
      if (g.isKeyMissing && g.attempt === 0) continue; // skip key_missing placeholders
      guessRows.push({
        round_id:                    result.roundId,
        model_id:                    g.modelId,
        attempt_num:                 g.attempt,
        guess_text:                  g.guessText ?? '',
        action:                      g.action,
        confidence:                  g.confidence,
        reasoning:                   g.reasoning.slice(0, 2000),
        t_ms_from_start:             g.tMsFromStart,
        is_correct:                  g.isCorrect,
        points_awarded:              g.pointsAwarded,
        visible_prior_guesses_count: g.priorGuessesVisible,
        wave:                        g.wave,
      });
    }
  }
  if (guessRows.length > 0) {
    await insertRows('arena_guesses', guessRows);
  }

  // 4. Insert timeline events
  const timelineRows: Record<string, unknown>[] = [];

  // Image drop event
  timelineRows.push({
    round_id:        result.roundId,
    event_type:      'image_drop',
    event_data:      JSON.stringify({ image_url: result.imageUrl, idiom: result.idiomPhrase }),
    t_ms_from_start: 0,
  });

  // Guess events
  for (const g of result.publicGuesses) {
    timelineRows.push({
      round_id:        result.roundId,
      event_type:      'guess',
      event_data:      JSON.stringify({ model: g.model, guess: g.guess, attempt: g.attempt }),
      t_ms_from_start: g.t_ms,
    });
  }

  // Round end event
  timelineRows.push({
    round_id:        result.roundId,
    event_type:      'round_end',
    event_data:      JSON.stringify({
      winner:        result.winner,
      total_guesses: result.publicGuesses.length,
      duration_ms:   result.durationMs,
    }),
    t_ms_from_start: result.durationMs,
  });

  await insertRows('arena_round_timeline', timelineRows);

  console.log(`[ARENA/DB] Round ${result.roundId} persisted: ${playerRows.length} players, ${guessRows.length} guesses, ${timelineRows.length} timeline events`);
  return true;
}
