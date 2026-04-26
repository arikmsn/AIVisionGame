'use client';

/**
 * LiveBookControls — client component for pilot-level operator actions.
 * Renders quick-action buttons and calls /api/forecast/v2/operator.
 */

import { useState, useTransition } from 'react';
import { useRouter }               from 'next/navigation';

interface Props {
  pilotStatus: string;
  pilotId:     string;
}

export default function LiveBookControls({ pilotStatus, pilotId }: Props) {
  const [busy, startTransition] = useTransition();
  const [msg, setMsg]           = useState<string | null>(null);
  const router                  = useRouter();

  async function callOperator(body: Record<string, unknown>) {
    setMsg(null);
    const password = process.env.NEXT_PUBLIC_ADMIN_PASSWORD ??
      (typeof window !== 'undefined' ? (window as any).__ADMIN_PW__ : null);

    const res = await fetch('/api/forecast/v2/operator', {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-admin-password': password ?? '',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.ok !== false) {
      setMsg(`✓ ${body.action} — done`);
      startTransition(() => router.refresh());
    } else {
      setMsg(`✗ ${data.error ?? data.reason ?? 'failed'}`);
    }
  }

  const btn = (label: string, onClick: () => void, color = '#374151') => (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        background:    color,
        border:        'none',
        borderRadius:  4,
        padding:       '5px 12px',
        fontSize:      '0.75rem',
        fontWeight:    600,
        color:         '#e5e7eb',
        cursor:        busy ? 'not-allowed' : 'pointer',
        opacity:       busy ? 0.6 : 1,
        transition:    'opacity 0.1s',
        fontFamily:    'monospace',
      }}
    >
      {label}
    </button>
  );

  const isActive      = pilotStatus === 'active';
  const isPaused      = pilotStatus === 'paused';
  const isManualOnly  = pilotStatus === 'manual_only';

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {!isManualOnly && btn(
          'Manual Only',
          () => callOperator({ action: 'manual_only', reason: 'operator override' }),
          '#1d4ed8',
        )}
        {isManualOnly && btn(
          'Auto Mode',
          () => callOperator({ action: 'auto_mode', reason: 'operator resumed auto' }),
          '#166534',
        )}
        {!isPaused && btn(
          'Pause All',
          () => callOperator({ action: 'pause_all', reason: 'operator pause' }),
          '#78350f',
        )}
        {isPaused && btn(
          'Resume',
          () => callOperator({ action: 'resume_all', reason: 'operator resume' }),
          '#166534',
        )}
        {btn(
          'Close All Positions',
          () => {
            if (!confirm('Close ALL open positions?')) return;
            callOperator({ action: 'close_all', reason: 'operator close-all' });
          },
          '#7f1d1d',
        )}

        {msg && (
          <span style={{
            fontSize:    '0.75rem',
            color:       msg.startsWith('✓') ? '#4ade80' : '#f87171',
            marginLeft:  8,
          }}>
            {msg}
          </span>
        )}
      </div>

      {isManualOnly && (
        <div style={{ fontSize: '0.72rem', color: '#60a5fa', marginTop: 6 }}>
          ⚠ Manual-only mode: system will not open new positions until auto mode is restored.
        </div>
      )}
      {isPaused && (
        <div style={{ fontSize: '0.72rem', color: '#fbbf24', marginTop: 6 }}>
          ⚠ Pilot paused: all system actions are blocked.
        </div>
      )}
    </div>
  );
}
