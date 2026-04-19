/**
 * /forecast-arena/markets — Market strategy view
 * Uses fa_v_market_strategy if available, falls back to fa_markets.
 */

import Link from 'next/link';
import { sfetch } from '@/lib/forecast/db';

export const dynamic = 'force-dynamic';

function DomainBadge({ domain }: { domain: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    sports:      { bg: '#1a1500', color: '#fbbf24' },
    politics:    { bg: '#001233', color: '#60a5fa' },
    geopolitics: { bg: '#001233', color: '#818cf8' },
    crypto:      { bg: '#1a0d00', color: '#f97316' },
    tech:        { bg: '#001a0d', color: '#34d399' },
    macro:       { bg: '#0d0d1a', color: '#a78bfa' },
    culture:     { bg: '#1a001a', color: '#e879f9' },
    other:       { bg: '#161616', color: '#6b7280' },
    general:     { bg: '#161616', color: '#6b7280' },  // legacy fallback
  };
  const c = colors[domain] ?? colors.other;
  return (
    <span style={{
      fontSize: '0.6rem', fontWeight: 600, padding: '2px 7px', borderRadius: '3px',
      background: c.bg, color: c.color, textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>
      {domain}
    </span>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? '#4ade80' : score >= 50 ? '#fbbf24' : score >= 30 ? '#9ca3af' : '#374151';
  return (
    <span style={{ fontWeight: 700, color, fontFamily: 'monospace', fontSize: '0.85rem' }}>
      {score > 0 ? score.toFixed(0) : '—'}
    </span>
  );
}

function SentimentDot({ sentiment }: { sentiment: string | null }) {
  if (!sentiment) return <span style={{ color: '#333' }}>—</span>;
  const map: Record<string, string> = { positive: '🟢', negative: '🔴', neutral: '⚪' };
  return <span title={sentiment}>{map[sentiment] ?? '⚪'}</span>;
}

function ContextIndicator({ fresh, updated }: { fresh: boolean | null; updated: string | null }) {
  if (!updated) return <span style={{ color: '#333', fontSize: '0.7rem' }}>none</span>;
  if (fresh)    return <span style={{ color: '#4ade80', fontSize: '0.7rem' }}>fresh</span>;
  return <span style={{ color: '#f59e0b', fontSize: '0.7rem' }}>stale</span>;
}

const TH: React.CSSProperties = {
  padding: '6px 10px', textAlign: 'left', color: '#555',
  fontWeight: 500, fontSize: '0.62rem', letterSpacing: '0.05em',
  textTransform: 'uppercase', borderBottom: '1px solid #222', whiteSpace: 'nowrap',
};
const TD: React.CSSProperties = { padding: '7px 10px', fontSize: '0.78rem', verticalAlign: 'middle' };

export default async function MarketsPage() {
  let markets: any[] = [];
  let usingStrategy = false;

  try {
    const data = await sfetch('fa_v_market_strategy?select=*&order=score.desc.nullslast,volume_usd.desc.nullslast&limit=150');
    if (Array.isArray(data) && data.length >= 0) {
      markets = data;
      usingStrategy = true;
    }
  } catch {
    // view doesn't exist yet — fall back
  }

  if (!usingStrategy) {
    try {
      const data = await sfetch('fa_markets?select=*&order=volume_usd.desc.nullslast&limit=100');
      if (Array.isArray(data)) markets = data;
    } catch { /* tables may not exist */ }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '16px' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#ccc', margin: 0 }}>
          Markets ({markets.length})
        </h2>
        {!usingStrategy && (
          <span style={{ fontSize: '0.7rem', color: '#555' }}>
            Run migration 015 to enable strategy view
          </span>
        )}
      </div>

      {markets.length === 0 ? (
        <p style={{ color: '#555', fontSize: '0.85rem' }}>
          No markets synced yet. Run POST /api/forecast/sync-markets to import from Polymarket.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.78rem' }}>
            <thead>
              <tr style={{ background: '#0a0a0a' }}>
                {['Title', 'Domain', 'Score', 'Sel', 'YES', 'Volume', 'Close', 'Sentiment', 'Context'].map(h => (
                  <th key={h} style={TH}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {markets.map((m: any) => {
                const score       = Number(m.score ?? 0);
                const isSelected  = Boolean(m.is_selected);
                const yesPrice    = m.current_yes_price != null ? Number(m.current_yes_price) : null;
                const volume      = Number(m.volume_usd ?? 0);
                const domain      = String(m.domain ?? 'other');
                const sentiment   = m.sentiment ?? null;
                const contextFresh = m.context_fresh ?? null;
                const contextAt   = m.context_updated_at ?? null;

                return (
                  <tr key={m.market_id ?? m.id} style={{ borderBottom: '1px solid #161616' }}>
                    <td style={{ ...TD, maxWidth: '340px' }}>
                      <Link
                        href={`/forecast-arena/markets/${m.market_id ?? m.id}`}
                        style={{ color: '#d4f25a', textDecoration: 'none' }}
                      >
                        {(m.title ?? '').slice(0, 75)}
                      </Link>
                    </td>
                    <td style={TD}>
                      <DomainBadge domain={domain} />
                    </td>
                    <td style={{ ...TD, textAlign: 'center' }}>
                      <ScoreBadge score={score} />
                    </td>
                    <td style={{ ...TD, textAlign: 'center', fontSize: '1rem' }}>
                      {isSelected ? <span title="Selected">★</span> : <span style={{ color: '#2a2a2a' }}>☆</span>}
                    </td>
                    <td style={{ ...TD, fontWeight: 600 }}>
                      {yesPrice != null ? `${(yesPrice * 100).toFixed(1)}%` : '--'}
                    </td>
                    <td style={{ ...TD, color: '#888' }}>
                      ${volume.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td style={{ ...TD, color: '#666', whiteSpace: 'nowrap' }}>
                      {m.close_time ? new Date(m.close_time).toLocaleDateString() : '--'}
                    </td>
                    <td style={{ ...TD, textAlign: 'center' }}>
                      <SentimentDot sentiment={sentiment} />
                    </td>
                    <td style={TD}>
                      <ContextIndicator fresh={contextFresh} updated={contextAt} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
