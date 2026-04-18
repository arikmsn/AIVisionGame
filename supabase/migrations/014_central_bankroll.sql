-- Migration 014: Central Bankroll
-- Replaces per-agent wallet model with a single shared capital pool.
-- Agent wallets are kept for backward compatibility but are no longer
-- the source of truth for capital availability.

-- ── Central bankroll (single row, shared pool) ────────────────────────────────

CREATE TABLE IF NOT EXISTS fa_central_bankroll (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  total_deposit_usd   numeric(14,2) NOT NULL DEFAULT 60000.00,
  available_usd       numeric(14,2) NOT NULL DEFAULT 60000.00,
  allocated_usd       numeric(14,2) NOT NULL DEFAULT 0.00,
  total_realized_pnl  numeric(14,4) NOT NULL DEFAULT 0.00,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Seed with one row, reconciling against current open positions & transactions.
-- available_usd  = deposit - currently_deployed + realized_gains
-- allocated_usd  = sum of cost_basis_usd for all open positions
INSERT INTO fa_central_bankroll (
  total_deposit_usd,
  available_usd,
  allocated_usd,
  total_realized_pnl
)
SELECT
  60000.00 AS total_deposit_usd,
  GREATEST(
    60000.00
    - COALESCE((SELECT SUM(cost_basis_usd) FROM fa_positions WHERE status = 'open'), 0)
    + COALESCE((SELECT SUM(pnl_usd) FROM fa_transactions WHERE pnl_usd IS NOT NULL), 0),
    0
  ) AS available_usd,
  COALESCE((SELECT SUM(cost_basis_usd) FROM fa_positions WHERE status = 'open'), 0) AS allocated_usd,
  COALESCE((SELECT SUM(pnl_usd) FROM fa_transactions WHERE pnl_usd IS NOT NULL), 0) AS total_realized_pnl
WHERE NOT EXISTS (SELECT 1 FROM fa_central_bankroll);

-- ── Finance summary view ──────────────────────────────────────────────────────
-- Computes live financial state from central bankroll + open positions.

CREATE OR REPLACE VIEW fa_v_finance AS
SELECT
  cb.id,
  cb.total_deposit_usd,
  cb.available_usd,
  cb.allocated_usd,
  cb.total_realized_pnl,
  COALESCE(pos.total_unrealized_pnl, 0)  AS total_unrealized_pnl,
  COALESCE(pos.open_position_count,  0)  AS open_position_count,
  COALESCE(pos.closed_position_count,0)  AS closed_position_count,
  cb.total_deposit_usd
    + cb.total_realized_pnl
    + COALESCE(pos.total_unrealized_pnl, 0)  AS net_value_usd,
  cb.updated_at
FROM fa_central_bankroll cb
LEFT JOIN (
  SELECT
    SUM(CASE WHEN status = 'open'   THEN unrealized_pnl ELSE 0 END) AS total_unrealized_pnl,
    COUNT(CASE WHEN status = 'open'   THEN 1 END)                   AS open_position_count,
    COUNT(CASE WHEN status = 'closed' THEN 1 END)                   AS closed_position_count
  FROM fa_positions
) pos ON true;
