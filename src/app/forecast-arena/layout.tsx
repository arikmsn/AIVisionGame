/**
 * /forecast-arena layout — Operator Investment System
 *
 * Desktop-first operator shell. Dark theme, information-dense,
 * restructured around the investment workflow.
 */

import { ForecastNav } from './_components/ForecastNav';

export const metadata = {
  title: 'מערכת תחזיות — לוח שליטה',
};

export default function ForecastArenaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{
      fontFamily:   '"Inter", "Segoe UI", system-ui, monospace',
      background:   '#080808',
      color:        '#f0f0f0',
      minHeight:    '100vh',
      padding:      '20px 36px 48px',
      maxWidth:     '1600px',
      margin:       '0 auto',
    }}>
      <header style={{
        display:        'flex',
        alignItems:     'baseline',
        gap:            '16px',
        marginBottom:   '6px',
      }}>
        <h1 style={{
          fontSize:      '1.15rem',
          fontWeight:    700,
          color:         '#d4f25a',
          margin:        0,
          letterSpacing: '0.02em',
          fontFamily:    'monospace',
        }}>
          מערכת תחזיות
        </h1>
        <span style={{ color: '#333', fontSize: '0.72rem' }}>
          מנוע תחזיות שווקי חיזוי — Forecast Arena
        </span>
      </header>
      <ForecastNav />
      <main>{children}</main>
    </div>
  );
}
