/**
 * Market Scorer — pilot domain: SPORTS (NBA/NHL/NFL)
 * 4-dimension scoring, 0–100 total.
 * Volume: 0–30 | Timing: 0–25 | Price: 0–20 | News: 0–25
 */

export const PILOT_DOMAIN = 'sports' as const;

// Domain classification now lives in a single source of truth (domains.ts)
// so fa_markets.domain, fa_market_scores.domain, fa_calibration_events.domain
// and fa_benchmarks.domain all use identical labels.
import { classifyMarketDomain, DOMAIN_KEYWORDS as CANONICAL_KEYWORDS } from './domains';

export const DOMAIN_KEYWORDS = CANONICAL_KEYWORDS;

export function detectDomain(title: string, category: string | null): string {
  return classifyMarketDomain(title, category);
}

// Eligibility constants
const MIN_VOLUME_USD = 500;
const MIN_HOURS_LEFT = 2;
const MAX_HOURS_LEFT = 120 * 24; // 120 days — covers full playoff/tournament seasons
const MIN_YES_PRICE  = 0.03;     // lowered: many Finals markets at 0.3-1%
const MAX_YES_PRICE  = 0.97;
export const MIN_SCORE = 20;     // lowered: long-window markets score less on timing

// Sub-scorers — each returns [score, tags[]]
function scoreVolume(vol: number): [number, string[]] {
  if (vol >= 5_000_000) return [30, ['ultra-high-volume']];
  if (vol >= 1_000_000) return [26, ['high-volume']];
  if (vol >= 200_000)   return [21, []];
  if (vol >= 50_000)    return [15, []];
  if (vol >= 10_000)    return [9,  []];
  if (vol >= 1_000)     return [4,  ['low-volume']];
  return [0, ['low-liquidity']];
}

function scoreTiming(closeTime: string | null): [number, string[]] {
  if (!closeTime) return [5, []];
  const h = (new Date(closeTime).getTime() - Date.now()) / 3_600_000;
  if (h < 2)    return [0,  ['expiring-soon']];
  if (h < 24)   return [10, ['near-expiry']];
  if (h < 72)   return [25, ['short-window']];
  if (h < 168)  return [20, []];
  if (h < 336)  return [14, []];
  if (h < 720)  return [7,  []];
  if (h < 1440) return [4,  ['long-window']];   // 30–60 days
  if (h < 2160) return [3,  ['long-window']];   // 60–90 days
  return [2, ['far-expiry']];                   // 90–120 days
}

function scorePrice(p: number): [number, string[]] {
  const d = Math.abs(p - 0.5);
  if (d <= 0.05) return [20, []];
  if (d <= 0.15) return [16, []];
  if (d <= 0.25) return [10, []];
  if (d <= 0.35) return [4,  ['skewed-price']];
  return [1, ['extreme-price']];
}

function scoreNews(n: number): [number, string[]] {
  if (n >= 10) return [25, ['news-heavy']];
  if (n >= 6)  return [20, []];
  if (n >= 3)  return [14, []];
  if (n >= 1)  return [7,  []];
  return [0, []];
}

export interface MarketForScoring {
  id:                string;
  title:             string;
  category:          string | null;
  current_yes_price: number | null;
  volume_usd:        number | null;
  close_time:        string | null;
}

export interface ScoredMarket {
  marketId:  string;
  score:     number;
  tags:      string[];
  eligible:  boolean;
  reason?:   string;
  breakdown: { volumeScore: number; timingScore: number; priceScore: number; newsScore: number };
}

export function scoreMarket(m: MarketForScoring, newsCount = 0): ScoredMarket {
  const vol   = Number(m.volume_usd ?? 0);
  const price = Number(m.current_yes_price ?? 0.5);
  const ineligible = (reason: string, tags: string[]): ScoredMarket => ({
    marketId: m.id, score: 0, tags, eligible: false, reason,
    breakdown: { volumeScore: 0, timingScore: 0, priceScore: 0, newsScore: 0 },
  });

  if (vol < MIN_VOLUME_USD)                           return ineligible(`volume $${vol.toFixed(0)} < $${MIN_VOLUME_USD}`,       ['low-liquidity']);
  if (price < MIN_YES_PRICE || price > MAX_YES_PRICE) return ineligible(`price ${(price*100).toFixed(1)}% outside 4–96%`, ['extreme-price']);
  if (m.close_time) {
    const h = (new Date(m.close_time).getTime() - Date.now()) / 3_600_000;
    if (h < MIN_HOURS_LEFT) return ineligible(`expires in ${h.toFixed(0)}h`, ['expiring-soon']);
    if (h > MAX_HOURS_LEFT) return ineligible(`expires in ${Math.round(h/24)}d (>30d)`, ['far-expiry']);
  }

  const [vs, vt] = scoreVolume(vol);
  const [ts, tt] = scoreTiming(m.close_time);
  const [ps, pt] = scorePrice(price);
  const [ns, nt] = scoreNews(newsCount);
  const total = vs + ts + ps + ns;

  return {
    marketId: m.id, score: total,
    tags: [...new Set([...vt, ...tt, ...pt, ...nt])],
    eligible: total >= MIN_SCORE,
    reason: total < MIN_SCORE ? `score ${total} < minimum ${MIN_SCORE}` : undefined,
    breakdown: { volumeScore: vs, timingScore: ts, priceScore: ps, newsScore: ns },
  };
}

export function selectTopMarkets(scored: ScoredMarket[], topN = 5): ScoredMarket[] {
  return scored.filter(s => s.eligible).sort((a, b) => b.score - a.score).slice(0, topN);
}

// ── Domain-aware selection (Manus thesis enforcement) ─────────────────────────

/**
 * Per-domain priority weights for selection.
 * Sports gets 1 (lowest). All thesis-aligned domains get 5–10.
 * Used as a tiebreaker AND as a multiplier cap on sports selection.
 */
export const DOMAIN_PRIORITY: Record<string, number> = {
  politics:    10,
  geopolitics: 10,
  tech:        8,
  crypto:      8,
  macro:       7,
  culture:     5,
  other:       4,
  sports:      1,   // ← thesis says: near-zero LLM edge
};

/** Max sports markets per selection cycle. Hard cap. */
export const SPORTS_MAX_PER_CYCLE = 1;

export interface ScoredMarketWithDomain {
  scored:  ScoredMarket;
  domain:  string;
  /** Raw db market_id — same as scored.marketId but explicit for clarity. */
  marketId: string;
}

/**
 * Domain-balanced selection enforcing the Manus thesis:
 *
 *   1. Eligible markets are sorted by (domain_priority DESC, score DESC).
 *   2. Sports is hard-capped at SPORTS_MAX_PER_CYCLE (1) slot per cycle.
 *      Even if 5 sports markets score highest by raw points, only 1 gets in.
 *   3. Remaining slots are filled by non-sports in priority × score order.
 *
 * This means: if there are any eligible politics/geopolitics/tech/crypto
 * markets, they ALWAYS win the selection over additional sports markets.
 *
 * File: src/lib/forecast/market-scorer.ts
 * Called from: src/app/api/forecast/daily-cycle/route.ts :: stepScoreMarkets()
 */
export function selectMarketsWithDomainBalance(
  items:     ScoredMarketWithDomain[],
  topN:      number = 5,
  sportsCap: number = SPORTS_MAX_PER_CYCLE,
): ScoredMarket[] {
  const eligible = items.filter(i => i.scored.eligible);

  // Sort by (domain_priority DESC, score DESC) — non-sports always float up
  eligible.sort((a, b) => {
    const pa = DOMAIN_PRIORITY[a.domain] ?? 4;
    const pb = DOMAIN_PRIORITY[b.domain] ?? 4;
    if (pb !== pa) return pb - pa;
    return b.scored.score - a.scored.score;
  });

  // Diagnostic: log top-5 after priority sort
  const top5 = eligible.slice(0, 5).map(i =>
    `${i.domain}(p=${DOMAIN_PRIORITY[i.domain] ?? 4}):${i.scored.score}`
  );
  console.log(`[FA/SCORER] selectMarketsWithDomainBalance top-5 after sort: ${top5.join(', ')}`);

  const selected: ScoredMarket[] = [];
  let sportsCount = 0;

  for (const item of eligible) {
    if (selected.length >= topN) break;
    if (item.domain === 'sports') {
      if (sportsCount >= sportsCap) continue;   // skip; cap already hit
      sportsCount++;
    }
    selected.push(item.scored);
  }

  return selected;
}
