/**
 * Forecast Arena v2 — Position Lifecycle
 *
 * Orchestrates the full open → add → reduce → close → reverse lifecycle.
 * Each public function:
 *   1. Calls checkRisk() — stops if denied
 *   2. Simulates the fill (execution.ts)
 *   3. Updates fa_v2_positions via REST
 *   4. Debits/credits fa_v2_pilots
 *   5. Logs the adjustment row
 *
 * The "process a round" entry point is processRoundSignal(), which takes a
 * fresh AggregatedDecision, runs desired-exposure, and executes if approved.
 */

import { faInsert, faSelect, faPatch } from '../db';
import type { AggregatedDecision }     from '../aggregator';
import { getActivePilot, debitCash, creditCash } from './pilot';
import { checkRisk }                   from './risk';
import { simulateOpen, simulateClose, logAdjustment } from './execution';
import { computeConviction }           from './signals';
import { computeDesiredExposure }      from './desired-exposure';
import type { V2Position, V2FillResult } from './types';
import { V2_EXPIRY_CAUTION_H }         from './types';

// ── DB helpers ────────────────────────────────────────────────────────────────

export async function getOpenPosition(
  pilotId: string,
  marketId: string,
): Promise<V2Position | null> {
  const rows = await faSelect<V2Position>(
    'fa_v2_positions',
    `pilot_id=eq.${pilotId}&market_id=eq.${marketId}&status=in.(open,paused)&select=*`,
  );
  return rows[0] ?? null;
}

async function createPosition(
  pilotId:   string,
  marketId:  string,
  domain:    string | null,
  side:      'yes' | 'no',
  size:      number,
  fill:      V2FillResult,
  price:     number,
  conviction: number,
  disagreement: number,
  edge:      number,
  roundId:   string | null,
  thesis:    string | null,
): Promise<V2Position | null> {
  const rows = await faInsert('fa_v2_positions', [{
    pilot_id:             pilotId,
    market_id:            marketId,
    domain,
    status:               'open',
    side,
    size_usd:             size,
    desired_size_usd:     size,
    cost_basis_usd:       fill.net_cost,
    avg_cost:             price,
    entry_price:          price,
    current_price:        price,
    unrealized_pnl:       0,
    realized_pnl:         0,
    conviction,
    disagreement,
    edge_at_open:         edge,
    last_signal_refresh:  new Date().toISOString(),
    adjustment_count:     1,
    opening_round_id:     roundId,
    opened_at:            new Date().toISOString(),
    updated_at:           new Date().toISOString(),
    thesis,
  }], { returning: true }) as Record<string, unknown>[] | boolean;

  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0] as unknown as V2Position;
}

async function patchPosition(
  id:      string,
  updates: Record<string, unknown>,
): Promise<boolean> {
  return faPatch('fa_v2_positions', { id }, {
    ...updates,
    updated_at: new Date().toISOString(),
  });
}

// ── Open ──────────────────────────────────────────────────────────────────────

export interface OpenPositionInput {
  pilotId:     string;
  marketId:    string;
  domain:      string | null;
  side:        'yes' | 'no';
  desiredSize: number;
  marketPrice: number;
  edge:        number;
  conviction:  number;
  disagreement: number;
  roundId:     string | null;
  thesis:      string | null;
}

export async function openPosition(input: OpenPositionInput): Promise<{ ok: boolean; reason?: string }> {
  const pilot = await getActivePilot();
  if (!pilot || pilot.id !== input.pilotId) {
    return { ok: false, reason: 'pilot not found' };
  }

  const risk = await checkRisk({
    pilot,
    action:         'open',
    marketId:       input.marketId,
    domain:         input.domain,
    proposedSize:   input.desiredSize,
    existingPos:    null,
    isSystemAction: true,
  });
  if (!risk.approved) return { ok: false, reason: risk.denial_reason ?? 'risk denied' };

  const fill = simulateOpen(risk.approved_size);
  const pos  = await createPosition(
    input.pilotId, input.marketId, input.domain, input.side,
    risk.approved_size, fill, input.marketPrice,
    input.conviction, input.disagreement, input.edge,
    input.roundId, input.thesis,
  );
  if (!pos) return { ok: false, reason: 'db insert failed' };

  await debitCash(input.pilotId, fill.net_cost);
  await logAdjustment({
    positionId:   pos.id,
    pilotId:      input.pilotId,
    marketId:     input.marketId,
    action:       'open',
    sizeBefore:   0,
    sizeAfter:    risk.approved_size,
    deltaUsd:     risk.approved_size,
    marketPrice:  input.marketPrice,
    edge:         input.edge,
    conviction:   input.conviction,
    disagreement: input.disagreement,
    fill,
    source:       'system',
    reason:       `open ${input.side}: edge=${input.edge.toFixed(3)}`,
    operatorNote: null,
    roundId:      input.roundId,
  });

  console.log(`[V2/POS] Opened ${input.side} $${risk.approved_size} on ${input.marketId} (${input.domain})`);
  return { ok: true };
}

// ── Add ───────────────────────────────────────────────────────────────────────

export async function addToPosition(
  pilotId:     string,
  pos:         V2Position,
  desiredAdd:  number,
  marketPrice: number,
  edge:        number,
  conviction:  number,
  disagreement: number,
  roundId:     string | null,
): Promise<{ ok: boolean; reason?: string }> {
  const pilot = await getActivePilot();
  if (!pilot || pilot.id !== pilotId) return { ok: false, reason: 'pilot not found' };

  const risk = await checkRisk({
    pilot,
    action:         'add',
    marketId:       pos.market_id,
    domain:         pos.domain,
    proposedSize:   desiredAdd,
    existingPos:    pos,
    isSystemAction: true,
  });
  if (!risk.approved) return { ok: false, reason: risk.denial_reason ?? 'risk denied' };

  const fill     = simulateOpen(risk.approved_size);
  const newSize  = Number(pos.size_usd) + risk.approved_size;
  const newBasis = Number(pos.cost_basis_usd) + fill.net_cost;

  await patchPosition(pos.id, {
    size_usd:             newSize,
    desired_size_usd:     newSize,
    cost_basis_usd:       newBasis,
    conviction,
    disagreement,
    last_signal_refresh:  new Date().toISOString(),
    adjustment_count:     Number(pos.adjustment_count) + 1,
  });
  await debitCash(pilotId, fill.net_cost);
  await logAdjustment({
    positionId:   pos.id,
    pilotId,
    marketId:     pos.market_id,
    action:       'add',
    sizeBefore:   Number(pos.size_usd),
    sizeAfter:    newSize,
    deltaUsd:     risk.approved_size,
    marketPrice,
    edge,
    conviction,
    disagreement,
    fill,
    source:       'system',
    reason:       `add ${risk.approved_size}: conviction=${conviction.toFixed(3)}`,
    operatorNote: null,
    roundId,
  });

  console.log(`[V2/POS] Added $${risk.approved_size} to ${pos.market_id} → total $${newSize}`);
  return { ok: true };
}

// ── Reduce ────────────────────────────────────────────────────────────────────

export async function reducePosition(
  pilotId:     string,
  pos:         V2Position,
  desiredSell: number,
  marketPrice: number,
  edge:        number,
  conviction:  number,
  disagreement: number,
  roundId:     string | null,
  reason:      string,
  source:      'system' | 'operator' | 'risk_engine' | 'expiry' = 'system',
): Promise<{ ok: boolean; reason?: string }> {
  const pilot = await getActivePilot();
  if (!pilot || pilot.id !== pilotId) return { ok: false, reason: 'pilot not found' };

  const risk = await checkRisk({
    pilot,
    action:         'reduce',
    marketId:       pos.market_id,
    domain:         pos.domain,
    proposedSize:   desiredSell,
    existingPos:    pos,
    isSystemAction: source === 'system',
  });
  if (!risk.approved) return { ok: false, reason: risk.denial_reason ?? 'risk denied' };

  const sellSize    = Math.min(risk.approved_size, Number(pos.size_usd));
  const fraction    = sellSize / Number(pos.size_usd);
  const fill        = simulateClose(sellSize, pos, fraction);
  const newSize     = Number(pos.size_usd) - sellSize;
  const newBasis    = Number(pos.cost_basis_usd) * (1 - fraction);

  if (newSize < 1) {
    // Effectively a close
    return closePosition(pilotId, pos, marketPrice, edge, conviction, disagreement, roundId, reason, source);
  }

  await patchPosition(pos.id, {
    size_usd:             newSize,
    desired_size_usd:     newSize,
    cost_basis_usd:       newBasis,
    conviction,
    disagreement,
    last_signal_refresh:  new Date().toISOString(),
    adjustment_count:     Number(pos.adjustment_count) + 1,
    realized_pnl:         Number(pos.realized_pnl) + fill.realized_pnl,
  });
  await creditCash(pilotId, fill.net_cost, fill.realized_pnl, sellSize);
  await logAdjustment({
    positionId:   pos.id,
    pilotId,
    marketId:     pos.market_id,
    action:       'reduce',
    sizeBefore:   Number(pos.size_usd),
    sizeAfter:    newSize,
    deltaUsd:     -sellSize,
    marketPrice,
    edge,
    conviction,
    disagreement,
    fill,
    source,
    reason,
    operatorNote: null,
    roundId,
  });

  console.log(`[V2/POS] Reduced ${pos.market_id} by $${sellSize} → $${newSize} remaining`);
  return { ok: true };
}

// ── Close ─────────────────────────────────────────────────────────────────────

export async function closePosition(
  pilotId:     string,
  pos:         V2Position,
  marketPrice: number,
  edge:        number,
  conviction:  number,
  disagreement: number,
  roundId:     string | null,
  closeReason: string,
  source:      'system' | 'operator' | 'risk_engine' | 'expiry' = 'system',
): Promise<{ ok: boolean; reason?: string }> {
  const pilot = await getActivePilot();
  if (!pilot || pilot.id !== pilotId) return { ok: false, reason: 'pilot not found' };

  const sellSize = Number(pos.size_usd);
  const fill     = simulateClose(sellSize, pos, 1.0);

  await patchPosition(pos.id, {
    status:               'closed',
    size_usd:             0,
    cost_basis_usd:       0,
    conviction,
    disagreement,
    last_signal_refresh:  new Date().toISOString(),
    adjustment_count:     Number(pos.adjustment_count) + 1,
    realized_pnl:         Number(pos.realized_pnl) + fill.realized_pnl,
    closed_at:            new Date().toISOString(),
    close_reason:         closeReason,
    // Start cooldown (stored on position for reference)
    cooldown_until:       new Date(Date.now() + 4 * 3_600_000).toISOString(),
  });
  await creditCash(pilotId, fill.net_cost, fill.realized_pnl, sellSize);
  await logAdjustment({
    positionId:   pos.id,
    pilotId,
    marketId:     pos.market_id,
    action:       'close',
    sizeBefore:   sellSize,
    sizeAfter:    0,
    deltaUsd:     -sellSize,
    marketPrice,
    edge,
    conviction,
    disagreement,
    fill,
    source,
    reason:       closeReason,
    operatorNote: null,
    roundId,
  });

  console.log(`[V2/POS] Closed ${pos.market_id} $${sellSize} pnl=${fill.realized_pnl.toFixed(2)} reason: ${closeReason}`);
  return { ok: true };
}

// ── Reverse ───────────────────────────────────────────────────────────────────

export async function reversePosition(
  pilotId:     string,
  pos:         V2Position,
  newSide:     'yes' | 'no',
  desiredSize: number,
  marketPrice: number,
  edge:        number,
  conviction:  number,
  disagreement: number,
  roundId:     string | null,
): Promise<{ ok: boolean; reason?: string }> {
  // Step 1: close existing
  const closeResult = await closePosition(
    pilotId, pos, marketPrice, edge, conviction, disagreement,
    roundId, `reversing to ${newSide}`, 'system',
  );
  if (!closeResult.ok) return closeResult;

  // Step 2: open new
  return openPosition({
    pilotId,
    marketId:    pos.market_id,
    domain:      pos.domain,
    side:        newSide,
    desiredSize,
    marketPrice,
    edge,
    conviction,
    disagreement,
    roundId,
    thesis:      null,
  });
}

// ── MTM update ────────────────────────────────────────────────────────────────

/** Update current_price and unrealized_pnl for an open position. */
export async function markToMarket(
  pos:          V2Position,
  currentPrice: number,
): Promise<void> {
  // P&L = (current_price − avg_cost) / avg_cost × cost_basis
  // Simplified for prediction markets: (current_price − avg_cost) × shares
  // shares = cost_basis / avg_cost (approx)
  const avgCost    = Number(pos.avg_cost ?? pos.entry_price);
  const costBasis  = Number(pos.cost_basis_usd);
  const shares     = avgCost > 0 ? costBasis / avgCost : 0;
  const direction  = pos.side === 'yes' ? 1 : -1;
  const unrealized = direction * (currentPrice - avgCost) * shares;

  await patchPosition(pos.id, {
    current_price:  currentPrice,
    unrealized_pnl: unrealized,
  });
}

// ── Process round signal ──────────────────────────────────────────────────────

/**
 * Top-level entry called from the daily-cycle after each round produces an
 * AggregatedDecision. Runs the desired-exposure → risk → execute pipeline.
 */
export async function processRoundSignal(opts: {
  pilotId:         string;
  marketId:        string;
  domain:          string | null;
  decision:        AggregatedDecision;
  roundId:         string;
  freshnessHours:  number | null;
  resolvesAt:      string | null;   // ISO timestamp or null
}): Promise<void> {
  const { pilotId, marketId, domain, decision, roundId, freshnessHours, resolvesAt } = opts;

  const pilot = await getActivePilot();
  if (!pilot || pilot.id !== pilotId) return;

  const bankroll = Number(pilot.initial_bankroll_usd);

  const conviction  = computeConviction(decision.aggregatedEdge, decision.disagreement, freshnessHours);
  const currentPos  = await getOpenPosition(pilotId, marketId);

  // Check expiry caution
  const inExpiryCaution = resolvesAt != null
    ? (new Date(resolvesAt).getTime() - Date.now()) < V2_EXPIRY_CAUTION_H * 3_600_000
    : false;

  const desired = computeDesiredExposure({
    edge:            decision.aggregatedEdge,
    disagreement:    decision.disagreement,
    conviction,
    domain,
    bankroll,
    currentPos,
    inExpiryCaution,
  });

  console.log(`[V2/POS] ${marketId} → ${desired.action} (${desired.reason})`);

  const mp = decision.marketPrice;

  switch (desired.action) {
    case 'flat':
    case 'hold':
      // Nothing to do
      if (currentPos) {
        await patchPosition(currentPos.id, {
          conviction,
          disagreement:        decision.disagreement,
          last_signal_refresh: new Date().toISOString(),
        });
      }
      break;

    case 'open':
      if (desired.side) {
        await openPosition({
          pilotId, marketId, domain,
          side:        desired.side,
          desiredSize: desired.desired_size,
          marketPrice: mp,
          edge:        decision.aggregatedEdge,
          conviction,
          disagreement: decision.disagreement,
          roundId,
          thesis:      desired.reason,
        });
      }
      break;

    case 'add':
      if (currentPos) {
        await addToPosition(
          pilotId, currentPos, desired.desired_size,
          mp, decision.aggregatedEdge, conviction, decision.disagreement, roundId,
        );
      }
      break;

    case 'reduce':
      if (currentPos) {
        await reducePosition(
          pilotId, currentPos, desired.desired_size,
          mp, decision.aggregatedEdge, conviction, decision.disagreement,
          roundId, desired.reason, 'system',
        );
      }
      break;

    case 'close':
      if (currentPos) {
        await closePosition(
          pilotId, currentPos,
          mp, decision.aggregatedEdge, conviction, decision.disagreement,
          roundId, desired.reason, 'system',
        );
      }
      break;

    case 'reverse':
      if (currentPos && desired.side) {
        await reversePosition(
          pilotId, currentPos, desired.side, desired.desired_size,
          mp, decision.aggregatedEdge, conviction, decision.disagreement, roundId,
        );
      }
      break;
  }
}
