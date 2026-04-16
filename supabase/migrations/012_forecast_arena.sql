-- ============================================================================
-- Migration 012: Forecast Arena
-- Full schema for the prediction-market forecasting arena.
-- All tables prefixed with fa_ to avoid collision with the existing arena.
-- ============================================================================

-- ── fa_markets ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fa_markets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id      text NOT NULL,
  source           text NOT NULL DEFAULT 'polymarket',
  title            text NOT NULL,
  category         text,
  description      text,
  close_time       timestamptz,
  resolution_criteria text,
  status           text NOT NULL DEFAULT 'active',
  current_yes_price numeric(6,4),
  volume_usd       numeric(14,2),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  resolution_outcome boolean,
  metadata_json    jsonb,
  UNIQUE (source, external_id)
);

-- ── fa_market_snapshots ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fa_market_snapshots (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id        uuid NOT NULL REFERENCES fa_markets(id) ON DELETE CASCADE,
  timestamp        timestamptz NOT NULL DEFAULT now(),
  yes_price        numeric(6,4),
  no_price         numeric(6,4),
  volume_usd       numeric(14,2),
  num_traders      integer,
  open_interest    numeric(14,2),
  source_data_json jsonb
);

CREATE INDEX IF NOT EXISTS idx_fa_market_snapshots_market_ts
  ON fa_market_snapshots(market_id, timestamp DESC);

-- ── fa_seasons ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fa_seasons (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  status      text NOT NULL DEFAULT 'active',
  starts_at   timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz,
  config_json jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── fa_agents ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fa_agents (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 text NOT NULL UNIQUE,
  display_name         text NOT NULL,
  model_id             text NOT NULL,
  provider             text NOT NULL,
  prompt_version       text NOT NULL DEFAULT 'v1',
  strategy_profile_json jsonb,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- ── fa_rounds ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fa_rounds (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id               uuid REFERENCES fa_seasons(id),
  market_id               uuid NOT NULL REFERENCES fa_markets(id),
  round_number            integer NOT NULL DEFAULT 1,
  status                  text NOT NULL DEFAULT 'open',
  opened_at               timestamptz NOT NULL DEFAULT now(),
  closes_at               timestamptz,
  resolved_at             timestamptz,
  market_yes_price_at_open numeric(6,4),
  context_json            jsonb,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fa_rounds_market ON fa_rounds(market_id);
CREATE INDEX IF NOT EXISTS idx_fa_rounds_status ON fa_rounds(status);

-- ── fa_submissions ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fa_submissions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id         uuid NOT NULL REFERENCES fa_rounds(id) ON DELETE CASCADE,
  agent_id         uuid NOT NULL REFERENCES fa_agents(id),
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  probability_yes  numeric(6,4) NOT NULL,
  confidence       numeric(4,3),
  action           text,
  rationale_short  text,
  rationale_full   text,
  raw_context_json jsonb,
  raw_output_json  jsonb,
  input_tokens     integer,
  output_tokens    integer,
  cost_usd         numeric(10,6),
  latency_ms       integer,
  error_text       text
);

CREATE INDEX IF NOT EXISTS idx_fa_submissions_round ON fa_submissions(round_id);
CREATE INDEX IF NOT EXISTS idx_fa_submissions_agent ON fa_submissions(agent_id);

-- ── fa_scores ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fa_scores (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id       uuid NOT NULL UNIQUE REFERENCES fa_submissions(id) ON DELETE CASCADE,
  round_id            uuid NOT NULL REFERENCES fa_rounds(id),
  agent_id            uuid NOT NULL REFERENCES fa_agents(id),
  brier_score         numeric(8,6),
  log_loss            numeric(10,6),
  edge_at_submission  numeric(8,6),
  resolved_outcome    boolean,
  scored_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fa_scores_agent ON fa_scores(agent_id);
CREATE INDEX IF NOT EXISTS idx_fa_scores_round ON fa_scores(round_id);

-- ── fa_leaderboard_cache ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fa_leaderboard_cache (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id          uuid NOT NULL REFERENCES fa_agents(id),
  period            text NOT NULL DEFAULT 'all_time',
  category          text,
  total_submissions integer NOT NULL DEFAULT 0,
  avg_brier         numeric(8,6),
  avg_log_loss      numeric(10,6),
  avg_edge          numeric(8,6),
  last_updated      timestamptz NOT NULL DEFAULT now()
);

-- ── fa_agent_wallets ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fa_agent_wallets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id          uuid NOT NULL UNIQUE REFERENCES fa_agents(id),
  paper_balance_usd numeric(14,2) NOT NULL DEFAULT 10000.00,
  total_notional_usd numeric(14,2) NOT NULL DEFAULT 0.00,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ── fa_transactions ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fa_transactions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id            uuid NOT NULL REFERENCES fa_agents(id),
  submission_id       uuid REFERENCES fa_submissions(id),
  round_id            uuid REFERENCES fa_rounds(id),
  type                text NOT NULL,
  side                text,
  market_price_at_entry numeric(6,4),
  paper_size_usd      numeric(14,2),
  notional_usd        numeric(14,2),
  outcome             text,
  pnl_usd             numeric(14,2),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fa_transactions_agent ON fa_transactions(agent_id);

-- ── fa_audit_events ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fa_audit_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   text NOT NULL,
  entity_type  text,
  entity_id    text,
  actor        text,
  payload_json jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fa_audit_events_type ON fa_audit_events(event_type);
CREATE INDEX IF NOT EXISTS idx_fa_audit_events_ts ON fa_audit_events(created_at DESC);

-- ── fa_sync_jobs ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fa_sync_jobs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type           text NOT NULL,
  status             text NOT NULL DEFAULT 'running',
  started_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz,
  records_processed  integer DEFAULT 0,
  error_text         text,
  metadata_json      jsonb
);

-- ============================================================================
-- RLS: enable on all tables, deny anon, allow service_role full access
-- ============================================================================

ALTER TABLE fa_markets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE fa_market_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fa_seasons           ENABLE ROW LEVEL SECURITY;
ALTER TABLE fa_agents            ENABLE ROW LEVEL SECURITY;
ALTER TABLE fa_rounds            ENABLE ROW LEVEL SECURITY;
ALTER TABLE fa_submissions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE fa_scores            ENABLE ROW LEVEL SECURITY;
ALTER TABLE fa_leaderboard_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE fa_agent_wallets     ENABLE ROW LEVEL SECURITY;
ALTER TABLE fa_transactions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE fa_audit_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE fa_sync_jobs         ENABLE ROW LEVEL SECURITY;

-- Service role bypass (full access for server-side operations)
CREATE POLICY fa_markets_service           ON fa_markets           FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY fa_market_snapshots_service  ON fa_market_snapshots  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY fa_seasons_service           ON fa_seasons           FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY fa_agents_service            ON fa_agents            FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY fa_rounds_service            ON fa_rounds            FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY fa_submissions_service       ON fa_submissions       FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY fa_scores_service            ON fa_scores            FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY fa_leaderboard_cache_service ON fa_leaderboard_cache FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY fa_agent_wallets_service     ON fa_agent_wallets     FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY fa_transactions_service      ON fa_transactions      FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY fa_audit_events_service      ON fa_audit_events      FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY fa_sync_jobs_service         ON fa_sync_jobs         FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- Views
-- ============================================================================

-- Leaderboard: aggregate scores per agent, all time
CREATE OR REPLACE VIEW fa_v_leaderboard AS
SELECT
  a.id              AS agent_id,
  a.slug,
  a.display_name,
  a.model_id,
  a.provider,
  COUNT(s.id)       AS total_submissions,
  AVG(sc.brier_score)      AS avg_brier,
  AVG(sc.log_loss)         AS avg_log_loss,
  AVG(sc.edge_at_submission) AS avg_edge,
  SUM(sub.cost_usd)        AS total_cost_usd,
  SUM(sub.input_tokens)    AS total_input_tokens,
  SUM(sub.output_tokens)   AS total_output_tokens
FROM fa_agents a
LEFT JOIN fa_submissions sub ON sub.agent_id = a.id
LEFT JOIN fa_scores sc ON sc.submission_id = sub.id
LEFT JOIN fa_submissions s ON s.agent_id = a.id
WHERE a.is_active = true
GROUP BY a.id, a.slug, a.display_name, a.model_id, a.provider;

-- Round summary: joins rounds with market info
CREATE OR REPLACE VIEW fa_v_round_summary AS
SELECT
  r.id              AS round_id,
  r.round_number,
  r.status          AS round_status,
  r.opened_at,
  r.closes_at,
  r.resolved_at,
  r.market_yes_price_at_open,
  m.id              AS market_id,
  m.title           AS market_title,
  m.category,
  m.current_yes_price,
  m.status          AS market_status,
  m.close_time      AS market_close_time,
  (SELECT COUNT(*) FROM fa_submissions sub WHERE sub.round_id = r.id) AS submission_count
FROM fa_rounds r
JOIN fa_markets m ON m.id = r.market_id;

-- ============================================================================
-- Seed: default season
-- ============================================================================

INSERT INTO fa_seasons (name, status, starts_at) VALUES ('Season 1', 'active', now())
ON CONFLICT DO NOTHING;
