/**
 * GET  /api/forecast/light-cycle  ← Vercel Cron  (Authorization: Bearer $CRON_SECRET)
 * POST /api/forecast/light-cycle  ← manual admin  (x-admin-password: $ADMIN_PASSWORD)
 *
 * Light cycle — runs several times per day between full daily cycles.
 * Steps:
 *   1. Check daily limit (max_light_cycles_per_day from fa_experiment_config)
 *   2. Check capital constraints (skip new entries when bankroll < $500)
 *   3. Sync top-50 markets
 *   4. Re-score markets using cached news counts (zero extra API calls)
 *   5. For each selected market: run agents ONLY if YES price moved >= threshold
 *
 * Does NOT call any LLMs for position management — only for decision rounds
 * on markets that qualify (price moved enough + capital available).
 *
 * Schedule (vercel.json): 0 1,5,9,13,17,21 * * *  (6× per day)
 */

import { NextRequest, NextResponse } from 'next/server';
import { runLightCycle }             from '@/lib/forecast/light-cycle';

export const maxDuration = 300; // 5 min — agent calls can be slow

// ── Auth ──────────────────────────────────────────────────────────────────────

function authorizeCron(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return req.headers.get('authorization') === `Bearer ${cronSecret}`;
}

function authorizeAdmin(req: NextRequest): boolean {
  return !!process.env.ADMIN_PASSWORD &&
    req.headers.get('x-admin-password') === process.env.ADMIN_PASSWORD;
}

// ── Handlers ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const result = await runLightCycle('cron');
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  if (!authorizeAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const result = await runLightCycle('manual');
  return NextResponse.json(result);
}
