'use client';

/**
 * ForecastNav — Shared navigation for Forecast Arena admin pages.
 * Client component for active-link highlighting.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/forecast-arena/dashboard',   label: 'Dashboard' },
  { href: '/forecast-arena/markets',     label: 'Markets' },
  { href: '/forecast-arena/rounds',      label: 'Rounds' },
  { href: '/forecast-arena/players',     label: 'Players' },
  { href: '/forecast-arena/leaderboard', label: 'Leaderboard' },
  { href: '/forecast-arena/costs',       label: 'Costs' },
  { href: '/forecast-arena/ledger',      label: 'Ledger' },
  { href: '/forecast-arena/audit',       label: 'Audit' },
];

export function ForecastNav() {
  const pathname = usePathname();

  return (
    <nav style={{
      display:       'flex',
      flexWrap:      'wrap',
      gap:           '4px',
      padding:       '12px 0',
      borderBottom:  '1px solid #222',
      marginBottom:  '24px',
    }}>
      {NAV_ITEMS.map(item => {
        const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
        return (
          <Link
            key={item.href}
            href={item.href}
            style={{
              padding:        '6px 14px',
              fontSize:       '0.8rem',
              fontFamily:     'monospace',
              color:          isActive ? '#080808' : '#888',
              background:     isActive ? '#d4f25a' : 'transparent',
              borderRadius:   '4px',
              textDecoration: 'none',
              fontWeight:     isActive ? 700 : 400,
              transition:     'all 0.15s',
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
