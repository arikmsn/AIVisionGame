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
 *   POST — manually by admin (x-admin-password: $ADMIN_PASSWORD)
 *
 * Vercel Cron schedule: see vercel.json
 */

import { NextRequest, NextResponse } from 'next/server';
import { runTickCycle } from '@/lib/forecast/positions';

export const maxDuration = 300; // 5 min — ticks can be slow if many positions

// ── Auth helpers ──────────────────────────────────────────────────────────────

function authorizeCron(req: NextRequest): boolean {
  // Vercel Cron injects Authorization: Bearer <CRON_SECRET>
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    // If no CRON_SECRET is set, block cron calls
    return false;
  }
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${cronSecret}`;
}

function authorizeAdmin(req: NextRequest): boolean {
  const password = req.headers.get('x-admin-password');
  return !!process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD;
}

// ── GET (Vercel Cron) ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runTickCycle();
    return NextResponse.json({
      ok:        true,
      trigger:   'cron',
      processed: result.processed,
      errors:    result.errors.length,
      summary:   result.results.map(r => ({
        agent:    r.agentSlug,
        market:   r.marketTitle.slice(0, 60),
        action:   r.action,
        pnl:      r.unrealizedPnl.toFixed(2),
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
    const result = await runTickCycle();

    return NextResponse.json({
      ok:        true,
      trigger:   'manual',
      processed: result.processed,
      errors:    result.errors.length,
      errorMessages: result.errors.slice(0, 10),
      results:   result.results.map(r => ({
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
