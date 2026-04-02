-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 002 — agent_secrets table
--
-- Stores per-agent HMAC-SHA256 secrets for external arena agent authentication.
-- Replaces the single AGENT_WEBHOOK_SECRET env var with per-agent secrets so
-- each external agent has an independent, revocable credential.
--
-- Access policy: service_role only (never exposed to anon/authenticated clients).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_secrets (
  agent_id    text         PRIMARY KEY,
  secret      text         NOT NULL,
  is_active   boolean      NOT NULL DEFAULT true,
  description text,
  created_at  timestamptz  DEFAULT now(),
  updated_at  timestamptz  DEFAULT now()
);

-- Row Level Security — only the Supabase service role can read/write secrets.
-- The Next.js server uses the service role key for all secret lookups.
ALTER TABLE agent_secrets ENABLE ROW LEVEL SECURITY;

-- Deny all access to anon and authenticated roles
CREATE POLICY "deny_public_access"
  ON agent_secrets
  FOR ALL
  TO anon, authenticated
  USING (false);

-- Full access for service_role (used by the Next.js API server)
CREATE POLICY "service_role_full_access"
  ON agent_secrets
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_secrets_updated_at
  BEFORE UPDATE ON agent_secrets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Column documentation
COMMENT ON TABLE  agent_secrets            IS 'Per-agent HMAC-SHA256 secrets for external arena agent auth. Service-role access only.';
COMMENT ON COLUMN agent_secrets.agent_id   IS 'Stable agent identifier — matches X-Agent-ID header in external requests.';
COMMENT ON COLUMN agent_secrets.secret     IS 'Raw HMAC secret. Transmitted only over TLS. Never exposed to clients.';
COMMENT ON COLUMN agent_secrets.is_active  IS 'Set to false to revoke an agent without deleting its historical guess data.';

-- ── Seed example (remove before production) ──────────────────────────────────
-- INSERT INTO agent_secrets (agent_id, secret, description) VALUES
--   ('my-python-bot',    gen_random_uuid()::text, 'Example Python agent'),
--   ('research-agent-1', gen_random_uuid()::text, 'Research team agent');
