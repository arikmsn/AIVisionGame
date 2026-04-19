/**
 * Forecast Arena — Domain Taxonomy (single source of truth)
 *
 * Canonical list of market domains used for:
 *   - fa_markets.domain column
 *   - fa_model_calibration partitions
 *   - fa_benchmarks partitions
 *   - fa_market_scores.domain (legacy)
 *
 * Keep this list in sync with the CHECK constraint in migration 015.
 */

export const DOMAINS = [
  'politics',
  'geopolitics',
  'tech',
  'sports',
  'crypto',
  'macro',
  'culture',
  'other',
] as const;

export type Domain = typeof DOMAINS[number];

export function isValidDomain(d: string | null | undefined): d is Domain {
  return !!d && (DOMAINS as readonly string[]).includes(d);
}

/**
 * Keyword heuristics. Order matters — first match wins. Earlier domains
 * should be more specific than later ones.
 */
export const DOMAIN_KEYWORDS: Record<Exclude<Domain, 'other'>, string[]> = {
  politics:    ['election', 'president', 'senate', 'congress', 'vote', 'democrat', 'republican', 'poll', 'candidate', 'governor', 'referendum', 'primary', 'mayor', 'parliament', 'prime minister'],
  geopolitics: ['war', 'ceasefire', 'sanction', 'invade', 'treaty', 'nato', 'united nations', 'un security', 'hostage', 'nuclear', 'missile', 'border', 'refugee', 'putin', 'xi jinping', 'israel', 'ukraine', 'russia', 'china', 'iran', 'taiwan', 'gaza'],
  tech:        ['openai', 'anthropic', 'google', 'apple', 'meta', 'microsoft', 'nvidia', 'amazon', 'tesla', 'gpt', 'claude', 'gemini', 'llm', 'ai model', 'ai agent', 'launch', 'release', 'acquire', 'merger', 'ipo', 'earnings', 'ceo', 'startup'],
  sports:      ['nba', 'nfl', 'nhl', 'mlb', 'soccer', 'football', 'basketball', 'hockey', 'baseball', 'sport', 'match', 'playoff', 'championship', 'finals', 'team', 'player', 'season', 'world cup', 'olympic', 'super bowl', 'tournament', 'tennis', 'golf', 'f1', 'formula 1', 'ufc', 'boxing'],
  crypto:      ['bitcoin', 'ethereum', 'btc', 'eth', 'crypto', 'token', 'blockchain', 'defi', 'solana', 'sol ', 'coinbase', 'binance', 'stablecoin', 'memecoin', 'nft', 'web3'],
  macro:       ['fed ', 'federal reserve', 'interest rate', 'cpi', 'inflation', 'gdp', 'recession', 'unemployment', 'jobs report', 'treasury', 'bond', 'yield curve', 's&p 500', 'nasdaq', 'dow '],
  culture:     ['oscar', 'grammy', 'emmy', 'golden globe', 'box office', 'movie', 'film', 'album', 'song', 'taylor swift', 'kardashian', 'reality tv', 'celebrity', 'wedding', 'divorce', 'grammy awards'],
};

/**
 * Deterministic domain classifier. Pure function — safe to call on every
 * market ingest. Returns 'other' when no keyword matches.
 */
export function classifyMarketDomain(title: string, category: string | null | undefined): Domain {
  const text = `${title ?? ''} ${category ?? ''}`.toLowerCase();
  for (const [domain, kws] of Object.entries(DOMAIN_KEYWORDS) as [Exclude<Domain, 'other'>, string[]][]) {
    if (kws.some(k => text.includes(k))) return domain;
  }
  return 'other';
}
