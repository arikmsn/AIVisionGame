/**
 * Forecast Arena v2 — Shared Types
 *
 * Single source of truth for all v2 entity shapes.
 * Import from here, not from individual modules.
 */

// ── Domain priority thresholds ────────────────────────────────────────────────

/**
 * Minimum absolute edge (aggregated_p − market_price) required to open.
 *
 * Thresholds MUST be ≤ AGG_MIN_EDGE (0.10) in aggregator.ts so that any
 * signal that passes the aggregator gate can also open a v2 position.
 * Setting them higher silently kills valid trades before they ever execute.
 *
 * Pilot phase: keep all thresholds at 0.08 to maximise data collection.
 * Raise selectively once per-domain Brier scores accumulate (≥30 resolutions).
 */
export const V2_MIN_ENTRY_EDGE: Record<string, number> = {
  politics:    0.08,
  geopolitics: 0.08,
  tech:        0.08,
  crypto:      0.08,
  macro:       0.08,
  culture:     0.08,
  other:       0.08,
  sports:      0.08,   // lowered from 0.15 — collect data first, raise later
};

/** Minimum edge to REVERSE (must be stronger than initial entry). */
export const V2_REVERSAL_EDGE_MULTIPLIER = 2.0;

/** Edge below which we consider reducing an existing position. */
export const V2_REDUCE_EDGE_THRESHOLD    = 0.05;

/** Disagreement (σ) above which we do NOT open new positions. */
export const V2_MAX_DISAGREEMENT_OPEN    = 0.30;  // raised from 0.25 — pilot: allow moderate disagreement

/** Disagreement above which we reduce existing positions. */
export const V2_REDUCE_DISAGREEMENT      = 0.30;

/** Disagreement above which we close existing positions. */
export const V2_CLOSE_DISAGREEMENT       = 0.40;

// ── Sizing ────────────────────────────────────────────────────────────────────

/** Starter position size as fraction of pilot bankroll. */
export const V2_BASE_POSITION_PCT = 0.05;          // 5% = $50 on $1k

/** Maximum position size per market. */
export const V2_MAX_POSITION_PCT  = 0.15;          // 15% = $150 on $1k

/** Maximum total exposure per domain. */
export const V2_MAX_DOMAIN_EXPOSURE_PCT = 0.40;    // 40% = $400

/** Maximum total gross exposure across all positions. */
export const V2_MAX_GROSS_EXPOSURE_PCT  = 0.75;    // 75% = $750

/** Maximum number of concurrent open positions. */
export const V2_MAX_OPEN_POSITIONS = 10;

/** Maximum adjustments per position per day. */
export const V2_MAX_ADJUSTMENTS_PER_DAY = 3;

// ── Execution simulation ──────────────────────────────────────────────────────

/** Simulated spread as fraction of trade size (round-trip 1%). */
export const V2_SPREAD_PCT     = 0.01;

/** Simulated slippage as fraction of trade size. */
export const V2_SLIPPAGE_PCT   = 0.005;

// ── Cooldowns ─────────────────────────────────────────────────────────────────

/** Hours before a market can be re-entered after a close. */
export const V2_REENTRY_COOLDOWN_H = 4;

/** Hours before a resolution at which we enter a caution window. */
export const V2_EXPIRY_CAUTION_H   = 24;

// ── DB row types ──────────────────────────────────────────────────────────────

export interface V2Pilot {
  id:                   string;
  name:                 string;
  initial_bankroll_usd: number;
  current_cash_usd:     number;
  invested_usd:         number;
  realized_pnl_usd:     number;
  unrealized_pnl_usd:   number;
  status:               'active' | 'paused' | 'manual_only' | 'archived';
  started_at:           string;
  archived_at:          string | null;
  notes:                string | null;
}

export interface V2Position {
  id:                   string;
  pilot_id:             string;
  market_id:            string;
  domain:               string | null;
  status:               'open' | 'closed' | 'paused';
  side:                 'yes' | 'no';
  size_usd:             number;
  desired_size_usd:     number | null;
  cost_basis_usd:       number;
  avg_cost:             number | null;
  entry_price:          number;
  current_price:        number | null;
  unrealized_pnl:       number;
  realized_pnl:         number;
  conviction:           number | null;
  disagreement:         number | null;
  edge_at_open:         number | null;
  last_signal_refresh:  string | null;
  next_review_at:       string | null;
  cooldown_until:       string | null;
  thesis:               string | null;
  management_plan:      string | null;
  exit_trigger:         string | null;
  adjustment_count:     number;
  opening_round_id:     string | null;
  opened_at:            string;
  closed_at:            string | null;
  close_reason:         string | null;
  updated_at:           string;
}

export interface V2Adjustment {
  id:                   string;
  position_id:          string;
  pilot_id:             string;
  market_id:            string;
  action:               V2AdjustmentAction;
  size_before:          number;
  size_after:           number;
  delta_usd:            number;
  market_price:         number | null;
  edge:                 number | null;
  conviction:           number | null;
  disagreement:         number | null;
  spread_cost_usd:      number;
  slippage_cost_usd:    number;
  net_cost_usd:         number;
  realized_pnl_delta:   number;
  source:               'system' | 'operator' | 'risk_engine' | 'expiry';
  reason:               string | null;
  operator_note:        string | null;
  round_id:             string | null;
  created_at:           string;
}

export type V2AdjustmentAction = 'open' | 'add' | 'reduce' | 'close' | 'reverse' | 'pause' | 'resume';

export interface V2Signal {
  market_id:            string;
  pilot_id:             string | null;
  domain:               string | null;
  market_price:         number | null;
  aggregated_p:         number | null;
  edge:                 number | null;
  disagreement:         number | null;
  conviction:           number | null;
  n_models:             number | null;
  last_round_id:        string | null;
  last_refresh:         string;
  evidence_freshness_h: number | null;
  tier:                 'monitored' | 'hot' | 'tradable' | 'active' | 'cooling';
  is_stale:             boolean;
  updated_at:           string;
}

// ── Engine types ──────────────────────────────────────────────────────────────

export type V2DesiredAction =
  | 'open'
  | 'add'
  | 'reduce'
  | 'close'
  | 'reverse'
  | 'hold'
  | 'flat';       // no position, stay flat

export interface V2DesiredExposure {
  action:        V2DesiredAction;
  side:          'yes' | 'no' | null;
  desired_size:  number;             // target USD size
  reason:        string;
  conviction:    number;
  disagreement:  number;
}

export interface V2RiskDecision {
  approved:      boolean;
  denial_reason: string | null;
  /** Capped size — may be smaller than desired if a cap was hit. */
  approved_size: number;
}

export interface V2FillResult {
  gross_size:     number;
  spread_cost:    number;
  slippage_cost:  number;
  net_cost:       number;   // amount debited/credited from cash
  realized_pnl:   number;   // only non-zero for reduce/close
}
