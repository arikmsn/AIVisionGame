-- Migration 015: Domain tagging, calibration store, benchmark harness
--
-- Roadmap items 1-3 from Manus blueprint:
--   1. Calibration store + resolution hook     → fa_calibration_events, fa_model_calibration
--   2. Domain tagging on fa_markets            → fa_markets.domain column
--   3. Benchmark harness                       → fa_benchmarks
--
-- All tables are append/upsert-only. No mutation of existing tables
-- except adding the domain column to fa_markets (nullable, backfilled
-- by a one-shot admin route — see /api/forecast/admin/backfill-domains).

-- ── 1. Domain column on fa_markets ────────────────────────────────────────────

ALTER TABLE fa_markets
  ADD COLUMN IF NOT EXISTS domain text;

-- Enum-like check. Keep in sync with src/lib/forecast/domains.ts::DOMAINS.
ALTER TABLE fa_markets
  DROP CONSTRAINT IF EXISTS fa_markets_domain_check;

ALTER TABLE fa_markets
  ADD CONSTRAINT fa_markets_domain_check
  CHECK (domain IS NULL OR domain IN (
    'politics', 'geopolitics', 'tech', 'sports',
    'crypto',   'macro',       'culture', 'other'
  ));

CREATE INDEX IF NOT EXISTS idx_fa_markets_domain ON fa_markets(domain);

-- ── 2. Calibration events (append-only substrate) ────────────────────────────
--
-- Every resolved submission gets one row. Rollups in fa_model_calibration
-- recompute from this table, so any window (30d / 90d / 'all') can be
-- computed retroactively without data loss.

CREATE TABLE IF NOT EXISTS fa_calibration_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resolved_at        timestamptz NOT NULL DEFAULT now(),
  market_id          uuid        NOT NULL REFERENCES fa_markets(id)    ON DELETE CASCADE,
  round_id           uuid        NOT NULL REFERENCES fa_rounds(id)     ON DELETE CASCADE,
  submission_id      uuid                 REFERENCES fa_submissions(id) ON DELETE SET NULL,
  agent_id           uuid        NOT NULL REFERENCES fa_agents(id)     ON DELETE CASCADE,
  domain             text        NOT NULL,
  p_model            numeric(6,4) NOT NULL,
  p_market_at_open   numeric(6,4),
  p_system           numeric(6,4),           -- aggregated_p from system decision; nullable for legacy
  outcome            boolean     NOT NULL,
  brier              numeric(8,6) NOT NULL,
  log_loss           numeric(8,6) NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id)
);

CREATE INDEX IF NOT EXISTS idx_fa_calib_events_agent_domain_resolved
  ON fa_calibration_events(agent_id, domain, resolved_at DESC);

CREATE INDEX IF NOT EXISTS idx_fa_calib_events_domain_resolved
  ON fa_calibration_events(domain, resolved_at DESC);

-- ── 3. Per-agent per-domain per-window calibration rollup ─────────────────────

CREATE TABLE IF NOT EXISTS fa_model_calibration (
  agent_id        uuid        NOT NULL REFERENCES fa_agents(id) ON DELETE CASCADE,
  domain          text        NOT NULL,
  time_window     text        NOT NULL,          -- '30d' | '90d' | 'all'
  brier_score     numeric(8,6),
  log_loss        numeric(8,6),
  hit_rate        numeric(6,4),                  -- fraction where sign(p_model - 0.5) matches outcome
  mean_edge       numeric(8,6),                  -- mean of (market_brier - agent_brier) across window
  n_resolved      integer     NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, domain, time_window)
);

CREATE INDEX IF NOT EXISTS idx_fa_model_calib_domain_window
  ON fa_model_calibration(domain, time_window);

-- ── 4. Benchmark results (daily snapshot) ─────────────────────────────────────
--
-- One row per (computed_at day, window, domain, baseline). We upsert on
-- the composite so repeated runs on the same day overwrite.

CREATE TABLE IF NOT EXISTS fa_benchmarks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  computed_at        timestamptz NOT NULL DEFAULT now(),
  computed_day       date        NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  time_window        text        NOT NULL,
  domain             text        NOT NULL,           -- domain or 'all'
  baseline           text        NOT NULL,           -- 'market' | 'ensemble' | 'best_single' | 'agent:<slug>'
  baseline_detail    text,                           -- e.g. the slug when baseline='best_single'
  brier_score        numeric(8,6),
  log_loss           numeric(8,6),
  calibration_slope  numeric(8,6),
  n_resolved         integer     NOT NULL,
  UNIQUE (computed_day, time_window, domain, baseline)
);

CREATE INDEX IF NOT EXISTS idx_fa_benchmarks_domain_day
  ON fa_benchmarks(domain, computed_day DESC);
