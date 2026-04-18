/**
 * News Context Service
 * Provider: thenewsapi.com (env: NEWS_API_KEY)
 * Free tier: 100 req/day — use DB cache (STALE_HOURS = 8)
 * Missing key → returns empty context, no throw.
 */

import Anthropic from '@anthropic-ai/sdk';
import { faSelect, faUpsert } from './db';

const STALE_HOURS = 8;
const NEWS_LIMIT  = 8;
const API_BASE    = 'https://api.thenewsapi.com/v1/news/all';

export interface NewsContext {
  marketId:      string;
  newsSummary:   string;
  keyPoints:     string[];
  sentiment:     'positive' | 'negative' | 'neutral';
  sources:       Array<{ title: string; url: string; published_at: string }>;
  newsCount:     number;
  lastUpdatedAt: string;
  fromCache:     boolean;
  apiError?:     string;
}

function buildQuery(title: string, domain: string): string {
  const cleaned = title
    .replace(/^(will |who will |what will |when will |does |did |is |are |has |have )/i, '')
    .replace(/\s*\?.*$/, '').trim().slice(0, 80);
  const hints: Record<string, string> = {
    sports: 'game result score', politics: 'election vote result', crypto: 'price market',
  };
  return `${cleaned} ${hints[domain] ?? ''}`.trim();
}

async function fetchHeadlines(query: string, domain: string): Promise<any[]> {
  const key = process.env.NEWS_API_KEY;
  if (!key) return [];
  const params = new URLSearchParams({ api_token: key, search: query, language: 'en', limit: String(NEWS_LIMIT), sort: 'relevance_score' });
  if (domain === 'sports') params.set('categories', 'sports');
  try {
    const res = await fetch(`${API_BASE}?${params}`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.data) ? data.data : [];
  } catch { return []; }
}

async function summarise(headlines: any[], marketTitle: string): Promise<{
  summary: string; points: string[]; sentiment: 'positive' | 'negative' | 'neutral'
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
      sentiment: ['positive', 'negative', 'neutral'].includes(p.sentiment) ? p.sentiment as 'positive' | 'negative' | 'neutral' : 'neutral',
    };
  } catch {
    return { summary: `${headlines.length} recent articles found.`, points: headlines.slice(0, 3).map((h: any) => String(h.title ?? '')), sentiment: 'neutral' };
  }
}

export async function getOrRefreshContext(
  marketId: string, marketTitle: string, domain: string, forceRefresh = false,
): Promise<NewsContext> {
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
        };
      }
    }
  }
  const query = buildQuery(marketTitle, domain);
  const headlines = await fetchHeadlines(query, domain);
  const s = await summarise(headlines, marketTitle);
  const sources = headlines.slice(0, 5).map((h: any) => ({ title: String(h.title ?? ''), url: String(h.url ?? ''), published_at: String(h.published_at ?? '') }));
  const now = new Date().toISOString();
  await faUpsert('fa_market_context', [{
    market_id: marketId, domain, news_summary: s.summary, key_points: s.points,
    sentiment: s.sentiment, sources, raw_headlines_json: headlines.slice(0, 10),
    last_updated_at: now, created_at: now,
  }], 'market_id').catch(() => {});
  return {
    marketId, newsSummary: s.summary, keyPoints: s.points, sentiment: s.sentiment,
    sources, newsCount: headlines.length, lastUpdatedAt: now, fromCache: false,
    apiError: headlines.length === 0 && !process.env.NEWS_API_KEY ? 'NEWS_API_KEY not set' : undefined,
  };
}

export async function getNewsCountOnly(marketTitle: string, domain: string): Promise<number> {
  const headlines = await fetchHeadlines(buildQuery(marketTitle, domain), domain);
  return headlines.length;
}
