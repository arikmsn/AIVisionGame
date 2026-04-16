/**
 * Forecast Arena — Supabase REST helpers (server-side only)
 *
 * Same pattern as tournament-persistence.ts: raw fetch against the
 * Supabase REST API using SUPABASE_SERVICE_ROLE_KEY. No supabase-js.
 */

const EXPECTED_PROJECT = 'aciqrjgcnrxhmywlkkqb';
const TIMEOUT = 12_000;

export function supabaseCreds(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!url.includes(EXPECTED_PROJECT)) {
    console.error(`[FA/DB] FATAL: SUPABASE_URL does not contain ${EXPECTED_PROJECT}`);
    return null;
  }
  return { url, key };
}

function endpoint(url: string, table: string) {
  return `${url}/rest/v1/${table}`;
}

function headers(key: string, extra?: Record<string, string>) {
  return {
    'Content-Type':  'application/json',
    apikey:          key,
    Authorization:   `Bearer ${key}`,
    Accept:          'application/json',
    ...extra,
  };
}

export async function faInsert(
  table: string,
  rows: Record<string, unknown>[],
  opts?: { returning?: boolean },
): Promise<Record<string, unknown>[] | boolean> {
  const creds = supabaseCreds();
  if (!creds || rows.length === 0) return false;
  try {
    const prefer = opts?.returning ? 'return=representation' : 'return=minimal';
    const res = await fetch(endpoint(creds.url, table), {
      method:  'POST',
      headers: { ...headers(creds.key), Prefer: prefer },
      body:    JSON.stringify(rows),
      signal:  AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[FA/DB] ${table} insert failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
      return false;
    }
    if (opts?.returning) return res.json();
    return true;
  } catch (err: any) {
    console.error(`[FA/DB] ${table} insert error: ${err?.message ?? err}`);
    return false;
  }
}

export async function faUpsert(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<boolean> {
  const creds = supabaseCreds();
  if (!creds || rows.length === 0) return false;
  try {
    const res = await fetch(`${endpoint(creds.url, table)}?on_conflict=${onConflict}`, {
      method:  'POST',
      headers: { ...headers(creds.key), Prefer: 'return=minimal,resolution=merge-duplicates' },
      body:    JSON.stringify(rows),
      signal:  AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[FA/DB] ${table} upsert failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error(`[FA/DB] ${table} upsert error: ${err?.message ?? err}`);
    return false;
  }
}

export async function faPatch(
  table: string,
  filter: Record<string, string>,
  data: Record<string, unknown>,
): Promise<boolean> {
  const creds = supabaseCreds();
  if (!creds) return false;
  try {
    const qs = Object.entries(filter)
      .map(([k, v]) => `${encodeURIComponent(k)}=eq.${encodeURIComponent(v)}`)
      .join('&');
    const res = await fetch(`${endpoint(creds.url, table)}?${qs}`, {
      method:  'PATCH',
      headers: { ...headers(creds.key), Prefer: 'return=minimal' },
      body:    JSON.stringify(data),
      signal:  AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[FA/DB] ${table} patch failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error(`[FA/DB] ${table} patch error: ${err?.message ?? err}`);
    return false;
  }
}

export async function faSelect<T>(
  table: string,
  query: string = '',
): Promise<T[]> {
  const creds = supabaseCreds();
  if (!creds) return [];
  try {
    const sep = query ? '?' : '';
    const res = await fetch(`${endpoint(creds.url, table)}${sep}${query}`, {
      headers: headers(creds.key),
      signal:  AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[FA/DB] ${table} select failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
      return [];
    }
    return res.json();
  } catch (err: any) {
    console.error(`[FA/DB] ${table} select error: ${err?.message ?? err}`);
    return [];
  }
}

/** Convenience: server-component data fetch (same as sfetch in public-benchmark) */
export function sfetch(path: string) {
  const creds = supabaseCreds();
  if (!creds) throw new Error('[FA/DB] Supabase env vars not set');
  return fetch(`${creds.url}/rest/v1/${path}`, {
    headers: { apikey: creds.key, Authorization: `Bearer ${creds.key}`, Accept: 'application/json' },
    cache:   'no-store',
    signal:  AbortSignal.timeout(TIMEOUT),
  }).then(r => r.json());
}
