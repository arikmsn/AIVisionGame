'use client';

/**
 * ForecastNav — Investment operator navigation.
 * Restructured around the investment workflow (Hebrew labels).
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const PRIMARY_NAV = [
  { href: '/forecast-arena/dashboard',  label: 'מרכז שליטה',  en: 'Control Center' },
  { href: '/forecast-arena/decisions',  label: 'החלטות',       en: 'Decisions' },
  { href: '/forecast-arena/positions',  label: 'פוזיציות',     en: 'Positions' },
  { href: '/forecast-arena/finance',    label: 'כספים',        en: 'Finance' },
  { href: '/forecast-arena/markets',    label: 'שווקים',       en: 'Markets' },
  { href: '/forecast-arena/experiment', label: 'ניסוי',        en: 'Experiment' },
];

const SECONDARY_NAV = [
  { href: '/forecast-arena/admin',      label: 'ניהול',        en: 'Admin' },
];

export function ForecastNav() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    pathname === href || pathname?.startsWith(href + '/');

  const linkStyle = (href: string): React.CSSProperties => ({
    padding:        '5px 13px',
    fontSize:       '0.8rem',
    color:          isActive(href) ? '#080808' : '#777',
    background:     isActive(href) ? '#d4f25a' : 'transparent',
    borderRadius:   '4px',
    textDecoration: 'none',
    fontWeight:     isActive(href) ? 700 : 400,
    transition:     'all 0.12s',
    display:        'flex',
    flexDirection:  'column',
    alignItems:     'center',
    lineHeight:     1.2,
    whiteSpace:     'nowrap',
  });

  return (
    <nav style={{
      display:      'flex',
      alignItems:   'center',
      gap:          '2px',
      padding:      '10px 0',
      borderBottom: '1px solid #1e1e1e',
      marginBottom: '28px',
    }}>
      {PRIMARY_NAV.map(item => (
        <Link key={item.href} href={item.href} style={linkStyle(item.href)}>
          <span>{item.label}</span>
          {!isActive(item.href) && (
            <span style={{ fontSize: '0.55rem', color: '#444', marginTop: '1px' }}>{item.en}</span>
          )}
        </Link>
      ))}

      {/* Divider */}
      <span style={{ color: '#222', margin: '0 6px' }}>|</span>

      {SECONDARY_NAV.map(item => (
        <Link key={item.href} href={item.href} style={{
          ...linkStyle(item.href),
          color: isActive(item.href) ? '#080808' : '#444',
        }}>
          <span>{item.label}</span>
          {!isActive(item.href) && (
            <span style={{ fontSize: '0.55rem', color: '#333', marginTop: '1px' }}>{item.en}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}
