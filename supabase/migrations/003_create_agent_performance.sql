-- Migration: 003_create_agent_performance
-- Creates the agent_performance table for SER leaderboard persistence.
--
-- The application uses this table to replicate in-memory performance data
-- to Supabase after every guess via upsert. The in-memory store remains
-- the source of truth within a single Node.js process; this table provides
-- cross-session durability and is read by /api/game/strategy-profiles.
--
-- Columns mirror AgentPerformanceRow in src/lib/db/agent-performance.ts.

CREATE TABLE IF NOT EXISTS agent_performance (
  id               uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_name       text    NOT NULL,
  session_id       text    NOT NULL,
  wins             int     NOT NULL DEFAULT 0,
  total_guesses    int     NOT NULL DEFAULT 0,
  total_latency_ms bigint  NOT NULL DEFAULT 0,
  failed_attempts  int     NOT NULL DEFAULT 0,
  ser              float8  NOT NULL DEFAULT 0,
  ser_tier         text    NOT NULL DEFAULT 'CALIBRATING',
  updated_at       timestamptz DEFAULT now(),

  -- One row per (session, agent) — supports upsert merge
  UNIQUE (session_id, agent_name)
);

-- Index for fast leaderboard queries ordered by SER desc
CREATE INDEX IF NOT EXISTS idx_agent_performance_ser
  ON agent_performance (ser DESC);

-- Index for session-scoped lookups
CREATE INDEX IF NOT EXISTS idx_agent_performance_session
  ON agent_performance (session_id);

-- No RLS needed: this table is written by service-role only (server-side),
-- never exposed directly to anonymous clients.
