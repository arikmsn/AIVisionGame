/**
 * LegacyBanner — shown on old v1 forecasting pages.
 *
 * These pages reflect the pre-pivot multi-LLM forecasting workflow. They're
 * still URL-accessible for historical reference but no longer driven by the
 * live cron pipeline. The banner makes that explicit so an operator who
 * lands here doesn't mistake stale numbers for live state.
 */

export function LegacyBanner({ pageName }: { pageName: string }) {
  return (
    <div style={{
      background:   '#1a0e0e',
      border:       '1px solid #7f1d1d',
      borderRadius: 8,
      padding:      '10px 14px',
      marginBottom: 16,
      fontSize:     '0.78rem',
      color:        '#fca5a5',
      lineHeight:   1.6,
    }}>
      <b style={{ color: '#fecaca' }}>Legacy view ({pageName})</b> —
      this page reflects the previous v1 multi-LLM forecasting workflow and is no
      longer driven by the live cron pipeline. Numbers may be stale. Current state:{' '}
      <a href="/forecast-arena/live-book" style={{ color: '#d4f25a' }}>Live Book</a>.
      No real funds are deposited; this is a paper pilot in scanner-research mode.
    </div>
  );
}
