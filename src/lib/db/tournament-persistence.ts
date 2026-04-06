/**
 * Tournament Persistence — Phase 2
 *
 * DB operations for tournament lifecycle using the Supabase REST API.
 * Same target project as arena-results.ts (aciqrjgcnrxhmywlkkqb).
 *
 * Responsibilities:
 *   • createTournament   — INSERT arena_tournaments, build stable player_id map
 *   • loadTournamentState — SELECT config_snapshot from arena_tournaments
 *   • saveTournamentState — PATCH config_snapshot after each round
 *   • persistStandingsSnapshot — INSERT arena_tournament_standings
 *   • finalizeTournament — PATCH status='completed'
 *
 * context_sent_json is stored in arena_round_timeline (event_type='context_snapshot')
 * because the arena_round_players table may not yet have the column (migration 007 is
 * separate and requires direct DB access to aciqrjgcnrxhmywlkkqb).
 */

import type { AgentConfig }      from '@/lib/agents/dispatcher';
import type { TournamentState }  from '@/lib/arena/standings';
import { initTournamentState }   from '@/lib/arena/standings';

// ── Internal REST helpers (same pattern as arena-results.ts) ──────────────────

function supabaseCreds(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

const ENDPOINT = (url: string, table: string) => `${url}/rest/v1/${table}`;
const TIMEOUT  = 10_000;

async function insertRows(table: string, rows: Record<string, unknown>[]): Promise<boolean> {
  const creds = supabaseCreds();
  if (!creds || rows.length === 0) return false;
  try {
    const res = await fetch(ENDPOINT(creds.url, table), {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        creds.key,
        'Authorization': `Bearer ${creds.key}`,
        'Prefer':        'return=minimal',
      },
      body:   JSON.stringify(rows),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[TOURNAMENT/DB] ${table} insert failed: HTTP ${res.status} — ${text.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error(`[TOURNAMENT/DB] ${table} insert error: ${err?.message ?? err}`);
    return false;
  }
}

async function patchRows(
  table:  string,
  filter: Record<string, string>,
  data:   Record<string, unknown>,
): Promise<boolean> {
  const creds = supabaseCreds();
  if (!creds) return false;
  try {
    // Build query string: key=eq.value for each filter entry
    const qs = Object.entries(filter)
      .map(([k, v]) => `${encodeURIComponent(k)}=eq.${encodeURIComponent(v)}`)
      .join('&');
    const res = await fetch(`${ENDPOINT(creds.url, table)}?${qs}`, {
      method:  'PATCH',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        creds.key,
        'Authorization': `Bearer ${creds.key}`,
        'Prefer':        'return=minimal',
      },
      body:   JSON.stringify(data),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[TOURNAMENT/DB] ${table} patch failed: HTTP ${res.status} — ${text.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error(`[TOURNAMENT/DB] ${table} patch error: ${err?.message ?? err}`);
    return false;
  }
}

async function selectRows<T>(
  table:  string,
  filter: Record<string, string>,
  select = '*',
): Promise<T[] | null> {
  const creds = supabaseCreds();
  if (!creds) return null;
  try {
    const qs = Object.entries(filter)
      .map(([k, v]) => `${encodeURIComponent(k)}=eq.${encodeURIComponent(v)}`)
      .join('&');
    const res = await fetch(`${ENDPOINT(creds.url, table)}?${qs}&select=${select}`, {
      method:  'GET',
      headers: {
        'apikey':        creds.key,
        'Authorization': `Bearer ${creds.key}`,
        'Accept':        'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[TOURNAMENT/DB] ${table} select failed: HTTP ${res.status} — ${text.slice(0, 200)}`);
      return null;
    }
    return res.json();
  } catch (err: any) {
    console.error(`[TOURNAMENT/DB] ${table} select error: ${err?.message ?? err}`);
    return null;
  }
}

// ── State serialisation ────────────────────────────────────────────────────────

/** Serialise TournamentState to a plain object safe for jsonb storage */
function serialiseState(state: TournamentState): Record<string, unknown> {
  return {
    roundsCompleted:   state.roundsCompleted,
    totalRounds:       state.totalRounds,
    usedIdiomIds:      state.usedIdiomIds,
    playerIdMap:       state.playerIdMap,
    modelIdFromPlayer: state.modelIdFromPlayer,
    stats:             state.stats,
  };
}

/** Rehydrate a TournamentState from a stored config_snapshot */
function deserialiseState(
  tournamentId: string,
  snapshot:     Record<string, unknown>,
): TournamentState {
  return {
    tournamentId,
    roundsCompleted:   (snapshot.roundsCompleted  as number)              ?? 0,
    totalRounds:       (snapshot.totalRounds       as number)              ?? 20,
    usedIdiomIds:      (snapshot.usedIdiomIds      as number[])            ?? [],
    playerIdMap:       (snapshot.playerIdMap       as Record<string, string>) ?? {},
    modelIdFromPlayer: (snapshot.modelIdFromPlayer as Record<string, string>) ?? {},
    stats:             (snapshot.stats             as TournamentState['stats']) ?? {},
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface CreateTournamentResult {
  tournamentId: string;
  state:        TournamentState;
}

/**
 * Create a new tournament row and return the initialised state (player_id mapping).
 *
 * @param agents       Model roster
 * @param totalRounds  How many rounds in this tournament
 * @param runId        Optional run batch identifier (groups tournaments together)
 * @param budgetCapUsd Per-tournament spend cap in USD (default $5)
 */
export async function createTournament(
  agents:       AgentConfig[],
  totalRounds:  number,
  runId?:       string,
  budgetCapUsd = 5.00,
): Promise<CreateTournamentResult | null> {
  const creds = supabaseCreds();
  if (!creds) {
    console.warn('[TOURNAMENT/DB] Supabase not configured — tournament will not be persisted');
    // Still return a valid state so the tournament can run locally
    const tournamentId = crypto.randomUUID();
    const state = initTournamentState(tournamentId, agents, totalRounds);
    return { tournamentId, state };
  }

  const tournamentId = crypto.randomUUID();
  const state        = initTournamentState(tournamentId, agents, totalRounds);

  const ok = await insertRows('arena_tournaments', [{
    id:                   tournamentId,
    status:               'running',
    total_rounds:         totalRounds,
    config_snapshot:      serialiseState(state),
    // Phase 3 columns (migration 008)
    ...(runId ? { run_id: runId } : {}),
    budget_cap_usd:       budgetCapUsd,
    accumulated_cost_usd: 0,
  }]);

  if (!ok) {
    console.error('[TOURNAMENT/DB] Failed to insert tournament row');
    return null;
  }

  console.log(
    `[TOURNAMENT/DB] Created tournament ${tournamentId} | ` +
    `${agents.length} players | ${totalRounds} rounds`,
  );
  return { tournamentId, state };
}

/**
 * Load a tournament's current state from the DB.
 */
export async function loadTournamentState(tournamentId: string): Promise<TournamentState | null> {
  const rows = await selectRows<{ config_snapshot: Record<string, unknown>; total_rounds: number }>(
    'arena_tournaments',
    { id: tournamentId },
    'config_snapshot,total_rounds',
  );

  if (!rows || rows.length === 0) {
    console.error(`[TOURNAMENT/DB] Tournament ${tournamentId} not found`);
    return null;
  }

  const row      = rows[0];
  const snapshot = typeof row.config_snapshot === 'string'
    ? JSON.parse(row.config_snapshot)
    : (row.config_snapshot ?? {});

  return deserialiseState(tournamentId, snapshot);
}

/**
 * Persist the updated tournament state after each round.
 */
export async function saveTournamentState(state: TournamentState): Promise<boolean> {
  const ok = await patchRows(
    'arena_tournaments',
    { id: state.tournamentId },
    { config_snapshot: serialiseState(state) },
  );
  if (ok) {
    console.log(`[TOURNAMENT/DB] State saved: tournament ${state.tournamentId} | round ${state.roundsCompleted}/${state.totalRounds}`);
  }
  return ok;
}

/**
 * Snapshot per-model standings after a round for historical leaderboard queries.
 */
export async function persistStandingsSnapshot(
  state:       TournamentState,
  roundNumber: number,
): Promise<boolean> {
  const sorted = Object.values(state.stats).sort((a, b) => b.totalScore - a.totalScore);

  const rows = sorted.map((s, idx) => {
    const accuracy = s.roundsPlayed > 0 ? s.roundsCorrect / s.roundsPlayed : 0;
    return {
      tournament_id:   state.tournamentId,
      round_number:    roundNumber,
      model_id:        s.modelId,
      score:           s.totalScore,
      rank:            idx + 1,
      rounds_won:      s.roundsWon,
      accuracy_so_far: Math.round(accuracy * 100) / 100,
      trend:           computeTrend(s.recentScores),
    };
  });

  return insertRows('arena_tournament_standings', rows);
}

function computeTrend(recentScores: number[]): string {
  if (recentScores.length < 3) return 'stable';
  const half  = Math.floor(recentScores.length / 2);
  const early = recentScores.slice(0, half).reduce((a, b) => a + b, 0) / half;
  const late  = recentScores.slice(-half).reduce((a, b) => a + b, 0) / half;
  if      (late > early * 1.15) return 'improving';
  else if (late < early * 0.85) return 'declining';
  return 'stable';
}

/**
 * Mark a tournament as completed.
 */
export async function finalizeTournament(tournamentId: string): Promise<boolean> {
  return patchRows('arena_tournaments', { id: tournamentId }, {
    status:   'completed',
    ended_at: new Date().toISOString(),
  });
}

// ── Phase 3: Cost monitoring ───────────────────────────────────────────────────

/**
 * Add the round's total cost to the tournament's accumulated_cost_usd.
 * Returns the new accumulated total, or null on failure.
 */
export async function updateTournamentCost(
  tournamentId: string,
  additionalUsd: number,
): Promise<number | null> {
  const creds = supabaseCreds();
  if (!creds || additionalUsd <= 0) return null;

  try {
    // Use Supabase RPC-style arithmetic via PostgREST PATCH with header
    const qs = `id=eq.${encodeURIComponent(tournamentId)}`;
    const res = await fetch(`${ENDPOINT(creds.url, 'arena_tournaments')}?${qs}`, {
      method: 'PATCH',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        creds.key,
        'Authorization': `Bearer ${creds.key}`,
        'Prefer':        'return=representation',
      },
      body:   JSON.stringify({ accumulated_cost_usd: `accumulated_cost_usd + ${additionalUsd}` }),
      signal: AbortSignal.timeout(TIMEOUT),
    });

    // If the arithmetic string trick doesn't work, fall back to read-then-write
    if (!res.ok) {
      const rows = await selectRows<{ accumulated_cost_usd: number }>(
        'arena_tournaments', { id: tournamentId }, 'accumulated_cost_usd',
      );
      if (!rows || rows.length === 0) return null;
      const current = rows[0].accumulated_cost_usd ?? 0;
      const newTotal = current + additionalUsd;
      await patchRows('arena_tournaments', { id: tournamentId }, { accumulated_cost_usd: newTotal });
      console.log(`[TOURNAMENT/DB] Cost updated: tournament ${tournamentId} +$${additionalUsd.toFixed(4)} = $${newTotal.toFixed(4)}`);
      return newTotal;
    }

    const updated = await res.json() as Array<{ accumulated_cost_usd: number }>;
    const newTotal = updated[0]?.accumulated_cost_usd ?? additionalUsd;
    console.log(`[TOURNAMENT/DB] Cost updated: tournament ${tournamentId} +$${additionalUsd.toFixed(4)} = $${newTotal.toFixed(4)}`);
    return newTotal;
  } catch (err: any) {
    console.error(`[TOURNAMENT/DB] updateTournamentCost error: ${err?.message ?? err}`);
    return null;
  }
}

/**
 * Check whether a tournament is still within its budget cap.
 * Returns true if OK to continue, false if cap is reached.
 */
export async function checkTournamentBudget(tournamentId: string): Promise<boolean> {
  const rows = await selectRows<{ accumulated_cost_usd: number; budget_cap_usd: number }>(
    'arena_tournaments',
    { id: tournamentId },
    'accumulated_cost_usd,budget_cap_usd',
  );
  if (!rows || rows.length === 0) return false; // unknown tournament — fail safe
  const { accumulated_cost_usd, budget_cap_usd } = rows[0];
  const ok = accumulated_cost_usd < budget_cap_usd;
  if (!ok) {
    console.warn(
      `[TOURNAMENT/DB] Budget cap reached for ${tournamentId}: ` +
      `$${accumulated_cost_usd.toFixed(4)} >= $${budget_cap_usd.toFixed(2)} cap`,
    );
  }
  return ok;
}

/**
 * Check whether the overall run is still within the $100 hard cap.
 * Returns true if OK, false if the run total has hit/exceeded $100.
 */
export async function checkRunBudget(runId: string, capUsd = 100): Promise<boolean> {
  const creds = supabaseCreds();
  if (!creds) return true; // no DB — allow (local dev)
  try {
    const qs = `run_id=eq.${encodeURIComponent(runId)}&select=run_total_cost_usd`;
    const res = await fetch(`${ENDPOINT(creds.url, 'v_run_cost_summary')}?${qs}`, {
      headers: {
        'apikey':        creds.key,
        'Authorization': `Bearer ${creds.key}`,
        'Accept':        'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) return true; // view not ready — allow
    const rows = await res.json() as Array<{ run_total_cost_usd: number }>;
    const total = rows[0]?.run_total_cost_usd ?? 0;
    const ok    = total < capUsd;
    if (!ok) {
      console.warn(`[TOURNAMENT/DB] Run budget cap reached: run ${runId} total $${total.toFixed(4)} >= $${capUsd} cap`);
    }
    return ok;
  } catch {
    return true; // fail open — budget view failure shouldn't halt tournaments
  }
}

/**
 * Log individual API call costs to arena_cost_log (migration 008 table).
 */
export async function persistCostLog(entries: Array<{
  roundId:      string;
  modelId:      string;
  attemptNum:   number;
  inputTokens:  number;
  outputTokens: number;
  costUsd:      number;
}>): Promise<void> {
  if (entries.length === 0) return;
  const rows = entries.map(e => ({
    round_id:      e.roundId,
    model_id:      e.modelId,
    attempt_num:   e.attemptNum,
    input_tokens:  e.inputTokens,
    output_tokens: e.outputTokens,
    cost_usd:      e.costUsd,
  }));
  await insertRows('arena_cost_log', rows);
}

/**
 * Store per-model context_sent_json as a timeline event (event_type='context_snapshot').
 *
 * Uses the existing arena_round_timeline table (jsonb event_data) so no schema
 * migration is needed. The verification query for round 10 reads from this table.
 */
export async function persistContextSnapshots(
  roundId: string,
  snapshots: Array<{ modelId: string; playerId: string; contextJson: string }>,
): Promise<boolean> {
  if (snapshots.length === 0) return true;

  const rows = snapshots.map(s => ({
    round_id:        roundId,
    event_type:      'context_snapshot',
    event_data:      JSON.parse(s.contextJson) as Record<string, unknown>,
    t_ms_from_start: 0,
  }));

  return insertRows('arena_round_timeline', rows);
}
