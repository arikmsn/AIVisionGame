/**
 * Agent Secrets — per-agent HMAC secret lookup with in-memory TTL cache.
 *
 * Schema (run supabase/migrations/002_create_agent_secrets.sql to provision):
 *
 *   agent_secrets (
 *     agent_id    text         PRIMARY KEY,
 *     secret      text         NOT NULL,       -- raw HMAC secret (service-role only)
 *     is_active   boolean      NOT NULL DEFAULT true,
 *     description text,
 *     created_at  timestamptz  DEFAULT now(),
 *     updated_at  timestamptz  DEFAULT now()
 *   )
 *
 * Fallback chain:
 *   1. In-memory cache (5-minute TTL)
 *   2. Supabase `agent_secrets` table (per-agent secret)
 *   3. `AGENT_WEBHOOK_SECRET` env var (global fallback — used when Supabase is
 *      not configured or the agent_id is not in the table)
 *
 * This design allows gradual migration: existing agents continue to work with
 * the global env-var secret while new agents get their own unique secrets.
 */

// ── In-memory TTL cache ───────────────────────────────────────────────────────
// Anchored to globalThis for Turbopack module-re-evaluation safety.

interface CacheEntry { secret: string; cachedAt: number }

declare global { var __agentSecretsCache: Map<string, CacheEntry> | undefined; }
if (!globalThis.__agentSecretsCache) globalThis.__agentSecretsCache = new Map();
const secretsCache: Map<string, CacheEntry> = globalThis.__agentSecretsCache;

const CACHE_TTL_MS = 5 * 60_000; // 5 minutes — rotate secrets without server restart

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resolve the HMAC secret for the given agentId.
 *
 * Resolution order:
 *   1. Cache hit within TTL
 *   2. Supabase `agent_secrets` table (if credentials are configured)
 *   3. `AGENT_WEBHOOK_SECRET` env var (global fallback)
 *
 * Returns null only when neither Supabase nor the env-var secret are available —
 * i.e. the server is not configured for external agents at all.
 */
export async function getAgentSecret(agentId: string): Promise<string | null> {
  // 1. Cache hit
  const cached = secretsCache.get(agentId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.secret;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // 2. No Supabase credentials — use global env-var secret
  if (!supabaseUrl || !serviceKey) {
    return process.env.AGENT_WEBHOOK_SECRET ?? null;
  }

  // 3. Fetch from Supabase
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/agent_secrets` +
      `?agent_id=eq.${encodeURIComponent(agentId)}` +
      `&is_active=eq.true` +
      `&select=secret` +
      `&limit=1`,
      {
        headers: {
          'apikey':        serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
        },
        signal: AbortSignal.timeout(3_000),
      },
    );

    if (!res.ok) {
      console.warn(`[AGENT-SECRETS] Supabase lookup HTTP ${res.status} for agent "${agentId}" — using fallback`);
      return process.env.AGENT_WEBHOOK_SECRET ?? null;
    }

    const rows: Array<{ secret: string }> = await res.json();

    if (!rows || rows.length === 0) {
      // Agent not in table → fall back to global secret (graceful for legacy agents)
      console.warn(`[AGENT-SECRETS] No entry for agent "${agentId}" — using global AGENT_WEBHOOK_SECRET fallback`);
      return process.env.AGENT_WEBHOOK_SECRET ?? null;
    }

    const { secret } = rows[0];

    // Cache the resolved secret
    secretsCache.set(agentId, { secret, cachedAt: Date.now() });
    console.log(`[AGENT-SECRETS] ✅ Resolved per-agent secret for "${agentId}" (cached for 5 min)`);
    return secret;
  } catch (err: any) {
    console.warn(`[AGENT-SECRETS] Lookup error for "${agentId}":`, err.message, '— using fallback');
    return process.env.AGENT_WEBHOOK_SECRET ?? null;
  }
}

/**
 * Force-evict a specific agent's cached secret.
 * Call when a secret has been rotated in Supabase.
 */
export function invalidateAgentSecret(agentId: string): void {
  secretsCache.delete(agentId);
}

/**
 * Wipe the entire secrets cache (called from reset-session).
 */
export function clearSecretsCache(): void {
  secretsCache.clear();
}
