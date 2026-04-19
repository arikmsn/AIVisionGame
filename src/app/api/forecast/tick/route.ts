/**
 * /api/forecast/tick
 *
 * Runs one tick cycle for all open positions:
 *   1. Fetch latest Polymarket prices
 *   2. Run position management rules (scale-in/out, stop-loss, expiry-exit)
 *   3. Write fa_transactions + fa_position_ticks + update fa_positions
 *
 * Called two ways:
 *   GET  — by Vercel Cron (Authorization: Bearer $CRON_SECRET)
 *           Schedule: every 15 minutes — cron: "* /15 * * * *" (no space)
 *   POST — manually by admin (x-admin-password: $ADMIN_PASSWORD)
 *
 * After each run an audit event (event_type='tick_cycle') is written to
 * fa_audit_events so the dashboard System Status card can show last tick time.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runTickCycle }              from '@/lib/forecast/positions';
import { faInsert }                  from '@/lib/forecast/db';

export const maxDuration = 300; // 5 min — ticks can be slow if many positions

// ── Auth helpers ──────────────────────────────────────────────────────────────

function authorizeCron(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return req.headers.get('authorization') === `Bearer ${cronSecret}`;
}

function authorizeAdmin(req: NextRequest): boolean {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return false;
  return req.headers.get('x-admin-password') === password;
}

// ── Shared tick runner ────────────────────────────────────────────────────────

async function executeTick(trigger: 'cron' | 'manual') {
  const result = await runTickCycle();

  // Summarise action counts for the audit payload
  const actionSummary = result.results.reduce<Record<string, number>>((acc, r) => {
    acc[r.action] = (acc[r.action] ?? 0) + 1;
    return acc;
  }, {});

  // Write audit event so the dashboard can track last-tick time
  await faInsert('fa_audit_events', [{
    event_type:   'tick_cycle',
    entity_type:  'system',
    actor:        trigger,
    payload_json: {
      processed: result.processed,
      errors:    result.errors.length,
      actions:   actionSummary,
    },
  }]).catch(() => { /* non-fatal */ });

  return result;
}

// ── GET (Vercel Cron) ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await executeTick('cron');
    return NextResponse.json({
      ok:        true,
      trigger:   'cron',
      processed: result.processed,
      errors:    result.errors.length,
      summary:   result.results.map(r => ({
        agent:  r.agentSlug,
        market: r.marketTitle.slice(0, 60),
        action: r.action,
        pnl:    r.unrealizedPnl.toFixed(2),
      })),
    });
  } catch (err: any) {
    console.error('[API/FORECAST/TICK] Fatal:', err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}

// ── POST (manual admin trigger) ───────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!authorizeAdmin(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await executeTick('manual');
    return NextResponse.json({
      ok:            true,
      trigger:       'manual',
      processed:     result.processed,
      errors:        result.errors.length,
      errorMessages: result.errors.slice(0, 10),
      results:       result.results.map(r => ({
        positionId: r.positionId,
        agent:      r.agentSlug,
        market:     r.marketTitle.slice(0, 80),
        action:     r.action,
        price:      r.priceAtTick,
        unrealized: r.unrealizedPnl.toFixed(4),
        realized:   r.realizedPnl.toFixed(4),
        notes:      r.notes,
      })),
    });
  } catch (err: any) {
    console.error('[API/FORECAST/TICK] Fatal:', err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
