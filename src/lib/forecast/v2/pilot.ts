/**
 * Forecast Arena v2 — Pilot Bankroll Service
 *
 * Reads / writes fa_v2_pilots (single-row for Phase 1).
 * All monetary movements go through these helpers so cash is always consistent.
 */

import { faSelect, faPatch } from '../db';
import type { V2Pilot }      from './types';

// ── Read ──────────────────────────────────────────────────────────────────────

export async function getActivePilot(): Promise<V2Pilot | null> {
  const rows = await faSelect<V2Pilot>(
    'fa_v2_pilots',
    "status=in.(active,paused,manual_only)&order=created_at.asc&limit=1&select=*",
  );
  return rows[0] ?? null;
}

// ── Cash movements ─────────────────────────────────────────────────────────────

/**
 * Debit cash when opening or adding to a position.
 * `netCost` is the total cash outflow (gross + spread + slippage).
 */
export async function debitCash(
  pilotId: string,
  netCost: number,
): Promise<boolean> {
  const pilots = await faSelect<V2Pilot>('fa_v2_pilots', `id=eq.${pilotId}&select=current_cash_usd,invested_usd`);
  const p = pilots[0];
  if (!p) return false;
  return faPatch('fa_v2_pilots', { id: pilotId }, {
    current_cash_usd: Math.max(0, Number(p.current_cash_usd) - netCost),
    invested_usd:     Number(p.invested_usd) + netCost,
  });
}

/**
 * Credit cash when reducing or closing a position.
 * `proceeds` is the cash inflow (gross proceeds - spread - slippage).
 * `realizedPnl` is the P&L component (may be negative).
 */
export async function creditCash(
  pilotId:     string,
  proceeds:    number,
  realizedPnl: number,
  reducedSize: number,
): Promise<boolean> {
  const pilots = await faSelect<V2Pilot>('fa_v2_pilots', `id=eq.${pilotId}&select=current_cash_usd,invested_usd,realized_pnl_usd`);
  const p = pilots[0];
  if (!p) return false;
  return faPatch('fa_v2_pilots', { id: pilotId }, {
    current_cash_usd:  Number(p.current_cash_usd) + proceeds,
    invested_usd:      Math.max(0, Number(p.invested_usd) - reducedSize),
    realized_pnl_usd:  Number(p.realized_pnl_usd) + realizedPnl,
  });
}

/**
 * Update the mark-to-market unrealized P&L snapshot.
 * Called at the end of each cycle after all positions are priced.
 */
export async function updateUnrealizedPnl(
  pilotId:       string,
  unrealizedPnl: number,
  investedUsd:   number,
): Promise<boolean> {
  return faPatch('fa_v2_pilots', { id: pilotId }, {
    unrealized_pnl_usd: unrealizedPnl,
    invested_usd:       investedUsd,
  });
}

/** Set pilot status (active / paused / manual_only). */
export async function setPilotStatus(
  pilotId: string,
  status:  V2Pilot['status'],
): Promise<boolean> {
  return faPatch('fa_v2_pilots', { id: pilotId }, { status });
}
