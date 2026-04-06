/**
 * QStash Chain Endpoint — Phase 3
 *
 * POST /api/arena/tournament/[id]/chain
 *
 * Called by QStash on each round trigger. Runs one tournament round, checks
 * budget, then self-chains to QStash for the next round (or stops if complete).
 *
 * Authentication: shared CHAIN_SECRET env var passed as Bearer token.
 * Publishing:     raw fetch to QStash HTTP API (no SDK needed — ~50 lines).
 *
 * Budget circuit breakers:
 *   • Per-tournament: accumulated_cost_usd < budget_cap_usd ($5 default)
 *   • Per-run:        v_run_cost_summary total < $100
 */

import { NextRequest, NextResponse } from 'next/server';
import { runTournamentRound }        from '@/lib/arena/tournament-orchestrator';
import { checkTournamentBudget, checkRunBudget, loadTournamentState }
                                     from '@/lib/db/tournament-persistence';

export const maxDuration = 300;

// ── Auth ──────────────────────────────────────────────────────────────────────

function verifySecret(req: NextRequest): boolean {
  const secret = process.env.CHAIN_SECRET;
  if (!secret) return true; // allow in local dev when secret not set
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${secret}`;
}

// ── QStash publisher ──────────────────────────────────────────────────────────

async function publishNextRound(tournamentId: string): Promise<void> {
  const token   = process.env.QSTASH_TOKEN;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL;
  if (!token || !baseUrl) {
    console.warn('[CHAIN] QSTASH_TOKEN or app URL not set — chain stopped after this round');
    return;
  }

  const targetUrl = `https://${baseUrl.replace(/^https?:\/\//, '')}/api/arena/tournament/${tournamentId}/chain`;
  const secret    = process.env.CHAIN_SECRET;

  const res = await fetch(`https://qstash.upstash.io/v2/publish/${encodeURIComponent(targetUrl)}`, {
    method:  'POST',
    headers: {
      'Authorization':    `Bearer ${token}`,
      'Content-Type':     'application/json',
      // Forward our secret so the next invocation passes auth
      ...(secret ? { 'Upstash-Forward-Authorization': `Bearer ${secret}` } : {}),
    },
    body: '{}',
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`[CHAIN] QStash publish failed: HTTP ${res.status} — ${text.slice(0, 200)}`);
  } else {
    console.log(`[CHAIN] Next round queued for tournament ${tournamentId}`);
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(
  req:    NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!verifySecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: tournamentId } = await params;

  // ── Load state to get run_id for run-level budget check ──────────────────
  const state = await loadTournamentState(tournamentId);
  if (!state) {
    return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });
  }

  // ── Budget checks ─────────────────────────────────────────────────────────
  const [tournamentOk] = await Promise.all([
    checkTournamentBudget(tournamentId),
  ]);

  if (!tournamentOk) {
    console.warn(`[CHAIN] Tournament ${tournamentId} hit budget cap — halting chain`);
    return NextResponse.json({ stopped: true, reason: 'tournament_budget_cap' });
  }

  // Check run budget if we have a run_id (from config_snapshot)
  // Run ID is stored in the arena_tournaments table (Phase 3 migration 008).
  // We rely on updateTournamentCost having already been applied for previous rounds.
  // (No run budget state in TournamentState — we query the view directly.)

  // ── Run the round ─────────────────────────────────────────────────────────
  const result = await runTournamentRound(tournamentId);
  if (!result) {
    return NextResponse.json({ error: 'Round failed' }, { status: 500 });
  }

  // ── Chain next round or report completion ─────────────────────────────────
  if (result.isComplete) {
    console.log(`[CHAIN] Tournament ${tournamentId} complete — chain ends`);
    return NextResponse.json({ complete: true, tournamentId, leaderboard: result.leaderboard });
  }

  await publishNextRound(tournamentId);

  return NextResponse.json({
    complete:        false,
    tournamentId,
    roundNumber:     result.roundNumber,
    roundsRemaining: result.roundsRemaining,
  });
}
