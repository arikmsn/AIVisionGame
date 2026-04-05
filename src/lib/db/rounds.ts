/**
 * Active Rounds — cross-instance round state persistence.
 *
 * Schema (run supabase/migrations/004_create_active_rounds.sql to provision):
 *
 *   active_rounds (
 *     room_id          text         PRIMARY KEY,
 *     round_id         text         NOT NULL,
 *     phase            text         NOT NULL DEFAULT 'idle',
 *     image_url        text,
 *     round_start_time bigint,
 *     updated_at       timestamptz  DEFAULT now()
 *   )
 *
 * Purpose:
 *   Vercel serverless functions run in isolated processes. A cold instance
 *   handling GET /api/game/sync will have an empty in-memory gameStore even
 *   when another warm instance is mid-round. This module bridges that gap:
 *   start-round upserts the round row; sync falls back to it when local
 *   state is idle.
 *
 * All writes are fire-and-forget. Reads return null on any error. The game
 * is never blocked on Supabase availability — if unconfigured, every call
 * is a no-op and the local in-memory path remains the sole source of truth.
 */

export interface ActiveRoundRow {
  roomId:         string;
  roundId:        string;
  phase:          string;
  imageUrl:       string | null;
  roundStartTime: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function supabaseCreds(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

const ENDPOINT = (url: string) => `${url}/rest/v1/active_rounds`;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Upsert the current round state for `roomId`.
 * No-op when Supabase is not configured. Never throws.
 */
export async function upsertActiveRound(row: ActiveRoundRow): Promise<void> {
  const creds = supabaseCreds();
  if (!creds) return;

  try {
    const res = await fetch(ENDPOINT(creds.url), {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':         creds.key,
        'Authorization': `Bearer ${creds.key}`,
        'Prefer':        'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        room_id:          row.roomId,
        round_id:         row.roundId,
        phase:            row.phase,
        image_url:        row.imageUrl,
        round_start_time: row.roundStartTime,
        updated_at:       new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(3_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[ROUNDS-DB] Upsert failed (${res.status}): ${body.slice(0, 120)}`);
    }
  } catch (err: any) {
    console.warn('[ROUNDS-DB] Upsert error:', err.message);
  }
}

/**
 * Fetch the persisted round row for `roomId`.
 * Returns null when Supabase is unconfigured, the table is empty, or any
 * error occurs. Never throws.
 */
export async function fetchActiveRound(roomId: string): Promise<ActiveRoundRow | null> {
  const creds = supabaseCreds();
  if (!creds) return null;

  try {
    const res = await fetch(
      `${ENDPOINT(creds.url)}?room_id=eq.${encodeURIComponent(roomId)}&select=*&limit=1`,
      {
        headers: {
          'apikey':         creds.key,
          'Authorization': `Bearer ${creds.key}`,
        },
        signal: AbortSignal.timeout(3_000),
      },
    );

    if (!res.ok) return null;

    const rows: Array<{
      room_id: string; round_id: string; phase: string;
      image_url: string | null; round_start_time: number | null;
    }> = await res.json();

    if (!rows || rows.length === 0) return null;
    const r = rows[0];

    return {
      roomId:         r.room_id,
      roundId:        r.round_id,
      phase:          r.phase,
      imageUrl:       r.image_url,
      roundStartTime: r.round_start_time,
    };
  } catch (err: any) {
    console.warn('[ROUNDS-DB] Fetch error:', err.message);
    return null;
  }
}
