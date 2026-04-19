/**
 * Market Scorer — pilot domain: SPORTS (NBA/NHL/NFL)
 * 4-dimension scoring, 0–100 total.
 * Volume: 0–30 | Timing: 0–25 | Price: 0–20 | News: 0–25
 */

export const PILOT_DOMAIN = 'sports' as const;

export const DOMAIN_KEYWORDS: Record<string, string[]> = {
  sports: ['nba', 'nfl', 'nhl', 'mlb', 'soccer', 'football', 'basketball', 'hockey', 'baseball', 'sport', 'game', 'match', 'playoff', 'championship', 'finals', 'team', 'player', 'season'],
  politics: ['election', 'president', 'senate', 'congress', 'vote', 'democrat', 'republican', 'poll', 'candidate', 'governor', 'referendum'],
  crypto: ['bitcoin', 'ethereum', 'btc', 'eth', 'crypto', 'token', 'blockchain', 'defi', 'solana'],
};

export function detectDomain(title: string, category: string | null): string {
  const text = `${title} ${category ?? ''}`.toLowerCase();
  for (const [domain, kws] of Object.entries(DOMAIN_KEYWORDS)) {
    if (kws.some(k => text.includes(k))) return domain;
  }
  return 'general';
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
