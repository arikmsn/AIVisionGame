-- ============================================================================
-- Migration 013: Forecast Arena — Live Position Management
--
-- Adds persistent position tracking so each agent holds a position over
-- the life of a market rather than making a single one-shot forecast.
-- ============================================================================

-- ── fa_positions ─────────────────────────────────────────────────────────────
-- One row per agent per market while position is open.
-- Closed positions are retained for history (status = 'closed').
-- A partial unique index enforces only one OPEN position per agent+market.

CREATE TABLE IF NOT EXISTS fa_positions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id           uuid        NOT NULL REFERENCES fa_agents(id),
  market_id          uuid        NOT NULL REFERENCES fa_markets(id),

  -- Links back to the round/submission that opened this position
  round_id           uuid        REFERENCES fa_rounds(id),
  submission_id      uuid        REFERENCES fa_submissions(id),

  -- State
  status             text        NOT NULL DEFAULT 'open',  -- open | closed
  side               text        NOT NULL,                 -- long | short

  -- Size & cost basis (updated on scale-in/out)
  size_usd           numeric(14,4) NOT NULL,       -- current USD value of open contracts
  cost_basis_usd     numeric(14,4) NOT NULL,       -- total USD deployed (including scale-ins)
  contracts          numeric(18,6) NOT NULL,       -- total contracts currently held
  avg_entry_price    numeric(6,4) NOT NULL,        -- cost-basis-weighted average entry price

  -- Price tracking
  open_price         numeric(6,4) NOT NULL,        -- market price when position first opened
  current_price      numeric(6,4),                 -- latest market price (updated each tick)

  -- P&L (recomputed each tick)
  unrealized_pnl     numeric(14,4) NOT NULL DEFAULT 0,
  realized_pnl       numeric(14,4) NOT NULL DEFAULT 0,  -- locked in from scale-outs / partial exits

  -- Management state
  scale_in_count     integer NOT NULL DEFAULT 0,   -- how many times we scaled in
  scale_out_count    integer NOT NULL DEFAULT 0,   -- how many times we took profit
  tick_count         integer NOT NULL DEFAULT 0,   -- total ticks processed
  last_action        text,                         -- hold|scale_in|scale_out|stop_loss|expiry_exit|close
  last_tick_at       timestamptz,

  -- Timestamps
  opened_at          timestamptz NOT NULL DEFAULT now(),
  closed_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Enforce only one OPEN position per agent per market
CREATE UNIQUE INDEX IF NOT EXISTS fa_positions_one_open
  ON fa_positions(agent_id, market_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_fa_positions_agent    ON fa_positions(agent_id);
CREATE INDEX IF NOT EXISTS idx_fa_positions_market   ON fa_positions(market_id);
CREATE INDEX IF NOT EXISTS idx_fa_positions_status   ON fa_positions(status);
CREATE INDEX IF NOT EXISTS idx_fa_positions_updated  ON fa_positions(updated_at DESC);

-- ── fa_position_ticks ─────────────────────────────────────────────────────────
-- Immutable audit log of every tick decision for every position.
-- This drives the "history of adjustments" view in the UI.

CREATE TABLE IF NOT EXISTS fa_position_ticks (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id    uuid        NOT NULL REFERENCES fa_positions(id) ON DELETE CASCADE,
  agent_id       uuid        NOT NULL REFERENCES fa_agents(id),
  market_id      uuid        NOT NULL REFERENCES fa_markets(id),

  tick_number    integer     NOT NULL,       -- 1-based tick sequence for this position
  market_price   numeric(6,4) NOT NULL,      -- Polymarket price at tick time
  action         text        NOT NULL,       -- hold|scale_in|scale_out|stop_loss|expiry_exit|close
  size_delta_usd numeric(14,4),              -- USD added (+) or removed (-)
  unrealized_pnl numeric(14,4),
  realized_pnl   numeric(14,4),
  notes          text,

  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fa_position_ticks_position ON fa_position_ticks(position_id);
CREATE INDEX IF NOT EXISTS idx_fa_position_ticks_ts       ON fa_position_ticks(created_at DESC);

-- ── Extend fa_transactions with optional position_id ─────────────────────────
-- Links each paper trade transaction to the position that caused it.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='fa_transactions' AND column_name='position_id'
  ) THEN
    ALTER TABLE fa_transactions ADD COLUMN position_id uuid REFERENCES fa_positions(id);
  END IF;
END $$;

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE fa_positions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE fa_position_ticks ENABLE ROW LEVEL SECURITY;

CREATE POLICY fa_positions_service
  ON fa_positions      FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY fa_position_ticks_service
  ON fa_position_ticks FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Views ─────────────────────────────────────────────────────────────────────

-- Open positions enriched with agent and market names
CREATE OR REPLACE VIEW fa_v_open_positions AS
SELECT
  p.id              AS position_id,
  p.status,
  p.side,
  p.size_usd,
  p.cost_basis_usd,
  p.contracts,
  p.avg_entry_price,
  p.open_price,
  p.current_price,
  p.unrealized_pnl,
  p.realized_pnl,
  p.unrealized_pnl + p.realized_pnl AS total_pnl,
  CASE WHEN p.cost_basis_usd > 0
    THEN (p.unrealized_pnl + p.realized_pnl) / p.cost_basis_usd
    ELSE 0
  END               AS pnl_pct,
  p.scale_in_count,
  p.scale_out_count,
  p.tick_count,
  p.last_action,
  p.last_tick_at,
  p.opened_at,
  p.closed_at,
  p.round_id,
  p.submission_id,
  a.id              AS agent_id,
  a.slug            AS agent_slug,
  a.display_name    AS agent_display_name,
  a.model_id,
  a.provider,
  m.id              AS market_id,
  m.title           AS market_title,
  m.category        AS market_category,
  m.close_time      AS market_close_time,
  m.status          AS market_status,
  m.current_yes_price AS market_current_yes_price
FROM fa_positions p
JOIN fa_agents  a ON a.id = p.agent_id
JOIN fa_markets m ON m.id = p.market_id
WHERE p.status = 'open';

-- Agent P&L summary (open + closed)
CREATE OR REPLACE VIEW fa_v_position_summary AS
SELECT
  a.id              AS agent_id,
  a.slug,
  a.display_name,
  a.model_id,
  a.provider,
  COUNT(*)                                    AS total_positions,
  COUNT(*) FILTER (WHERE p.status = 'open')  AS open_positions,
  COUNT(*) FILTER (WHERE p.status = 'closed') AS closed_positions,
  SUM(p.cost_basis_usd)                       AS total_deployed_usd,
  SUM(p.realized_pnl)                         AS total_realized_pnl,
  SUM(p.unrealized_pnl)
    FILTER (WHERE p.status = 'open')          AS total_unrealized_pnl,
  SUM(p.realized_pnl + p.unrealized_pnl)     AS total_pnl,
  AVG(p.realized_pnl / NULLIF(p.cost_basis_usd, 0))
    FILTER (WHERE p.status = 'closed')        AS avg_closed_return_pct
FROM fa_positions p
JOIN fa_agents a ON a.id = p.agent_id
GROUP BY a.id, a.slug, a.display_name, a.model_id, a.provider;
