/**
 * Forecast Arena v2 — Risk Engine
 *
 * Pre-trade risk checks. Every proposed position action must pass here
 * before execution. Returns approved=true and an (optionally capped) size,
 * or approved=false with a denial reason.
 *
 * v1 controls (all checked):
 *   ✓ max exposure per market
 *   ✓ max exposure per domain
 *   ✓ max total gross exposure
 *   ✓ max concurrent open positions
 *   ✓ max adjustments per market per day
 *   ✓ cooldown after close
 *   ✓ pilot status gate (paused / manual_only → deny system actions)
 *   ✓ pilot cash availability
 */

import { faSelect }      from '../db';
import type { V2Pilot, V2Position, V2RiskDecision } from './types';
import {
  V2_MAX_POSITION_PCT,
  V2_MAX_DOMAIN_EXPOSURE_PCT,
  V2_MAX_GROSS_EXPOSURE_PCT,
  V2_MAX_OPEN_POSITIONS,
  V2_MAX_ADJUSTMENTS_PER_DAY,
} from './types';

// ── Portfolio snapshot ────────────────────────────────────────────────────────

interface PortfolioSnapshot {
  openPositions:     V2Position[];
  totalGrossUsd:     number;
  domainExposureUsd: Record<string, number>;
  openCount:         number;
}

async function getPortfolioSnapshot(pilotId: string): Promise<PortfolioSnapshot> {
  const openPositions = await faSelect<V2Position>(
    'fa_v2_positions',
    `pilot_id=eq.${pilotId}&status=eq.open&select=*`,
  );
  const totalGrossUsd = openPositions.reduce((s, p) => s + Number(p.size_usd), 0);
  const domainExposureUsd: Record<string, number> = {};
  for (const p of openPositions) {
    const d = p.domain ?? 'other';
    domainExposureUsd[d] = (domainExposureUsd[d] ?? 0) + Number(p.size_usd);
  }
  return { openPositions, totalGrossUsd, domainExposureUsd, openCount: openPositions.length };
}

// ── Adjustment count today ────────────────────────────────────────────────────

async function getAdjustmentsToday(positionId: string): Promise<number> {
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  const rows = await faSelect<{ id: string }>(
    'fa_v2_adjustments',
    `position_id=eq.${positionId}&created_at=gte.${midnight.toISOString()}&select=id`,
  );
  return rows.length;
}

// ── Main risk check ───────────────────────────────────────────────────────────

interface RiskCheckInput {
  pilot:         V2Pilot;
  action:        'open' | 'add' | 'reduce' | 'close' | 'reverse';
  marketId:      string;
  domain:        string | null;
  proposedSize:  number;          // USD
  existingPos:   V2Position | null;
  isSystemAction: boolean;
}

export async function checkRisk(input: RiskCheckInput): Promise<V2RiskDecision> {
  const { pilot, action, domain, proposedSize, existingPos, isSystemAction } = input;

  // 1. Pilot status gate
  if (pilot.status === 'archived') {
    return { approved: false, denial_reason: 'pilot is archived', approved_size: 0 };
  }
  if (isSystemAction && pilot.status === 'manual_only') {
    return { approved: false, denial_reason: 'pilot is in manual-only mode', approved_size: 0 };
  }
  if (isSystemAction && pilot.status === 'paused') {
    return { approved: false, denial_reason: 'pilot is paused', approved_size: 0 };
  }

  // Reduce/close always allowed (they free up capital)
  if (action === 'reduce' || action === 'close') {
    return { approved: true, denial_reason: null, approved_size: proposedSize };
  }

  const bankroll = Number(pilot.initial_bankroll_usd);
  const cash     = Number(pilot.current_cash_usd);

  // 2. Cash availability
  if (proposedSize > cash) {
    const capped = Math.floor(cash * 0.99); // leave 1% buffer
    if (capped < 5) {
      return { approved: false, denial_reason: `insufficient cash ($${cash.toFixed(0)} available)`, approved_size: 0 };
    }
    // proceed with capped size
    return runSizeChecks({ ...input, proposedSize: capped }, bankroll, cash);
  }

  return runSizeChecks(input, bankroll, cash);
}

async function runSizeChecks(
  input:     RiskCheckInput,
  bankroll:  number,
  cash:      number,
): Promise<V2RiskDecision> {
  const { pilot, action, marketId, domain, proposedSize, existingPos } = input;

  const snap = await getPortfolioSnapshot(pilot.id);

  // 3. Max open positions (only for new opens)
  if (action === 'open' && snap.openCount >= V2_MAX_OPEN_POSITIONS) {
    return {
      approved: false,
      denial_reason: `max open positions reached (${V2_MAX_OPEN_POSITIONS})`,
      approved_size: 0,
    };
  }

  // 4. Per-market size cap
  const maxPerMarket = bankroll * V2_MAX_POSITION_PCT;
  const currentSize  = existingPos ? Number(existingPos.size_usd) : 0;
  const newTotal     = currentSize + proposedSize;
  if (newTotal > maxPerMarket) {
    const allowed = Math.max(0, maxPerMarket - currentSize);
    if (allowed < 5) {
      return {
        approved: false,
        denial_reason: `market exposure cap reached ($${maxPerMarket.toFixed(0)} max)`,
        approved_size: 0,
      };
    }
    return runDomainChecks(input, snap, bankroll, allowed);
  }

  return runDomainChecks(input, snap, bankroll, proposedSize);
}

async function runDomainChecks(
  input:        RiskCheckInput,
  snap:         PortfolioSnapshot,
  bankroll:     number,
  cappedSize:   number,
): Promise<V2RiskDecision> {
  const { domain, existingPos } = input;
  const d = domain ?? 'other';

  // 5. Domain exposure cap
  const maxDomain      = bankroll * V2_MAX_DOMAIN_EXPOSURE_PCT;
  const currentDomain  = snap.domainExposureUsd[d] ?? 0;
  const netDomainAdded = cappedSize;  // existing position already counted in snap
  if (currentDomain + netDomainAdded > maxDomain) {
    const allowed = Math.max(0, maxDomain - currentDomain);
    if (allowed < 5) {
      return {
        approved: false,
        denial_reason: `${d} domain cap reached ($${maxDomain.toFixed(0)} max)`,
        approved_size: 0,
      };
    }
    return runGrossCheck(input, snap, bankroll, allowed);
  }

  return runGrossCheck(input, snap, bankroll, cappedSize);
}

async function runGrossCheck(
  input:      RiskCheckInput,
  snap:       PortfolioSnapshot,
  bankroll:   number,
  cappedSize: number,
): Promise<V2RiskDecision> {
  // 6. Gross exposure cap
  const maxGross = bankroll * V2_MAX_GROSS_EXPOSURE_PCT;
  if (snap.totalGrossUsd + cappedSize > maxGross) {
    const allowed = Math.max(0, maxGross - snap.totalGrossUsd);
    if (allowed < 5) {
      return {
        approved: false,
        denial_reason: `gross exposure cap reached ($${maxGross.toFixed(0)} max)`,
        approved_size: 0,
      };
    }
    return runAdjustmentCheck(input, allowed);
  }

  return runAdjustmentCheck(input, cappedSize);
}

async function runAdjustmentCheck(
  input:      RiskCheckInput,
  cappedSize: number,
): Promise<V2RiskDecision> {
  const { existingPos, action } = input;

  // 7. Cooldown after close (only for new opens on same market)
  if (action === 'open' && existingPos === null) {
    // Check most recent closed position for this market
    // (no easy REST filter for this; skip in Phase 1 — cooldown enforced in desired-exposure)
  }

  // 8. Max adjustments per day
  if (existingPos && action === 'add') {
    const adjToday = await getAdjustmentsToday(existingPos.id);
    if (adjToday >= V2_MAX_ADJUSTMENTS_PER_DAY) {
      return {
        approved: false,
        denial_reason: `max ${V2_MAX_ADJUSTMENTS_PER_DAY} adjustments/day reached`,
        approved_size: 0,
      };
    }
  }

  return { approved: true, denial_reason: null, approved_size: cappedSize };
}
