/**
 * Forecast Arena — Market Aggregator
 *
 * Transforms N per-model probability estimates into ONE system-level decision
 * per market per round. This is the "brain" layer — individual models are
 * expert advisors; the system is the sole trader.
 *
 * Decision pipeline:
 *   1. Compute weighted mean across all model votes → aggregated_p
 *   2. aggregated_edge = aggregated_p - market_price
 *   3. Disagreement = weighted stddev of {p_i} (0 = perfect consensus)
 *   4. If |aggregated_edge| < AGG_MIN_EDGE → no_trade
 *   5. size = base_size × edge_factor × agreement_factor (see sizing section)
 *
 * Bad-model protection:
 *   Equal weights (v1) mean no single model dominates. A two-model
 *   extreme minority (e.g. Qwen 5%, Gemini 15%) is averaged against
 *   four cautious models near market price, so the aggregate rarely
 *   clears the edge threshold on the minority alone. High disagreement
 *   further shrinks position size even when the threshold is crossed.
 *
 * Weight evolution (future):
 *   Set weight_i > 1 for historically profitable models and weight_i < 1
 *   for consistently loss-making ones. The aggregation formula is
 *   identical; only the weights change.
 *
 * TODO (empirical weights — Manus §8.8):
 *   The calibration store (fa_model_calibration) now records per-agent,
 *   per-domain, per-window (30d / 90d / all) Brier/log-loss/hit-rate.
 *   Once every agent has ≥ 30 resolutions in a domain, call
 *     getCalibrationWeight(agentId, domain, '90d')
 *   from src/lib/forecast/calibration.ts and use it as ModelVote.weight
 *   instead of the hard-coded 1.0 at the call sites (run-round,
 *   daily-cycle, light-cycle). Keep the cold-start default at 1.0.
 *   Live trading weights are unchanged in v1 — calibration is
 *   diagnostic-only until this TODO is resolved.
 */

// ── Thresholds & constants ────────────────────────────────────────────────────

/** Minimum |aggregated_edge| required to open a trade (10%). */
export const AGG_MIN_EDGE = 0.10;

/**
 * Edge level at which edge_factor reaches 1.0 (20%).
 * At 10% edge → factor 0.5×; at 30% edge → factor 1.5× (capped).
 */
export const AGG_HIGH_EDGE = 0.20;

/** Maximum edge scaling factor (applies when edge ≥ 30%). */
export const AGG_MAX_EDGE_FACTOR = 1.5;

/**
 * Disagreement level (weighted stddev) at which agreement_factor hits its
 * floor of AGG_MIN_AGREEMENT_FACTOR (20% stddev = high dispute).
 */
export const AGG_MAX_DISAGREEMENT = 0.20;

/** Floor for agreement_factor — even in chaos we size at 25% of base. */
export const AGG_MIN_AGREEMENT_FACTOR = 0.25;

/** Fraction of bankroll for the base position (2%). */
export const AGG_POSITION_PCT = 0.02;

/** Hard cap per system position in USD. */
export const AGG_MAX_POSITION_USD = 200;

/** Minimum position in USD — don't open below this. */
export const AGG_MIN_POSITION_USD = 5;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ModelVote {
  /** Agent slug (used for logging and nominee selection). */
  agentSlug:       string;
  /** Submission UUID (stored in round context for traceability). */
  submissionId:    string;
  /** Model's calibrated probability that YES resolves. */
  probabilityYes:  number;
  /**
   * Confidence weight for this model.
   * v1: always 1.0 (equal weight).
   * v2+: performance-based, e.g. historical Brier-score derived weight.
   */
  weight:          number;
}

export interface AggregatedDecision {
  // ── Market context ──────────────────────────────────────────────────────────
  marketPrice:      number;
  modelCount:       number;

  // ── Aggregate statistics ────────────────────────────────────────────────────
  aggregatedP:      number;   // weighted mean probability
  aggregatedEdge:   number;   // aggregatedP - marketPrice
  /** Weighted stddev of {p_i} around aggregatedP. Lower = more consensus. */
  disagreement:     number;
  /** Models with p_i > marketPrice (bullish direction). */
  longVotes:        number;
  /** Models with p_i < marketPrice (bearish direction). */
  shortVotes:       number;
  /** Models with |p_i - marketPrice| < AGG_MIN_EDGE (informational). */
  passVotes:        number;

  // ── Sizing components (for UI transparency) ─────────────────────────────────
  edgeFactor:       number;
  agreementFactor:  number;

  // ── Final decision ──────────────────────────────────────────────────────────
  action:           'no_trade' | 'open_long' | 'open_short';
  sizeUsd:          number;
  sizePct:          number;   // fraction of bankroll
  /** Human-readable explanation of the system decision. */
  reason:           string;

  /**
   * Slug of the "nominee" agent used for DB linkage (fa_positions.agent_id).
   * This is the model in the winning direction with the strongest conviction.
   * It does NOT mean that agent made the decision — the system did.
   */
  nomineeSlug:      string | null;
}

// ── Core aggregation ──────────────────────────────────────────────────────────

/**
 * Aggregate model votes into a single system decision.
 *
 * @param votes           Array of per-model probability estimates
 * @param marketPrice     Current Polymarket YES price (0–1)
 * @param bankrollBalance Available bankroll balance (USD)
 */
export function aggregateVotes(
  votes:           ModelVote[],
  marketPrice:     number,
  bankrollBalance: number,
): AggregatedDecision {
  const valid = votes.filter(v => v.probabilityYes != null && v.weight > 0);

  if (valid.length === 0) {
    return _noTrade(marketPrice, 0, 'No valid model submissions');
  }

  // ── Weighted mean ────────────────────────────────────────────────────────────
  const totalWeight  = valid.reduce((s, v) => s + v.weight, 0);
  const aggregatedP  = valid.reduce((s, v) => s + v.weight * v.probabilityYes, 0) / totalWeight;
  const aggregatedEdge = aggregatedP - marketPrice;

  // ── Weighted stddev (disagreement) ───────────────────────────────────────────
  const variance     = valid.reduce(
    (s, v) => s + v.weight * Math.pow(v.probabilityYes - aggregatedP, 2), 0,
  ) / totalWeight;
  const disagreement = Math.sqrt(variance);

  // ── Vote counts (for UI) ─────────────────────────────────────────────────────
  const longVotes  = valid.filter(v => v.probabilityYes > marketPrice).length;
  const shortVotes = valid.filter(v => v.probabilityYes < marketPrice).length;
  const passVotes  = valid.filter(v => Math.abs(v.probabilityYes - marketPrice) < AGG_MIN_EDGE).length;

  // ── Edge gate ────────────────────────────────────────────────────────────────
  if (Math.abs(aggregatedEdge) < AGG_MIN_EDGE) {
    const reason = (
      `Aggregated edge ${aggregatedEdge >= 0 ? '+' : ''}${(aggregatedEdge * 100).toFixed(1)}% ` +
      `is below the ±${(AGG_MIN_EDGE * 100).toFixed(0)}% threshold. ` +
      `(σ=${(disagreement * 100).toFixed(1)}%  ` +
      `${longVotes} bullish / ${shortVotes} bearish across ${valid.length} models)`
    );
    return {
      marketPrice, modelCount: valid.length,
      aggregatedP, aggregatedEdge, disagreement,
      longVotes, shortVotes, passVotes,
      edgeFactor: 0, agreementFactor: 0,
      action: 'no_trade', sizeUsd: 0, sizePct: 0,
      reason, nomineeSlug: null,
    };
  }

  // ── Position sizing ──────────────────────────────────────────────────────────
  //
  //   edge_factor     ∈ [0, AGG_MAX_EDGE_FACTOR]
  //     — scales size up as the signal strengthens
  //     — 0.5× at AGG_MIN_EDGE (10%), 1.0× at AGG_HIGH_EDGE (20%), 1.5× at 30%+
  //
  //   agreement_factor ∈ [AGG_MIN_AGREEMENT_FACTOR, 1.0]
  //     — full size when models agree perfectly (σ=0)
  //     — quarter size when disagreement hits AGG_MAX_DISAGREEMENT (20%)
  //
  const edgeFactor      = Math.min(Math.abs(aggregatedEdge) / AGG_HIGH_EDGE, AGG_MAX_EDGE_FACTOR);
  const agreementFactor = Math.max(
    AGG_MIN_AGREEMENT_FACTOR,
    1.0 - disagreement / AGG_MAX_DISAGREEMENT,
  );

  const baseSize = bankrollBalance * AGG_POSITION_PCT;
  const rawSize  = baseSize * edgeFactor * agreementFactor;
  const sizeUsd  = Math.max(AGG_MIN_POSITION_USD, Math.min(rawSize, AGG_MAX_POSITION_USD));
  const sizePct  = bankrollBalance > 0 ? sizeUsd / bankrollBalance : 0;

  // ── Direction ─────────────────────────────────────────────────────────────────
  const action: 'open_long' | 'open_short' = aggregatedEdge > 0 ? 'open_long' : 'open_short';

  // ── Nominee agent for DB linkage ──────────────────────────────────────────────
  // Pick the model in the winning direction with the highest individual |edge|.
  // This gives us a valid agent_id for the fa_positions row; it does NOT mean
  // that model made the decision.
  const winningDirection = action === 'open_long'
    ? valid.filter(v => v.probabilityYes > marketPrice)
    : valid.filter(v => v.probabilityYes < marketPrice);

  const nominee = (
    winningDirection.sort(
      (a, b) => Math.abs(b.probabilityYes - marketPrice) - Math.abs(a.probabilityYes - marketPrice),
    )[0] ?? valid[0]
  );

  // ── Human-readable reason ─────────────────────────────────────────────────────
  const dirLabel   = action === 'open_long' ? 'long' : 'short';
  const voteLabel  = action === 'open_long'
    ? `${longVotes}/${valid.length} models bullish`
    : `${shortVotes}/${valid.length} models bearish`;
  const agreeLabel = disagreement < 0.05  ? 'strong consensus'
    : disagreement < 0.12 ? 'moderate agreement'
    : 'high disagreement';

  const reason = (
    `Aggregated edge ${aggregatedEdge >= 0 ? '+' : ''}${(aggregatedEdge * 100).toFixed(1)}% → ${dirLabel}. ` +
    `${agreeLabel} (σ=${(disagreement * 100).toFixed(1)}%); ${voteLabel}. ` +
    `Size $${sizeUsd.toFixed(0)} = base×edge${edgeFactor.toFixed(2)}×agree${agreementFactor.toFixed(2)}.`
  );

  return {
    marketPrice, modelCount: valid.length,
    aggregatedP, aggregatedEdge, disagreement,
    longVotes, shortVotes, passVotes,
    edgeFactor, agreementFactor,
    action, sizeUsd, sizePct,
    reason, nomineeSlug: nominee.agentSlug,
  };
}

// ── Internal helper ───────────────────────────────────────────────────────────

function _noTrade(
  marketPrice: number,
  modelCount:  number,
  reason:      string,
): AggregatedDecision {
  return {
    marketPrice, modelCount,
    aggregatedP: marketPrice, aggregatedEdge: 0, disagreement: 0,
    longVotes: 0, shortVotes: 0, passVotes: 0,
    edgeFactor: 0, agreementFactor: 0,
    action: 'no_trade', sizeUsd: 0, sizePct: 0,
    reason, nomineeSlug: null,
  };
}

// ── Serialisable snapshot (stored in fa_rounds.context_json) ──────────────────

/**
 * Returns a plain-object snapshot of the decision suitable for JSON storage.
 * Stored under `context_json.system_decision` on the round row.
 */
export function decisionSnapshot(d: AggregatedDecision): Record<string, unknown> {
  return {
    aggregated_p:      parseFloat(d.aggregatedP.toFixed(4)),
    aggregated_edge:   parseFloat(d.aggregatedEdge.toFixed(4)),
    disagreement:      parseFloat(d.disagreement.toFixed(4)),
    long_votes:        d.longVotes,
    short_votes:       d.shortVotes,
    pass_votes:        d.passVotes,
    model_count:       d.modelCount,
    edge_factor:       parseFloat(d.edgeFactor.toFixed(3)),
    agreement_factor:  parseFloat(d.agreementFactor.toFixed(3)),
    action:            d.action,
    size_usd:          parseFloat(d.sizeUsd.toFixed(2)),
    size_pct:          parseFloat(d.sizePct.toFixed(5)),
    reason:            d.reason,
    nominee_slug:      d.nomineeSlug,
  };
}
