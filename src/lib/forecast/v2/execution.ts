/**
 * Forecast Arena v2 — Execution Simulator
 *
 * Simulates fill mechanics for paper trading:
 *   • Spread cost  = size × V2_SPREAD_PCT  (round-trip; charged on open/close)
 *   • Slippage     = size × V2_SLIPPAGE_PCT (always unfavorable)
 *
 * For opens  (buy YES or buy NO):
 *   net_cost = gross_size + spread_cost + slippage_cost
 *   → cash debited by net_cost
 *
 * For closes / reduces (sell):
 *   proceeds     = gross_size − spread_cost − slippage_cost
 *   realized_pnl = proceeds − cost_basis_of_sold_fraction
 *   → cash credited by proceeds
 *
 * For reverses we close the old leg then open the new leg; the caller is
 * responsible for invoking simulateClose + simulateOpen in sequence.
 */

import { faInsert } from '../db';
import type { V2Position, V2FillResult } from './types';
import { V2_SPREAD_PCT, V2_SLIPPAGE_PCT } from './types';

// ── Open fill ─────────────────────────────────────────────────────────────────

/**
 * Simulate an open or add fill.
 *
 * @param grossSize  Approved USD size from the risk engine
 * @returns          Fill cost breakdown; cash decreases by net_cost
 */
export function simulateOpen(grossSize: number): V2FillResult {
  const spreadCost   = grossSize * V2_SPREAD_PCT;
  const slippageCost = grossSize * V2_SLIPPAGE_PCT;
  const netCost      = grossSize + spreadCost + slippageCost;
  return {
    gross_size:    grossSize,
    spread_cost:   spreadCost,
    slippage_cost: slippageCost,
    net_cost:      netCost,
    realized_pnl:  0,
  };
}

// ── Close / reduce fill ───────────────────────────────────────────────────────

/**
 * Simulate a reduce or close fill.
 *
 * @param grossSize      USD notional being sold
 * @param position       The position being reduced/closed (for cost-basis calc)
 * @param fractionSold   0–1 fraction of current position being sold
 * @returns              Fill proceeds; cash increases by net_cost (which is negative → credit)
 */
export function simulateClose(
  grossSize:    number,
  position:     V2Position,
  fractionSold: number,
): V2FillResult {
  const spreadCost   = grossSize * V2_SPREAD_PCT;
  const slippageCost = grossSize * V2_SLIPPAGE_PCT;
  const proceeds     = grossSize - spreadCost - slippageCost;

  // Realized P&L = proceeds − cost basis of the fraction sold
  const costBasis    = Number(position.cost_basis_usd) * fractionSold;
  const realizedPnl  = proceeds - costBasis;

  return {
    gross_size:    grossSize,
    spread_cost:   spreadCost,
    slippage_cost: slippageCost,
    net_cost:      proceeds,   // positive amount credited back to cash
    realized_pnl:  realizedPnl,
  };
}

// ── Log adjustment ────────────────────────────────────────────────────────────

export interface LogAdjustmentInput {
  positionId:    string;
  pilotId:       string;
  marketId:      string;
  action:        'open' | 'add' | 'reduce' | 'close' | 'reverse' | 'pause' | 'resume';
  sizeBefore:    number;
  sizeAfter:     number;
  deltaUsd:      number;
  marketPrice:   number | null;
  edge:          number | null;
  conviction:    number | null;
  disagreement:  number | null;
  fill:          V2FillResult;
  source:        'system' | 'operator' | 'risk_engine' | 'expiry';
  reason:        string | null;
  operatorNote:  string | null;
  roundId:       string | null;
}

/**
 * Write one row to fa_v2_adjustments.
 * Best-effort — a logging failure never blocks execution.
 */
export async function logAdjustment(input: LogAdjustmentInput): Promise<void> {
  try {
    await faInsert('fa_v2_adjustments', [{
      position_id:        input.positionId,
      pilot_id:           input.pilotId,
      market_id:          input.marketId,
      action:             input.action,
      size_before:        input.sizeBefore,
      size_after:         input.sizeAfter,
      delta_usd:          input.deltaUsd,
      market_price:       input.marketPrice,
      edge:               input.edge,
      conviction:         input.conviction,
      disagreement:       input.disagreement,
      spread_cost_usd:    input.fill.spread_cost,
      slippage_cost_usd:  input.fill.slippage_cost,
      net_cost_usd:       input.fill.net_cost,
      realized_pnl_delta: input.fill.realized_pnl,
      source:             input.source,
      reason:             input.reason,
      operator_note:      input.operatorNote,
      round_id:           input.roundId,
    }]);
  } catch (err: any) {
    console.error(`[V2/EXEC] logAdjustment error: ${err?.message ?? err}`);
  }
}
