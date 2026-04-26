-- Migration 017: Forecast Arena v2 — High-Cadence Dynamic Paper Trader
--
-- Adds the v2 trading layer: one position per market (not per model),
-- desired-exposure model, position adjustment lifecycle log, signal state
-- cache, and operator action audit log.
--
-- Existing research tables (fa_rounds, fa_submissions, fa_scores,
-- fa_calibration_events, fa_positions, fa_central_bankroll) are kept
-- unchanged. The v2 layer runs in parallel and will replace the legacy
-- position/bankroll tables in Phase 2.
--
-- Phase 1 pilot bankroll: $1,000

-- ── Pilot ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fa_v2_pilots (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text        NOT NULL DEFAULT 'Pilot v2',
  initial_bankroll_usd  numeric(14,4) NOT NULL DEFAULT 1000.00,
  current_cash_usd      numeric(14,4) NOT NULL DEFAULT 1000.00,
  invested_usd          numeric(14,4) NOT NULL DEFAULT 0.00,
  realized_pnl_usd      numeric(14,4) NOT NULL DEFAULT 0.00,
  unrealized_pnl_usd    numeric(14,4) NOT NULL DEFAULT 0.00,
  status                text        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','paused','manual_only','archived')),
  started_at            timestamptz NOT NULL DEFAULT now(),
  archived_at           timestamptz,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Seed the first $1,000 pilot
INSERT INTO fa_v2_pilots (name, initial_bankroll_usd, current_cash_usd, status)
VALUES ('Phase 1 Pilot', 1000.00, 1000.00, 'active')
ON CONFLICT DO NOTHING;

-- ── Positions ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fa_v2_positions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pilot_id              uuid        NOT NULL REFERENCES fa_v2_pilots(id),
  market_id             uuid        NOT NULL REFERENCES fa_markets(id),
  domain                text,

  -- Lifecycle
  status                text        NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open','closed','paused')),
  side                  text        NOT NULL CHECK (side IN ('yes','no')),

  -- Sizing (current state)
  size_usd              numeric(14,4) NOT NULL DEFAULT 0,
  desired_size_usd      numeric(14,4),
  cost_basis_usd        numeric(14,4) NOT NULL DEFAULT 0,
  avg_cost              numeric(6,4),

  -- Prices
  entry_price           numeric(6,4) NOT NULL,
  current_price         numeric(6,4),

  -- P&L (denormalized for fast reads)
  unrealized_pnl        numeric(14,4) NOT NULL DEFAULT 0,
  realized_pnl          numeric(14,4) NOT NULL DEFAULT 0,

  -- Signal state at last review
  conviction            numeric(4,3),
  disagreement          numeric(4,3),
  edge_at_open          numeric(5,3),
  last_signal_refresh   timestamptz,
  next_review_at        timestamptz,
  cooldown_until        timestamptz,

  -- Operator-facing narrative fields
  thesis                text,
  management_plan       text,
  exit_trigger          text,

  -- Counters
  adjustment_count      integer     NOT NULL DEFAULT 0,

  -- Round that opened this position
  opening_round_id      uuid        REFERENCES fa_rounds(id),

  -- Timestamps
  opened_at             timestamptz NOT NULL DEFAULT now(),
  closed_at             timestamptz,
  close_reason          text,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Only one open/paused position per market per pilot
CREATE UNIQUE INDEX IF NOT EXISTS fa_v2_pos_one_open
  ON fa_v2_positions(pilot_id, market_id)
  WHERE status IN ('open','paused');

CREATE INDEX IF NOT EXISTS idx_fa_v2_pos_pilot_status
  ON fa_v2_positions(pilot_id, status);

CREATE INDEX IF NOT EXISTS idx_fa_v2_pos_market
  ON fa_v2_positions(market_id);

-- ── Adjustment log ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fa_v2_adjustments (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id           uuid        NOT NULL REFERENCES fa_v2_positions(id),
  pilot_id              uuid        NOT NULL REFERENCES fa_v2_pilots(id),
  market_id             uuid        NOT NULL REFERENCES fa_markets(id),

  action                text        NOT NULL
                          CHECK (action IN ('open','add','reduce','close','reverse','pause','resume')),

  -- Sizes before and after
  size_before           numeric(14,4) NOT NULL DEFAULT 0,
  size_after            numeric(14,4) NOT NULL DEFAULT 0,
  delta_usd             numeric(14,4) NOT NULL DEFAULT 0,  -- positive = buy, negative = sell

  -- Market conditions at action time
  market_price          numeric(6,4),
  edge                  numeric(5,3),
  conviction            numeric(4,3),
  disagreement          numeric(4,3),

  -- Execution simulation
  spread_cost_usd       numeric(10,4) NOT NULL DEFAULT 0,
  slippage_cost_usd     numeric(10,4) NOT NULL DEFAULT 0,
  net_cost_usd          numeric(14,4) NOT NULL DEFAULT 0,

  -- P&L impact (for reduce/close)
  realized_pnl_delta    numeric(14,4) NOT NULL DEFAULT 0,

  -- Attribution
  source                text        NOT NULL DEFAULT 'system'
                          CHECK (source IN ('system','operator','risk_engine','expiry')),
  reason                text,
  operator_note         text,

  -- Traceability
  round_id              uuid        REFERENCES fa_rounds(id),

  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fa_v2_adj_position
  ON fa_v2_adjustments(position_id, created_at);

CREATE INDEX IF NOT EXISTS idx_fa_v2_adj_pilot
  ON fa_v2_adjustments(pilot_id, created_at DESC);

-- ── Signal state cache ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fa_v2_signals (
  market_id             uuid        PRIMARY KEY REFERENCES fa_markets(id),
  pilot_id              uuid        REFERENCES fa_v2_pilots(id),
  domain                text,

  -- Latest signal
  market_price          numeric(6,4),
  aggregated_p          numeric(6,4),
  edge                  numeric(5,3),
  disagreement          numeric(4,3),
  conviction            numeric(4,3),
  n_models              integer,

  -- Evidence freshness
  last_round_id         uuid        REFERENCES fa_rounds(id),
  last_refresh          timestamptz NOT NULL DEFAULT now(),
  evidence_freshness_h  numeric(6,2),

  -- Market tier
  tier                  text        NOT NULL DEFAULT 'monitored'
                          CHECK (tier IN ('monitored','hot','tradable','active','cooling')),
  is_stale              boolean     NOT NULL DEFAULT false,

  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fa_v2_signals_tier
  ON fa_v2_signals(tier, conviction DESC NULLS LAST);

-- ── Operator actions log ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fa_v2_operator_actions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pilot_id              uuid        REFERENCES fa_v2_pilots(id),
  action_type           text        NOT NULL
                          CHECK (action_type IN (
                            'close_position','reduce_position','add_position',
                            'pause_market','resume_market',
                            'close_all','pause_all','resume_all',
                            'manual_only','auto_mode','reset_pilot'
                          )),
  market_id             uuid        REFERENCES fa_markets(id),
  position_id           uuid        REFERENCES fa_v2_positions(id),
  amount_usd            numeric(14,4),
  reason                text,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fa_v2_op_pilot
  ON fa_v2_operator_actions(pilot_id, created_at DESC);
