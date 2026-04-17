/**
 * Polymarket Market Ingestion Service
 *
 * Uses Polymarket's free public APIs:
 *   - gamma-api.polymarket.com/markets  — list/detail
 *   - clob.polymarket.com/prices-history — price history
 *
 * No API key needed for read operations.
 */

import { faInsert, faUpsert, faSelect, faPatch } from './db';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PolymarketMarket {
  id:              string;     // conditionId
  question:        string;
  description:     string;
  category?:       string;
  endDate?:        string;
  active:          boolean;
  closed:          boolean;
  outcomePrices:   string[];   // e.g. ["0.65","0.35"]
  volume:          number;
  liquidityNum?:   number;
  slug?:           string;
  image?:          string;
  // gamma-api may return these under different names
  condition_id?:   string;
  end_date_iso?:   string;
  outcomes?:       string[];
  outcome_prices?: string;
  tokens?:         Array<{ outcome: string; price: number }>;
}

export interface PolymarketSnapshot {
  t:     number;  // unix timestamp
  p:     number;  // yes price
}

// ── Fetch functions ──────────────────────────────────────────────────────────

const GAMMA_BASE = 'https://gamma-api.polymarket.com';
const CLOB_BASE  = 'https://clob.polymarket.com';

export async function fetchActiveMarkets(limit = 50, offset = 0): Promise<PolymarketMarket[]> {
  const url = `${GAMMA_BASE}/markets?active=true&closed=false&limit=${limit}&offset=${offset}`;
  console.log(`[FA/POLY] Fetching markets: ${url}`);
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal:  AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Polymarket API ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  // gamma-api may return array directly or wrapped
  return Array.isArray(data) ? data : (data.markets ?? data.data ?? []);
}

export async function fetchMarketById(conditionId: string): Promise<PolymarketMarket> {
  const res = await fetch(`${GAMMA_BASE}/markets/${conditionId}`, {
    headers: { Accept: 'application/json' },
    signal:  AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Polymarket detail ${res.status}`);
  return res.json();
}

export async function fetchPriceHistory(
  conditionId: string,
  startTs: number,
  endTs: number,
): Promise<PolymarketSnapshot[]> {
  const url = `${CLOB_BASE}/prices-history?market=${conditionId}&startTs=${startTs}&endTs=${endTs}&fidelity=60`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal:  AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  // Data may be { history: [...] } or direct array
  const history = Array.isArray(data) ? data : (data.history ?? []);
  return history.map((p: any) => ({ t: p.t ?? p.timestamp, p: p.p ?? p.price ?? 0 }));
}

// ── Field extraction helpers (handle Polymarket API inconsistencies) ─────────

function extractExternalId(m: any): string {
  return m.condition_id ?? m.conditionId ?? m.id ?? '';
}

function extractYesPrice(m: any): number | null {
  // Try outcomePrices — may be a real array or a JSON-encoded string
  let prices = m.outcomePrices ?? m.outcome_prices ?? null;
  if (typeof prices === 'string') {
    try { prices = JSON.parse(prices); } catch { prices = null; }
  }
  if (Array.isArray(prices) && prices.length > 0) {
    const p = parseFloat(prices[0]);
    if (!isNaN(p)) return p;
  }
  // Try tokens array
  if (Array.isArray(m.tokens)) {
    const yesToken = m.tokens.find((t: any) => t.outcome === 'Yes');
    if (yesToken?.price != null) return yesToken.price;
    if (m.tokens[0]?.price != null) return m.tokens[0].price;
  }
  return null;
}

function extractCloseTime(m: any): string | null {
  const raw = m.endDate ?? m.end_date_iso ?? m.endDateIso ?? null;
  if (!raw) return null;
  try {
    return new Date(raw).toISOString();
  } catch {
    return null;
  }
}

function extractVolume(m: any): number {
  if (typeof m.volume === 'number') return m.volume;
  if (typeof m.volume === 'string') {
    const v = parseFloat(m.volume);
    return isNaN(v) ? 0 : v;
  }
  if (typeof m.volumeNum === 'number') return m.volumeNum;
  return 0;
}

// ── Sync to DB ───────────────────────────────────────────────────────────────

export async function syncMarketsToDb(limit = 50): Promise<{
  inserted: number;
  updated: number;
  errors: string[];
}> {
  const result = { inserted: 0, updated: 0, errors: [] as string[] };

  // Create sync job record
  const jobRows = await faInsert('fa_sync_jobs', [{
    job_type: 'market_sync',
    status:   'running',
    metadata_json: { limit },
  }], { returning: true });

  const jobId = Array.isArray(jobRows) && jobRows[0] ? (jobRows[0] as any).id : null;

  try {
    const markets = await fetchActiveMarkets(limit, 0);
    console.log(`[FA/POLY] Fetched ${markets.length} markets from Polymarket`);

    // Get existing markets to determine insert vs update
    const existing = await faSelect<{ external_id: string; id: string }>(
      'fa_markets',
      'select=external_id,id&source=eq.polymarket',
    );
    const existingMap = new Map(existing.map(e => [e.external_id, e.id]));

    for (const m of markets) {
      try {
        const externalId = extractExternalId(m);
        if (!externalId) {
          result.errors.push(`Market missing external_id: ${JSON.stringify(m).slice(0, 100)}`);
          continue;
        }

        const title = m.question ?? (m as any).title ?? 'Untitled';
        const yesPrice = extractYesPrice(m);
        const volume = extractVolume(m);
        const closeTime = extractCloseTime(m);

        const row: Record<string, unknown> = {
          external_id:      externalId,
          source:           'polymarket',
          title,
          category:         m.category ?? null,
          description:      (m.description ?? '').slice(0, 5000),
          close_time:       closeTime,
          status:           m.closed ? 'closed' : (m.active ? 'active' : 'inactive'),
          current_yes_price: yesPrice,
          volume_usd:       volume,
          updated_at:       new Date().toISOString(),
          metadata_json:    {
            slug:     m.slug,
            image:    m.image,
            outcomes: m.outcomes,
          },
        };

        if (existingMap.has(externalId)) {
          // Update
          await faPatch('fa_markets', { external_id: externalId, source: 'polymarket' }, row);
          result.updated++;

          // Also insert snapshot
          const marketId = existingMap.get(externalId)!;
          await faInsert('fa_market_snapshots', [{
            market_id:  marketId,
            yes_price:  yesPrice,
            no_price:   yesPrice != null ? (1 - yesPrice) : null,
            volume_usd: volume,
          }]);
        } else {
          // Insert
          row.created_at = new Date().toISOString();
          const inserted = await faInsert('fa_markets', [row], { returning: true });
          if (Array.isArray(inserted) && inserted[0]) {
            result.inserted++;
            const marketId = (inserted[0] as any).id;
            existingMap.set(externalId, marketId);

            // Snapshot
            await faInsert('fa_market_snapshots', [{
              market_id:  marketId,
              yes_price:  yesPrice,
              no_price:   yesPrice != null ? (1 - yesPrice) : null,
              volume_usd: volume,
            }]);
          }
        }
      } catch (err: any) {
        result.errors.push(`Market sync error: ${err?.message ?? err}`);
      }
    }

    // Complete sync job
    if (jobId) {
      await faPatch('fa_sync_jobs', { id: jobId }, {
        status:            'completed',
        completed_at:      new Date().toISOString(),
        records_processed: result.inserted + result.updated,
        error_text:        result.errors.length > 0 ? result.errors.join('\n').slice(0, 2000) : null,
      });
    }

    // Audit event
    await faInsert('fa_audit_events', [{
      event_type:   'market_sync',
      entity_type:  'sync_job',
      entity_id:    jobId,
      actor:        'system',
      payload_json: { inserted: result.inserted, updated: result.updated, errors: result.errors.length },
    }]);

  } catch (err: any) {
    result.errors.push(`Fatal sync error: ${err?.message ?? err}`);
    if (jobId) {
      await faPatch('fa_sync_jobs', { id: jobId }, {
        status:       'failed',
        completed_at: new Date().toISOString(),
        error_text:   err?.message ?? String(err),
      });
    }
  }

  console.log(`[FA/POLY] Sync complete: ${result.inserted} inserted, ${result.updated} updated, ${result.errors.length} errors`);
  return result;
}
