/**
 * Forecast Arena — Live Position Management
 *
 * A position is opened when an agent's forecast diverges enough from the
 * market price to represent a tradeable edge. The position is then managed
 * tick-by-tick until it is closed.
 *
 * P&L model (prediction market contracts):
 *   LONG  YES: buy (size_usd / entry_price) YES contracts at entry_price
 *              unrealized_pnl = contracts * (current_price - avg_entry_price)
 *   SHORT YES (LONG NO): buy (size_usd / (1-entry_price)) NO contracts
 *              unrealized_pnl = contracts * ((1-current_price) - (1-avg_entry_price))
 *                             = contracts * (avg_entry_price - current_price)
 *
 * Management rules (first version — simple but live):
 *   scale_in   : edge still >8% AND no prior scale-in AND tick ≤3 → add 50%
 *   scale_out  : unrealized gain >+15% AND no prior scale-out → trim 50%
 *   stop_loss  : unrealized loss <-20%                         → close fully
 *   expiry_exit: market closes within 24 h                     → close fully
 *   hold       : otherwise
 */

import { faInsert, faSelect, faPatch, faUpsert } from './db';
import { fetchMarketById } from './polymarket';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PositionRow {
  id:               string;
  agent_id:         string;
  market_id:        string;
  round_id?:        string;
  submission_id?:   string;
  status:           'open' | 'closed';
  side:             'long' | 'short';
  size_usd:         number;
  cost_basis_usd:   number;
  contracts:        number;
  avg_entry_price:  number;
  open_price:       number;
  current_price?:   number;
  unrealized_pnl:   number;
  realized_pnl:     number;
  scale_in_count:   number;
  scale_out_count:  number;
  tick_count:       number;
  last_action?:     string;
  last_tick_at?:    string;
  opened_at:        string;
  closed_at?:       string;
}

export type TickAction =
  | 'hold'
  | 'scale_in'
  | 'scale_out'
  | 'stop_loss'
  | 'expiry_exit'
  | 'close';

export interface TickResult {
  positionId:    string;
  agentSlug:     string;
  marketTitle:   string;
  action:        TickAction;
  priceAtTick:   number;
  unrealizedPnl: number;
  realizedPnl:   number;
  sizeDelta?:    number;
  notes:         string;
}

// ── P&L helpers ───────────────────────────────────────────────────────────────

export function computeUnrealizedPnl(
  side:           'long' | 'short',
  contracts:      number,
  avgEntryPrice:  number,
  currentPrice:   number,
): number {
  if (side === 'long') {
    // Long YES: each contract moves $1 per unit price change
    return contracts * (currentPrice - avgEntryPrice);
  } else {
    // Short YES (long NO): contracts = size_usd / (1 - entry_price)
    // value changes inversely with YES price
    return contracts * (avgEntryPrice - currentPrice);
  }
}

export function currentPositionValue(
  side:          'long' | 'short',
  contracts:     number,
  currentPrice:  number,
): number {
  if (side === 'long') return contracts * currentPrice;
  return contracts * (1 - currentPrice);
}

// ── Edge detection (should we open a position?) ───────────────────────────────

const MIN_EDGE_TO_OPEN    = 0.05;   // 5% probability edge (temporarily lowered for testing)
const POSITION_SIZE_PCT   = 0.02;   // 2% of wallet per position
const MAX_POSITION_USD    = 200;    // hard cap per position
const MIN_POSITION_USD    = 5;      // don't open below this

export interface OpenPositionArgs {
  agentId:        string;
  agentSlug:      string;
  marketId:       string;
  roundId?:       string;
  submissionId?:  string;
  agentProbYes:   number;   // agent's forecast
  marketPrice:    number;   // current Polymarket price
  walletBalance:  number;   // current paper wallet balance
}

/**
 * Decide whether to open a position, and if so, which side and size.
 * Returns null if no edge is detected.
 */
export function shouldOpenPosition(args: OpenPositionArgs): {
  side:    'long' | 'short';
  sizeUsd: number;
  edge:    number;
} | null {
  const { agentProbYes, marketPrice, walletBalance } = args;
  const edge = agentProbYes - marketPrice;

  if (Math.abs(edge) < MIN_EDGE_TO_OPEN) return null;

  const side: 'long' | 'short' = edge > 0 ? 'long' : 'short';
  const rawSize = walletBalance * POSITION_SIZE_PCT;
  const sizeUsd = Math.min(rawSize, MAX_POSITION_USD);

  if (sizeUsd < MIN_POSITION_USD) return null;

  return { side, sizeUsd, edge: Math.abs(edge) };
}

/**
 * Open a new position in the DB and record the entry transaction.
 * Returns the created position ID, or null on failure.
 */
export async function openPosition(args: OpenPositionArgs): Promise<string | null> {
  const decision = shouldOpenPosition(args);
  if (!decision) return null;

  const { agentId, agentSlug, marketId, roundId, submissionId } = args;
  const { side, sizeUsd, edge } = decision;
  const entryPrice = args.marketPrice;

  // contracts: for long, buy YES contracts at entryPrice
  //            for short, buy NO contracts at (1 - entryPrice)
  const contractPrice = side === 'long' ? entryPrice : (1 - entryPrice);
  if (contractPrice <= 0) return null;
  const contracts = sizeUsd / contractPrice;

  const rows = await faInsert('fa_positions', [{
    agent_id:        agentId,
    market_id:       marketId,
    round_id:        roundId ?? null,
    submission_id:   submissionId ?? null,
    status:          'open',
    side,
    size_usd:        sizeUsd,
    cost_basis_usd:  sizeUsd,
    contracts,
    avg_entry_price: entryPrice,
    open_price:      entryPrice,
    current_price:   entryPrice,
    unrealized_pnl:  0,
    realized_pnl:    0,
  }], { returning: true });

  if (!Array.isArray(rows) || !rows[0]) return null;
  const positionId = (rows[0] as any).id as string;

  // Entry transaction
  await faInsert('fa_transactions', [{
    agent_id:              agentId,
    submission_id:         submissionId ?? null,
    round_id:              roundId ?? null,
    position_id:           positionId,
    type:                  'open_position',
    side:                  side === 'long' ? 'yes' : 'no',
    market_price_at_entry: entryPrice,
    paper_size_usd:        sizeUsd,
    notional_usd:          sizeUsd,
    outcome:               null,
    pnl_usd:               null,
  }]);

  // Deduct from wallet
  const wallets = await faSelect<{ id: string; paper_balance_usd: number }>(
    'fa_agent_wallets', `agent_id=eq.${agentId}&select=id,paper_balance_usd`,
  );
  if (wallets.length > 0) {
    const newBalance = Number(wallets[0].paper_balance_usd) - sizeUsd;
    await faPatch('fa_agent_wallets', { id: wallets[0].id }, {
      paper_balance_usd:  newBalance,
      total_notional_usd: String(Number(wallets[0] as any) + sizeUsd),
      updated_at:         new Date().toISOString(),
    });
  }

  await faInsert('fa_audit_events', [{
    event_type:   'position_opened',
    entity_type:  'position',
    entity_id:    positionId,
    actor:        agentSlug,
    payload_json: { side, size_usd: sizeUsd, entry_price: entryPrice, edge, contracts },
  }]);

  console.log(`[FA/POS] ${agentSlug} opened ${side} $${sizeUsd.toFixed(2)} ` +
    `at ${(entryPrice*100).toFixed(1)}% (edge ${(edge*100).toFixed(1)}%) → pos ${positionId}`);

  return positionId;
}

// ── Management rules ──────────────────────────────────────────────────────────

const SCALE_OUT_GAIN_THRESHOLD = 0.15;   // +15% unrealized gain → take 50% off
const STOP_LOSS_THRESHOLD      = -0.20;  // -20% unrealized loss → close
const SCALE_IN_EDGE_THRESHOLD  = 0.08;   // still 8% edge vs avg entry → add more
const SCALE_IN_MAX_TICKS       = 3;      // only consider scale-in within first 3 ticks
const EXPIRY_EXIT_HOURS        = 24;     // exit if market closes within 24h

export function decideTickAction(
  pos:          PositionRow,
  currentPrice: number,
  closeTime:    Date | null,
): TickAction {
  const unrealizedPnl = computeUnrealizedPnl(
    pos.side, pos.contracts, pos.avg_entry_price, currentPrice,
  );
  const unrealizedPct = pos.cost_basis_usd > 0
    ? unrealizedPnl / pos.cost_basis_usd
    : 0;

  // 1. Expiry exit
  if (closeTime && closeTime.getTime() - Date.now() < EXPIRY_EXIT_HOURS * 3_600_000) {
    return 'expiry_exit';
  }

  // 2. Stop-loss
  if (unrealizedPct < STOP_LOSS_THRESHOLD) return 'stop_loss';

  // 3. Scale-out (take profit)
  if (unrealizedPct > SCALE_OUT_GAIN_THRESHOLD && pos.scale_out_count === 0) {
    return 'scale_out';
  }

  // 4. Scale-in (add to winning edge)
  if (pos.scale_in_count === 0 && pos.tick_count <= SCALE_IN_MAX_TICKS) {
    const stillHasEdge = pos.side === 'long'
      ? currentPrice - pos.avg_entry_price > -SCALE_IN_EDGE_THRESHOLD  // price hasn't moved against us by >8%
      : pos.avg_entry_price - currentPrice > -SCALE_IN_EDGE_THRESHOLD;
    if (stillHasEdge) return 'scale_in';
  }

  return 'hold';
}

// ── Tick execution ────────────────────────────────────────────────────────────

/**
 * Execute one tick for a single position.
 * Fetches current market price, runs management rules, writes DB updates.
 */
export async function tickPosition(
  pos:         PositionRow,
  agentSlug:   string,
  marketTitle: string,
  closeTime:   Date | null,
  externalId:  string,
): Promise<TickResult> {
  // 1. Fetch latest price from Polymarket
  let currentPrice: number;
  try {
    const mkt = await fetchMarketById(externalId);
    // outcomePrices may be a JSON-encoded string from the Polymarket gamma API
    let prices = (mkt as any).outcomePrices ?? (mkt as any).outcome_prices ?? null;
    if (typeof prices === 'string') {
      try { prices = JSON.parse(prices); } catch { prices = null; }
    }
    const priceStr = Array.isArray(prices) && prices.length > 0 ? prices[0] : null;
    const parsed = priceStr != null ? parseFloat(priceStr) : NaN;
    currentPrice = !isNaN(parsed) ? parsed : (pos.current_price ?? pos.avg_entry_price);
  } catch {
    currentPrice = pos.current_price ?? pos.avg_entry_price;
  }

  const newUnrealized = computeUnrealizedPnl(
    pos.side, pos.contracts, pos.avg_entry_price, currentPrice,
  );

  const action = decideTickAction(pos, currentPrice, closeTime);
  const tickNumber = pos.tick_count + 1;

  let sizeDelta:    number | undefined;
  let newRealizedPnl = pos.realized_pnl;
  let newContracts   = pos.contracts;
  let newSizeUsd     = pos.size_usd;
  let newCostBasis   = pos.cost_basis_usd;
  let newAvgEntry    = pos.avg_entry_price;
  let newStatus      = pos.status as 'open' | 'closed';
  let newScaleIn     = pos.scale_in_count;
  let newScaleOut    = pos.scale_out_count;
  let notes          = '';

  if (action === 'scale_in') {
    // Add 50% of original size
    const addUsd         = pos.cost_basis_usd * 0.5;
    const contractPrice  = pos.side === 'long' ? currentPrice : (1 - currentPrice);
    if (contractPrice > 0) {
      const addContracts = addUsd / contractPrice;
      // Update average entry price
      const totalCost    = pos.cost_basis_usd + addUsd;
      const totalContr   = pos.contracts + addContracts;
      newAvgEntry        = totalCost / totalContr;
      newContracts       = totalContr;
      newSizeUsd         = newSizeUsd + addUsd;
      newCostBasis       = totalCost;
      newScaleIn         = pos.scale_in_count + 1;
      sizeDelta          = addUsd;
      notes              = `Scale-in +$${addUsd.toFixed(2)} at ${(currentPrice*100).toFixed(1)}%`;

      await faInsert('fa_transactions', [{
        agent_id:              pos.agent_id,
        position_id:           pos.id,
        type:                  'scale_in',
        side:                  pos.side === 'long' ? 'yes' : 'no',
        market_price_at_entry: currentPrice,
        paper_size_usd:        addUsd,
        notional_usd:          addUsd,
        pnl_usd:               null,
      }]);
    }

  } else if (action === 'scale_out') {
    // Trim 50% — realize gains on the trimmed portion
    const trimFraction  = 0.5;
    const trimContracts = pos.contracts * trimFraction;
    const trimValue     = currentPositionValue(pos.side, trimContracts, currentPrice);
    const trimCost      = pos.cost_basis_usd * trimFraction;
    const trimPnl       = trimValue - trimCost;

    newContracts   = pos.contracts * (1 - trimFraction);
    newSizeUsd     = currentPositionValue(pos.side, newContracts, currentPrice);
    newCostBasis   = pos.cost_basis_usd * (1 - trimFraction);
    newRealizedPnl = pos.realized_pnl + trimPnl;
    newScaleOut    = pos.scale_out_count + 1;
    sizeDelta      = -trimCost;
    notes          = `Scale-out 50% at ${(currentPrice*100).toFixed(1)}%, realized PnL $${trimPnl.toFixed(2)}`;

    await faInsert('fa_transactions', [{
      agent_id:              pos.agent_id,
      position_id:           pos.id,
      type:                  'scale_out',
      side:                  pos.side === 'long' ? 'yes' : 'no',
      market_price_at_entry: currentPrice,
      paper_size_usd:        trimValue,
      notional_usd:          trimCost,
      outcome:               'partial_exit',
      pnl_usd:               trimPnl,
    }]);

  } else if (action === 'stop_loss' || action === 'expiry_exit' || action === 'close') {
    // Close fully
    const closingValue = currentPositionValue(pos.side, pos.contracts, currentPrice);
    const closingPnl   = closingValue - pos.cost_basis_usd;

    newRealizedPnl = pos.realized_pnl + closingPnl;
    newContracts   = 0;
    newSizeUsd     = 0;
    newStatus      = 'closed';
    sizeDelta      = -pos.cost_basis_usd;
    notes          = `${action} at ${(currentPrice*100).toFixed(1)}%, total PnL $${(pos.realized_pnl + closingPnl).toFixed(2)}`;

    await faInsert('fa_transactions', [{
      agent_id:              pos.agent_id,
      position_id:           pos.id,
      type:                  action,
      side:                  pos.side === 'long' ? 'yes' : 'no',
      market_price_at_entry: currentPrice,
      paper_size_usd:        closingValue,
      notional_usd:          pos.cost_basis_usd,
      outcome:               closingPnl >= 0 ? 'win' : 'loss',
      pnl_usd:               pos.realized_pnl + closingPnl,
    }]);

    // Return funds to wallet
    const wallets = await faSelect<{ id: string; paper_balance_usd: number }>(
      'fa_agent_wallets', `agent_id=eq.${pos.agent_id}&select=id,paper_balance_usd`,
    );
    if (wallets.length > 0) {
      const returnAmount = pos.cost_basis_usd + closingPnl; // cost + any gain
      const newBalance = Math.max(0, Number(wallets[0].paper_balance_usd) + returnAmount);
      await faPatch('fa_agent_wallets', { id: wallets[0].id }, {
        paper_balance_usd: newBalance,
        updated_at:        new Date().toISOString(),
      });
    }

  } else {
    // hold
    notes = `Hold at ${(currentPrice*100).toFixed(1)}%, unrealized ${newUnrealized >= 0 ? '+' : ''}$${newUnrealized.toFixed(2)}`;
  }

  // Update position row
  const posUpdate: Record<string, unknown> = {
    current_price:  currentPrice,
    unrealized_pnl: action === 'stop_loss' || action === 'expiry_exit' || action === 'close'
      ? 0 : newUnrealized,
    realized_pnl:   newRealizedPnl,
    size_usd:       newSizeUsd,
    cost_basis_usd: newCostBasis,
    contracts:      newContracts,
    avg_entry_price: newAvgEntry,
    scale_in_count:  newScaleIn,
    scale_out_count: newScaleOut,
    tick_count:     tickNumber,
    last_action:    action,
    last_tick_at:   new Date().toISOString(),
    updated_at:     new Date().toISOString(),
    status:         newStatus,
    ...(newStatus === 'closed' ? { closed_at: new Date().toISOString() } : {}),
  };

  await faPatch('fa_positions', { id: pos.id }, posUpdate);

  // Record tick in audit table
  await faInsert('fa_position_ticks', [{
    position_id:   pos.id,
    agent_id:      pos.agent_id,
    market_id:     pos.market_id,
    tick_number:   tickNumber,
    market_price:  currentPrice,
    action,
    size_delta_usd: sizeDelta ?? null,
    unrealized_pnl: action === 'hold' || action === 'scale_in' || action === 'scale_out'
      ? newUnrealized : 0,
    realized_pnl:  newRealizedPnl,
    notes,
  }]);

  const finalUnrealized = newStatus === 'closed' ? 0 : newUnrealized;

  console.log(`[FA/TICK] ${agentSlug} pos=${pos.id.slice(0, 8)} ` +
    `action=${action} price=${(currentPrice*100).toFixed(1)}% ` +
    `unrealized=${finalUnrealized >= 0 ? '+' : ''}$${finalUnrealized.toFixed(2)}`);

  return {
    positionId:    pos.id,
    agentSlug,
    marketTitle,
    action,
    priceAtTick:   currentPrice,
    unrealizedPnl: finalUnrealized,
    realizedPnl:   newRealizedPnl,
    sizeDelta,
    notes,
  };
}

// ── Batch tick runner ─────────────────────────────────────────────────────────

export interface BatchTickResult {
  processed: number;
  results:   TickResult[];
  errors:    string[];
}

/**
 * Run one tick cycle for every open position.
 * Called by the /api/forecast/tick endpoint (cron + manual).
 */
export async function runTickCycle(): Promise<BatchTickResult> {
  const result: BatchTickResult = { processed: 0, results: [], errors: [] };

  // Load all open positions with market + agent context
  const positions = await faSelect<PositionRow & {
    market_external_id: string;
    market_title: string;
    market_close_time: string | null;
    agent_slug: string;
  }>('fa_positions', 'status=eq.open&select=*');

  if (!Array.isArray(positions) || positions.length === 0) {
    console.log('[FA/TICK] No open positions to process');
    return result;
  }

  // Enrich with market and agent info
  const marketIds = [...new Set(positions.map(p => p.market_id))];
  const agentIds  = [...new Set(positions.map(p => p.agent_id))];

  const [markets, agents] = await Promise.all([
    faSelect<{ id: string; external_id: string; title: string; close_time: string | null }>(
      'fa_markets',
      `id=in.(${marketIds.join(',')})&select=id,external_id,title,close_time`,
    ),
    faSelect<{ id: string; slug: string }>(
      'fa_agents',
      `id=in.(${agentIds.join(',')})&select=id,slug`,
    ),
  ]);

  const marketMap = new Map(markets.map(m => [m.id, m]));
  const agentMap  = new Map(agents.map(a => [a.id, a]));

  console.log(`[FA/TICK] Processing ${positions.length} open positions`);

  for (const pos of positions) {
    try {
      const market = marketMap.get(pos.market_id);
      const agent  = agentMap.get(pos.agent_id);

      if (!market || !agent) {
        result.errors.push(`Missing market/agent for position ${pos.id}`);
        continue;
      }

      const closeTime = market.close_time ? new Date(market.close_time) : null;
      const tickResult = await tickPosition(
        pos,
        agent.slug,
        market.title,
        closeTime,
        market.external_id,
      );

      result.results.push(tickResult);
      result.processed++;
    } catch (err: any) {
      const msg = `Position ${pos.id}: ${err?.message ?? err}`;
      result.errors.push(msg);
      console.error(`[FA/TICK] Error: ${msg}`);
    }
  }

  // Audit the batch
  await faInsert('fa_audit_events', [{
    event_type:   'tick_cycle',
    entity_type:  'system',
    entity_id:    null,
    actor:        'cron',
    payload_json: {
      processed: result.processed,
      errors:    result.errors.length,
      actions:   result.results.reduce((acc: Record<string, number>, r) => {
        acc[r.action] = (acc[r.action] ?? 0) + 1;
        return acc;
      }, {}),
    },
  }]);

  console.log(`[FA/TICK] Cycle complete: ${result.processed} processed, ${result.errors.length} errors`);
  return result;
}
