'use client';

/**
 * OperatorActions — four one-click operator buttons that call server actions.
 *
 * All actions run server-side (actions.ts, 'use server'). No password flows
 * through the browser — middleware already enforces Basic Auth on all
 * /forecast-arena/* routes.
 *
 * Architecture note: "Run Tick" does NOT call any LLM. It is 100% rule-based:
 *   stop-loss → scale-out → scale-in → hold  (based on price movement thresholds)
 * Only "Run Round" calls LLMs (once per agent per round for initial forecast entry).
 */

import { useState, useTransition } from 'react';
import {
  runTickAction,
  syncMarketsAction,
  createRoundAction,
  runLatestRoundAction,
  type ActionResult,
} from '../dashboard/actions';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ButtonSpec {
  id:      string;
  label:   string;
  note:    string;
  color:   string;
  action:  () => Promise<ActionResult>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ResultBanner({ result }: { result: ActionResult }) {
  return (
    <div style={{
      marginTop:    '8px',
      padding:      '8px 12px',
      borderRadius: '4px',
      background:   result.ok ? '#0d1a0d' : '#1a0d0d',
      border:       `1px solid ${result.ok ? '#1e4d1e' : '#4d1e1e'}`,
      fontSize:     '0.75rem',
    }}>
      <span style={{ color: result.ok ? '#4ade80' : '#f87171', fontWeight: 600 }}>
        {result.ok ? '✓' : '✗'} {result.message}
      </span>
      {result.detail && (
        <pre style={{
          marginTop:  '4px',
          color:      '#555',
          fontSize:   '0.65rem',
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak:  'break-all',
        }}>
          {JSON.stringify(result.detail, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OperatorActions() {
  const [results, setResults]     = useState<Record<string, ActionResult>>({});
  const [isPending, startTransition] = useTransition();
  const [running, setRunning]     = useState<string | null>(null);

  const BUTTONS: ButtonSpec[] = [
    {
      id:     'tick',
      label:  'Run Tick Now',
      note:   'Rule-based · no LLM · processes all open positions',
      color:  '#d4f25a',
      action: runTickAction,
    },
    {
      id:     'sync',
      label:  'Sync Markets',
      note:   'Pulls latest prices from Polymarket (top 50 by volume)',
      color:  '#60a5fa',
      action: () => syncMarketsAction(50),
    },
    {
      id:     'create',
      label:  'Create Round',
      note:   'Opens 1 new round on the highest-volume active market',
      color:  '#fbbf24',
      action: () => createRoundAction(1),
    },
    {
      id:     'run',
      label:  'Run Round',
      note:   'Calls LLMs · runs all 6 agents on the oldest open round',
      color:  '#f97316',
      action: runLatestRoundAction,
    },
  ];

  function fire(btn: ButtonSpec) {
    if (isPending || running) return;
    setRunning(btn.id);
    startTransition(async () => {
      try {
        const res = await btn.action();
        setResults(prev => ({ ...prev, [btn.id]: res }));
      } catch (err: any) {
        setResults(prev => ({
          ...prev,
          [btn.id]: { ok: false, message: err?.message ?? 'Unexpected error' },
        }));
      } finally {
        setRunning(null);
      }
    });
  }

  return (
    <section style={{ marginBottom: '32px' }}>
      <h2 style={{
        fontSize: '0.78rem', fontWeight: 600, color: '#555',
        letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '12px',
      }}>
        Operator Actions
      </h2>

      {/* Architecture note */}
      <div style={{
        padding: '8px 14px', marginBottom: '14px',
        background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '4px',
        fontSize: '0.68rem', color: '#555', lineHeight: 1.7,
      }}>
        <span style={{ color: '#3a5a1a', fontWeight: 600 }}>TICK (rule-based)</span>
        {' '}stop-loss → scale-out → scale-in → hold — thresholds only, no LLM.{'  '}
        <span style={{ color: '#5a3a1a', fontWeight: 600 }}>RUN ROUND (LLM)</span>
        {' '}one call per agent per round for initial forecast + position entry.
        Cron runs daily at 03:00 UTC (Vercel Hobby limit).
      </div>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        {BUTTONS.map(btn => (
          <div key={btn.id} style={{ flex: '1 1 200px', minWidth: '200px' }}>
            <button
              onClick={() => fire(btn)}
              disabled={isPending || running !== null}
              style={{
                width:         '100%',
                padding:       '10px 16px',
                background:    running === btn.id ? '#1a1a1a' : '#111',
                border:        `1px solid ${running === btn.id ? btn.color : '#2a2a2a'}`,
                borderRadius:  '5px',
                color:         running === btn.id ? btn.color : '#ccc',
                fontWeight:    600,
                fontSize:      '0.82rem',
                cursor:        (isPending || running !== null) ? 'not-allowed' : 'pointer',
                opacity:       (isPending && running !== btn.id) ? 0.4 : 1,
                transition:    'all 0.15s',
                textAlign:     'left',
              }}
            >
              {running === btn.id ? (
                <span>⟳ {btn.label}…</span>
              ) : (
                <span style={{ color: btn.color }}>{btn.label}</span>
              )}
              <div style={{ fontSize: '0.62rem', color: '#555', fontWeight: 400, marginTop: '3px' }}>
                {btn.note}
              </div>
            </button>

            {results[btn.id] && (
              <ResultBanner result={results[btn.id]} />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
