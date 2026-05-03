/**
 * Forecast Arena v2 — Desired-Exposure Model
 *
 * Given a fresh signal and the current position (if any), decide what action
 * the system WANTS to take. Risk checks happen downstream; this module only
 * computes intent.
 *
 * Decision tree:
 *
 *   No existing position
 *     ├─ edge < MIN_ENTRY_EDGE[domain]          → flat
 *     ├─ disagreement > MAX_DISAGREEMENT_OPEN   → flat (too noisy)
 *     ├─ conviction < 0.40                      → flat (weak signal)
 *     └─ else                                   → open (side = edge direction)
 *
 *   Existing open position, same direction
 *     ├─ disagreement > CLOSE_DISAGREEMENT      → close (chaos)
 *     ├─ disagreement > REDUCE_DISAGREEMENT     → reduce (caution)
 *     ├─ |edge| < REDUCE_EDGE_THRESHOLD         → reduce (signal fading)
 *     ├─ conviction >= 0.65 AND size < max      → add (high conviction top-up)
 *     └─ else                                   → hold
 *
 *   Existing open position, opposite direction
 *     ├─ |edge| < REVERSAL_EDGE * MIN_ENTRY     → reduce (not strong enough)
 *     └─ else                                   → reverse (flip)
 *
 *   Expiry caution window (resolves within 24 h)
 *     Override: if position exists → close regardless of signal
 *
 * Sizing:
 *   open  → V2_BASE_POSITION_PCT × bankroll  (risk engine may cap)
 *   add   → 25% of current size (incremental top-up)
 *   reduce→ 50% of current size
 *   close → full current size
 *   reverse → reverse-size = open-size (risk engine rechecks)
 */

import type { V2Position, V2DesiredExposure, V2DesiredAction } from './types';
import {
  V2_MIN_ENTRY_EDGE,
  V2_BASE_POSITION_PCT,
  V2_MAX_DISAGREEMENT_OPEN,
  V2_REDUCE_EDGE_THRESHOLD,
  V2_REDUCE_DISAGREEMENT,
  V2_CLOSE_DISAGREEMENT,
  V2_REVERSAL_EDGE_MULTIPLIER,
} from './types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function minEntryEdge(domain: string | null): number {
  return V2_MIN_ENTRY_EDGE[domain ?? 'other'] ?? V2_MIN_ENTRY_EDGE['other'];
}

function signalSide(edge: number): 'yes' | 'no' {
  return edge > 0 ? 'yes' : 'no';
}

// ── Main function ─────────────────────────────────────────────────────────────

export interface DesiredExposureInput {
  edge:           number;   // aggregated_p − market_price
  disagreement:   number;   // weighted stddev of model probs
  conviction:     number;   // 0–1 from computeConviction()
  domain:         string | null;
  bankroll:       number;   // pilot initial_bankroll_usd (for sizing)
  currentPos:     V2Position | null;
  /** If true, market resolves within V2_EXPIRY_CAUTION_H hours. */
  inExpiryCaution: boolean;
}

export function computeDesiredExposure(input: DesiredExposureInput): V2DesiredExposure {
  const {
    edge, disagreement, conviction, domain, bankroll, currentPos, inExpiryCaution,
  } = input;

  const absEdge = Math.abs(edge);
  const minEdge = minEntryEdge(domain);
  const wantedSide = signalSide(edge);

  // ── Expiry caution override ────────────────────────────────────────────────
  if (inExpiryCaution && currentPos && currentPos.status === 'open') {
    return {
      action:       'close',
      side:         currentPos.side,
      desired_size: Number(currentPos.size_usd),
      reason:       'expiry caution window — closing to avoid resolution risk',
      conviction,
      disagreement,
    };
  }

  // ── No existing position ──────────────────────────────────────────────────
  if (!currentPos || currentPos.status === 'closed') {
    if (absEdge < minEdge) {
      return flat(`edge ${absEdge.toFixed(3)} < min ${minEdge} for ${domain ?? 'other'}`, conviction, disagreement);
    }
    if (disagreement > V2_MAX_DISAGREEMENT_OPEN) {
      return flat(`disagreement ${disagreement.toFixed(3)} > max ${V2_MAX_DISAGREEMENT_OPEN}`, conviction, disagreement);
    }
    if (conviction < 0.30) {
      // Pilot phase: 0.30 floor (down from 0.40) to collect data across more markets.
      // Raise once calibration shows which domains produce reliable signal.
      return flat(`conviction ${conviction.toFixed(3)} < 0.30`, conviction, disagreement);
    }
    const size = Math.round(bankroll * V2_BASE_POSITION_PCT * 100) / 100;
    return {
      action:       'open',
      side:         wantedSide,
      desired_size: size,
      reason:       `opening ${wantedSide}: edge=${edge.toFixed(3)} conviction=${conviction.toFixed(3)}`,
      conviction,
      disagreement,
    };
  }

  // ── Existing open position ────────────────────────────────────────────────
  const posSide    = currentPos.side;
  const currentSize = Number(currentPos.size_usd);

  // Same direction
  if (posSide === wantedSide) {
    // Chaos → close
    if (disagreement > V2_CLOSE_DISAGREEMENT) {
      return {
        action:       'close',
        side:         posSide,
        desired_size: currentSize,
        reason:       `disagreement ${disagreement.toFixed(3)} > ${V2_CLOSE_DISAGREEMENT} — closing`,
        conviction,
        disagreement,
      };
    }
    // High disagreement → reduce
    if (disagreement > V2_REDUCE_DISAGREEMENT) {
      return {
        action:       'reduce',
        side:         posSide,
        desired_size: Math.round(currentSize * 0.5 * 100) / 100,
        reason:       `disagreement ${disagreement.toFixed(3)} > ${V2_REDUCE_DISAGREEMENT} — reducing`,
        conviction,
        disagreement,
      };
    }
    // Fading edge → reduce
    if (absEdge < V2_REDUCE_EDGE_THRESHOLD) {
      return {
        action:       'reduce',
        side:         posSide,
        desired_size: Math.round(currentSize * 0.5 * 100) / 100,
        reason:       `edge ${absEdge.toFixed(3)} < ${V2_REDUCE_EDGE_THRESHOLD} — reducing`,
        conviction,
        disagreement,
      };
    }
    // High conviction → consider adding
    if (conviction >= 0.65) {
      return {
        action:       'add',
        side:         posSide,
        desired_size: Math.round(currentSize * 0.25 * 100) / 100,
        reason:       `conviction ${conviction.toFixed(3)} ≥ 0.65 — adding 25%`,
        conviction,
        disagreement,
      };
    }
    // Default: hold
    return {
      action:       'hold',
      side:         posSide,
      desired_size: currentSize,
      reason:       `holding: edge=${edge.toFixed(3)} conviction=${conviction.toFixed(3)}`,
      conviction,
      disagreement,
    };
  }

  // Opposite direction (flip signal)
  const reversalThreshold = minEdge * V2_REVERSAL_EDGE_MULTIPLIER;
  if (absEdge < reversalThreshold) {
    // Signal flipped but not strong enough to reverse — just reduce
    return {
      action:       'reduce',
      side:         posSide,
      desired_size: Math.round(currentSize * 0.5 * 100) / 100,
      reason:       `opposite edge ${absEdge.toFixed(3)} < reversal threshold ${reversalThreshold.toFixed(3)} — reducing`,
      conviction,
      disagreement,
    };
  }

  // Strong flip → reverse
  const newSize = Math.round(bankroll * V2_BASE_POSITION_PCT * 100) / 100;
  return {
    action:       'reverse',
    side:         wantedSide,
    desired_size: newSize,
    reason:       `reversing to ${wantedSide}: edge=${edge.toFixed(3)} conviction=${conviction.toFixed(3)}`,
    conviction,
    disagreement,
  };
}

// ── Utility ───────────────────────────────────────────────────────────────────

function flat(reason: string, conviction: number, disagreement: number): V2DesiredExposure {
  return { action: 'flat', side: null, desired_size: 0, reason, conviction, disagreement };
}
