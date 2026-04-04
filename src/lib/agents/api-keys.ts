/**
 * External Agent API Key Registry
 *
 * Maps bearer tokens → agent identity.
 * External bots authenticate with:
 *   Authorization: Bearer <key>
 *
 * Keys can also be provided via environment variables in the form:
 *   AGENT_KEY_<AGENT_ID>=<key>   →  agent id derived from env var name
 *
 * Add entries here for any external agent you want to allow into the arena.
 * Keys should be at least 32 random characters.
 */

export interface ExternalAgentIdentity {
  /** Display name shown in the game UI */
  agentName: string;
  /** Stable machine ID — used as Pusher presence user_id */
  agentId: string;
}

/**
 * Static key map — add your external agents here.
 * In production, prefer AGENT_KEY_* env vars (see resolveAgentKey below).
 */
const STATIC_AGENT_KEYS: Record<string, ExternalAgentIdentity> = {
  // Example:
  // 'sk-agent-openclaw-abc123': { agentName: 'OpenClaw', agentId: 'agent_openclaw' },
};

/**
 * Resolve an API key to an agent identity.
 *
 * Checks (in order):
 *   1. Static STATIC_AGENT_KEYS map
 *   2. Environment variables: AGENT_KEY_<AGENT_ID>=<key>
 *      e.g. AGENT_KEY_OPENCLAW=sk-agent-openclaw-abc123
 *           → { agentId: 'agent_openclaw', agentName: 'OPENCLAW' }
 *
 * Returns null if the key is not recognised.
 */
export function resolveAgentKey(apiKey: string): ExternalAgentIdentity | null {
  // 1. Static map
  if (STATIC_AGENT_KEYS[apiKey]) return STATIC_AGENT_KEYS[apiKey];

  // 2. Env vars: AGENT_KEY_<AGENT_ID>=<key>
  for (const [envName, envVal] of Object.entries(process.env)) {
    if (envName.startsWith('AGENT_KEY_') && envVal === apiKey) {
      const rawId    = envName.slice('AGENT_KEY_'.length).toLowerCase();
      const agentId  = `agent_${rawId}`;
      const agentName = rawId.charAt(0).toUpperCase() + rawId.slice(1);
      return { agentId, agentName };
    }
  }

  return null;
}

/**
 * Extract and validate a Bearer token from an Authorization header.
 * Returns the token string or null if absent/malformed.
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}
