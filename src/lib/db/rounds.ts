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
 * All writes are awaited at the call-site so the row is guaranteed written
 * before the Vercel function returns. Reads return null on any error.
 * The game is never blocked on Supabase availability — if unconfigured,
 * every call is a no-op and the local in-memory path remains sole truth.
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
  if (!url || !key) return null;
  return { url, key };
}

const ENDPOINT = (url: string) => `${url}/rest/v1/active_rounds`;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Upsert the current round state for `roomId`.
 *
 * IMPORTANT: the caller MUST await this — fire-and-forget upserts are
 * silently abandoned by Vercel before the fetch resolves.
 *
 * Returns true on success, false on any failure (including unconfigured).
 */
export async function upsertActiveRound(row: ActiveRoundRow): Promise<boolean> {
  const creds = supabaseCreds();
  if (!creds) {
    console.warn('[ROUNDS-DB] ⚠️  Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing) — skip upsert');
    return false;
  }

  console.log(`[ROUNDS-DB] 📤 Upserting active_rounds | room="${row.roomId}" phase="${row.phase}" round="${row.roundId}" rst=${row.roundStartTime}`);

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
        round_id:         row.roundId  || '',
        phase:            row.phase,
        image_url:        row.imageUrl,
        round_start_time: row.roundStartTime,
        updated_at:       new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(4_000),
    });

    if (res.ok) {
      console.log(`[ROUNDS-DB] ✅ Upsert OK (HTTP ${res.status}) | room="${row.roomId}" phase="${row.phase}"`);
      return true;
    }

    const body = await res.text().catch(() => '');
    console.warn(`[ROUNDS-DB] ❌ Upsert failed (HTTP ${res.status}) | room="${row.roomId}" | body: ${body.slice(0, 200)}`);
    return false;
  } catch (err: any) {
    console.warn(`[ROUNDS-DB] ❌ Upsert error | room="${row.roomId}" | ${err.message}`);
    return false;
  }
}

/**
 * Fetch the persisted round row for `roomId`.
 * Returns null when Supabase is unconfigured, the table is empty, or any
 * error occurs. Never throws.
 */
export async function fetchActiveRound(roomId: string): Promise<ActiveRoundRow | null> {
  const creds = supabaseCreds();
  if (!creds) {
    console.warn('[ROUNDS-DB] ⚠️  Supabase not configured — cross-instance fallback unavailable');
    return null;
  }

  console.log(`[ROUNDS-DB] 🔍 Fetching active_rounds | room="${roomId}"`);

  try {
    const res = await fetch(
      `${ENDPOINT(creds.url)}?room_id=eq.${encodeURIComponent(roomId)}&select=*&limit=1`,
      {
        headers: {
          'apikey':         creds.key,
          'Authorization': `Bearer ${creds.key}`,
        },
        signal: AbortSignal.timeout(4_000),
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[ROUNDS-DB] ❌ Fetch failed (HTTP ${res.status}) | room="${roomId}" | body: ${body.slice(0, 200)}`);
      return null;
    }

    const rows: Array<{
      room_id: string; round_id: string; phase: string;
      image_url: string | null; round_start_time: number | null;
    }> = await res.json();

    if (!rows || rows.length === 0) {
      console.log(`[ROUNDS-DB] ℹ️  No row found | room="${roomId}" — table empty or room never started`);
      return null;
    }

    const r = rows[0];
    console.log(`[ROUNDS-DB] ✅ Fetched | room="${roomId}" phase="${r.phase}" round="${r.round_id}" rst=${r.round_start_time}`);

    return {
      roomId:         r.room_id,
      roundId:        r.round_id,
      phase:          r.phase,
      imageUrl:       r.image_url,
      roundStartTime: r.round_start_time,
    };
  } catch (err: any) {
    console.warn(`[ROUNDS-DB] ❌ Fetch error | room="${roomId}" | ${err.message}`);
    return null;
  }
}
