/**
 * News Context Service — Multi-Provider
 *
 * Providers: thenewsapi | worldnews | marketaux | mediastack
 * Selector:  NEWS_API_PROVIDER env var (default: "thenewsapi")
 * Cache:     fa_market_context, STALE_HOURS = 8
 * Missing key → returns empty context, logs warning, no throw.
 */

import Anthropic from '@anthropic-ai/sdk';
import { faSelect, faUpsert } from './db';

// ─── Types ──────────────────────────────────────────────────────────────────

export type NewsProvider = 'thenewsapi' | 'worldnews' | 'marketaux' | 'mediastack';

export interface NewsContext {
  marketId:      string;
  newsSummary:   string;
  keyPoints:     string[];
  sentiment:     'positive' | 'negative' | 'neutral';
  sources:       Array<{ title: string; url: string; published_at: string }>;
  newsCount:     number;
  lastUpdatedAt: string;
  fromCache:     boolean;
  provider?:     NewsProvider;
  apiError?:     string;
}

interface Headline {
  title:        string;
  description?: string;
  snippet?:     string;
  url:          string;
  published_at: string;
}

// ─── Config ──────────────────────────────────────────────────────────────────

const STALE_HOURS = 8;
const NEWS_LIMIT  = 8;

/** Read active provider from env, validate, default to thenewsapi. */
export function getActiveProvider(): NewsProvider {
  const raw = (process.env.NEWS_API_PROVIDER ?? 'thenewsapi').toLowerCase().trim();
  const valid: NewsProvider[] = ['thenewsapi', 'worldnews', 'marketaux', 'mediastack'];
  return valid.includes(raw as NewsProvider) ? (raw as NewsProvider) : 'thenewsapi';
}

/** Return the env-var name for each provider's API key. */
function keyEnvFor(provider: NewsProvider): string {
  switch (provider) {
    case 'thenewsapi': return 'NEWS_API_KEY';
    case 'worldnews':  return 'WORLDNEWS_API_KEY';
    case 'marketaux':  return 'MARKETAUX_API_KEY';
    case 'mediastack': return 'MEDIASTACK_API_KEY';
  }
}

// ─── Query Builder ───────────────────────────────────────────────────────────

function buildQuery(title: string, domain: string): string {
  const cleaned = title
    .replace(/^(will |who will |what will |when will |does |did |is |are |has |have )/i, '')
    .replace(/\s*\?.*$/, '').trim().slice(0, 80);
  const hints: Record<string, string> = {
    sports: 'game result score', politics: 'election vote result', crypto: 'price market',
  };
  return `${cleaned} ${hints[domain] ?? ''}`.trim();
}

// ─── Provider Fetch Functions ─────────────────────────────────────────────────

async function fetchTheNewsApi(query: string, domain: string): Promise<Headline[]> {
  const key = process.env.NEWS_API_KEY;
  if (!key) { console.warn('[news-context] NEWS_API_KEY not set — skipping thenewsapi'); return []; }
  const params = new URLSearchParams({ api_token: key, search: query, language: 'en', limit: String(NEWS_LIMIT), sort: 'relevance_score' });
  if (domain === 'sports') params.set('categories', 'sports');
  try {
    const res = await fetch(`https://api.thenewsapi.com/v1/news/all?${params}`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) { console.warn(`[news-context] thenewsapi HTTP ${res.status}`); return []; }
    const data = await res.json();
    return Array.isArray(data?.data) ? data.data.map((h: any) => ({
      title: String(h.title ?? ''), description: String(h.description ?? ''),
      snippet: String(h.snippet ?? ''), url: String(h.url ?? ''), published_at: String(h.published_at ?? ''),
    })) : [];
  } catch (e: any) { console.warn('[news-context] thenewsapi error:', e?.message); return []; }
}

async function fetchWorldNews(query: string, _domain: string): Promise<Headline[]> {
  const key = process.env.WORLDNEWS_API_KEY;
  if (!key) { console.warn('[news-context] WORLDNEWS_API_KEY not set — skipping worldnews'); return []; }
  const params = new URLSearchParams({ 'api-key': key, text: query, language: 'en', number: String(NEWS_LIMIT) });
  try {
    const res = await fetch(`https://api.worldnewsapi.com/search-news?${params}`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) { console.warn(`[news-context] worldnews HTTP ${res.status}`); return []; }
    const data = await res.json();
    const articles = Array.isArray(data?.news) ? data.news : [];
    return articles.map((h: any) => ({
      title: String(h.title ?? ''), description: String(h.text ?? '').slice(0, 300),
      url: String(h.url ?? ''), published_at: String(h.publish_date ?? ''),
    }));
  } catch (e: any) { console.warn('[news-context] worldnews error:', e?.message); return []; }
}

async function fetchMarketaux(query: string, _domain: string): Promise<Headline[]> {
  const key = process.env.MARKETAUX_API_KEY;
  if (!key) { console.warn('[news-context] MARKETAUX_API_KEY not set — skipping marketaux'); return []; }
  const params = new URLSearchParams({ api_token: key, search: query, language: 'en', limit: String(NEWS_LIMIT) });
  try {
    const res = await fetch(`https://api.marketaux.com/v1/news/all?${params}`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) { console.warn(`[news-context] marketaux HTTP ${res.status}`); return []; }
    const data = await res.json();
    const articles = Array.isArray(data?.data) ? data.data : [];
    return articles.map((h: any) => ({
      title: String(h.title ?? ''), description: String(h.description ?? '').slice(0, 300),
      url: String(h.url ?? ''), published_at: String(h.published_at ?? ''),
    }));
  } catch (e: any) { console.warn('[news-context] marketaux error:', e?.message); return []; }
}

async function fetchMediastack(query: string, _domain: string): Promise<Headline[]> {
  const key = process.env.MEDIASTACK_API_KEY;
  if (!key) { console.warn('[news-context] MEDIASTACK_API_KEY not set — skipping mediastack'); return []; }
  // Note: mediastack free tier requires http (not https) on some plans
  const params = new URLSearchParams({ access_key: key, keywords: query, languages: 'en', limit: String(NEWS_LIMIT), sort: 'published_desc' });
  try {
    const res = await fetch(`http://api.mediastack.com/v1/news?${params}`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) { console.warn(`[news-context] mediastack HTTP ${res.status}`); return []; }
    const data = await res.json();
    const articles = Array.isArray(data?.data) ? data.data : [];
    return articles.map((h: any) => ({
      title: String(h.title ?? ''), description: String(h.description ?? '').slice(0, 300),
      url: String(h.url ?? ''), published_at: String(h.published_at ?? ''),
    }));
  } catch (e: any) { console.warn('[news-context] mediastack error:', e?.message); return []; }
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

async function fetchHeadlines(query: string, domain: string, provider: NewsProvider): Promise<Headline[]> {
  switch (provider) {
    case 'thenewsapi': return fetchTheNewsApi(query, domain);
    case 'worldnews':  return fetchWorldNews(query, domain);
    case 'marketaux':  return fetchMarketaux(query, domain);
    case 'mediastack': return fetchMediastack(query, domain);
  }
}

// ─── Summariser ──────────────────────────────────────────────────────────────

async function summarise(headlines: Headline[], marketTitle: string): Promise<{
  summary: string; points: string[]; sentiment: 'positive' | 'negative' | 'neutral';
}> {
  if (headlines.length === 0) return { summary: 'No recent news found.', points: [], sentiment: 'neutral' };
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const hl = headlines.map((h, i) =>
    `${i + 1}. [${String(h.published_at ?? '').slice(0, 10)}] ${h.title}\n   ${String(h.snippet ?? h.description ?? '').slice(0, 200)}`
  ).join('\n\n');
  const prompt = `You analyse prediction market news.\nMarket: "${marketTitle}"\nHeadlines:\n${hl}\n\nRespond ONLY with JSON (no markdown):\n{"summary":"<2-3 sentences>","key_points":["<point>","<point>","<point>"],"sentiment":"<positive|negative|neutral — does news favour YES outcome?>"}`;
  try {
    const r = await client.messages.create({ model: 'claude-haiku-4-5', max_tokens: 600, messages: [{ role: 'user', content: prompt }] });
    const txt = r.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('');
    const p = JSON.parse(txt.trim());
    return {
      summary:   String(p.summary ?? '').slice(0, 1000),
      points:    (Array.isArray(p.key_points) ? p.key_points : []).slice(0, 5).map(String),
      sentiment: ['positive', 'negative', 'neutral'].includes(p.sentiment)
        ? p.sentiment as 'positive' | 'negative' | 'neutral' : 'neutral',
    };
  } catch {
    return {
      summary:   `${headlines.length} recent articles found.`,
      points:    headlines.slice(0, 3).map(h => String(h.title ?? '')),
      sentiment: 'neutral',
    };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getOrRefreshContext(
  marketId: string, marketTitle: string, domain: string, forceRefresh = false,
): Promise<NewsContext> {
  const provider = getActiveProvider();

  // Cache check
  if (!forceRefresh) {
    const rows = await faSelect<any>('fa_market_context', `market_id=eq.${marketId}&select=*&limit=1`).catch(() => []);
    if (rows.length > 0) {
      const age = (Date.now() - new Date(rows[0].last_updated_at).getTime()) / 3_600_000;
      if (age < STALE_HOURS) {
        return {
          marketId,
          newsSummary:   rows[0].news_summary   ?? '',
          keyPoints:     Array.isArray(rows[0].key_points) ? rows[0].key_points : [],
          sentiment:     rows[0].sentiment ?? 'neutral',
          sources:       Array.isArray(rows[0].sources) ? rows[0].sources : [],
          newsCount:     Array.isArray(rows[0].raw_headlines_json) ? rows[0].raw_headlines_json.length : 0,
          lastUpdatedAt: rows[0].last_updated_at,
          fromCache:     true,
          provider:      (rows[0].provider as NewsProvider) ?? provider,
        };
      }
    }
  }

  // Fetch
  const query     = buildQuery(marketTitle, domain);
  const headlines = await fetchHeadlines(query, domain, provider);
  const s         = await summarise(headlines, marketTitle);
  const sources   = headlines.slice(0, 5).map(h => ({ title: h.title, url: h.url, published_at: h.published_at }));
  const now       = new Date().toISOString();

  const keyEnv = keyEnvFor(provider);
  const apiError = headlines.length === 0 && !process.env[keyEnv]
    ? `${keyEnv} not set` : undefined;

  await faUpsert('fa_market_context', [{
    market_id: marketId, domain, news_summary: s.summary, key_points: s.points,
    sentiment: s.sentiment, sources, raw_headlines_json: headlines.slice(0, 10),
    last_updated_at: now, created_at: now, provider,
  }], 'market_id').catch(() => {});

  return {
    marketId, newsSummary: s.summary, keyPoints: s.points, sentiment: s.sentiment,
    sources, newsCount: headlines.length, lastUpdatedAt: now, fromCache: false,
    provider, apiError,
  };
}

/** Lightweight count-only call — uses active provider, no DB write. */
export async function getNewsCountOnly(marketTitle: string, domain: string): Promise<number> {
  const provider = getActiveProvider();
  const headlines = await fetchHeadlines(buildQuery(marketTitle, domain), domain, provider);
  return headlines.length;
}
