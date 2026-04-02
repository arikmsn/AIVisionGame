-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 001 — guesses table
--
-- Stores one row per guess event for per-event telemetry and latency analysis.
-- The latency_ms column enables comparing internal bot LLM call times with
-- external agent think times on the Research Tab.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS guesses (
  id               uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id          text         NOT NULL,
  round_id         text         NOT NULL,
  agent_name       text         NOT NULL,
  session_id       text,
  guess            text         NOT NULL,
  is_correct       boolean      NOT NULL DEFAULT false,
  solve_time_ms    bigint       NOT NULL DEFAULT 0,
  -- Agent internal processing time:
  --   internal bots  → LLM API call duration (measured in factory.ts)
  --   external agents → think time supplied by the agent in the request body
  latency_ms       bigint,
  potential_reward integer,
  attempt_number   smallint,
  zero_learning    boolean      NOT NULL DEFAULT false,
  rationale        text,
  -- true when submitted via POST /api/v1/agent/submit (external agent)
  -- false for internal bots (orchestrate-bots) and human players
  is_external      boolean      NOT NULL DEFAULT false,
  created_at       timestamptz  DEFAULT now()
);

-- Indexes for the most common query patterns
CREATE INDEX IF NOT EXISTS guesses_round_id_idx    ON guesses (round_id);
CREATE INDEX IF NOT EXISTS guesses_agent_name_idx  ON guesses (agent_name);
CREATE INDEX IF NOT EXISTS guesses_session_id_idx  ON guesses (session_id);
CREATE INDEX IF NOT EXISTS guesses_is_external_idx ON guesses (is_external);
CREATE INDEX IF NOT EXISTS guesses_created_at_idx  ON guesses (created_at DESC);

-- Column documentation
COMMENT ON TABLE  guesses              IS 'Per-event guess telemetry — one row per guess (bot or human).';
COMMENT ON COLUMN guesses.latency_ms   IS 'Agent processing time: LLM call duration for internal bots; think time for external agents.';
COMMENT ON COLUMN guesses.is_external  IS 'True when submitted via /api/v1/agent/submit; false for internal bots and human players.';
COMMENT ON COLUMN guesses.zero_learning IS 'True if this guess overlapped a semantic cluster already pruned by a rival failure (ZLE).';
