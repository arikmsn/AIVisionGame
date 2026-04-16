/**
 * /forecast-arena layout — Server component wrapper.
 *
 * Auth is handled by middleware.ts (HTTP Basic Auth).
 * This layout provides the dark theme shell and navigation.
 */

import { ForecastNav } from './_components/ForecastNav';

export const metadata = {
  title: 'Forecast Arena — Admin',
};

export default function ForecastArenaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{
      fontFamily:      'monospace',
      background:      '#080808',
      color:           '#f0f0f0',
      minHeight:       '100vh',
      padding:         '24px 32px',
      maxWidth:        '1440px',
      margin:          '0 auto',
    }}>
      <header style={{ marginBottom: '8px' }}>
        <h1 style={{
          fontSize:    '1.3rem',
          fontWeight:  700,
          color:       '#d4f25a',
          margin:      0,
          letterSpacing: '0.02em',
        }}>
          Forecast Arena
        </h1>
        <p style={{ color: '#666', fontSize: '0.75rem', margin: '4px 0 0' }}>
          Prediction market forecasting system — Admin
        </p>
      </header>
      <ForecastNav />
      <main>{children}</main>
    </div>
  );
}
