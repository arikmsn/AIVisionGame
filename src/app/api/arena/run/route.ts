/**
 * Run Launcher — Phase 3
 *
 * POST /api/arena/run
 *
 * Creates N tournaments sharing a run_id, then kicks off the first round of
 * each via QStash. Subsequent rounds self-chain automatically.
 *
 * Body (all optional):
 *   tournaments  — number of tournaments in this run (default 2)
 *   rounds       — rounds per tournament (default 20)
 *   budgetCapUsd — per-tournament spend cap (default 5.00)
 *
 * Returns:
 *   { run_id, tournament_ids, queued }
 *
 * Security: requires same CHAIN_SECRET bearer token as the chain endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';
import { startTournament }           from '@/lib/arena/tournament-orchestrator';

export const maxDuration = 30;

// ── Auth ──────────────────────────────────────────────────────────────────────

function verifySecret(req: NextRequest): boolean {
  const secret = process.env.CHAIN_SECRET;
  if (!secret) return true;
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${secret}`;
}

// ── QStash kick-off ───────────────────────────────────────────────────────────

async function kickOffChain(tournamentId: string): Promise<boolean> {
  const token   = process.env.QSTASH_TOKEN;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL;
  if (!token || !baseUrl) {
    console.warn('[RUN] QSTASH_TOKEN or app URL not set — chain not started');
    return false;
  }

  const targetUrl = `https://${baseUrl.replace(/^https?:\/\//, '')}/api/arena/tournament/${tournamentId}/chain`;
  const secret    = process.env.CHAIN_SECRET;

  console.log(`[RUN] QStash target: ${targetUrl} | token_present=${!!token}`);

  const res = await fetch(`https://qstash.upstash.io/v2/publish/${targetUrl}`, {
    method:  'POST',
    headers: {
      'Authorization':    `Bearer ${token}`,
      'Content-Type':     'application/json',
      ...(secret ? { 'Upstash-Forward-Authorization': `Bearer ${secret}` } : {}),
    },
    body:   '{}',
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`[RUN] QStash kick-off FAILED for ${tournamentId}: HTTP ${res.status} — ${text}`);
    return false;
  }
  const body = await res.json().catch(() => null);
  console.log(`[RUN] QStash kick-off OK for ${tournamentId}: messageId=${body?.messageId ?? '?'}`);
  return true;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifySecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as {
    tournaments?:  number;
    rounds?:       number;
    budgetCapUsd?: number;
  };

  const numTournaments = Math.min(body.tournaments ?? 2, 10);  // cap at 10 per request
  const totalRounds    = body.rounds       ?? 20;
  const budgetCapUsd   = body.budgetCapUsd ?? 5.00;
  const runId          = crypto.randomUUID();

  console.log(
    `[RUN] Starting run ${runId} | ${numTournaments} tournaments | ` +
    `${totalRounds} rounds each | $${budgetCapUsd}/tournament cap`,
  );

  const tournamentIds: string[] = [];
  const failures: string[]      = [];

  // Create all tournaments first (they're fast — just DB inserts)
  for (let i = 0; i < numTournaments; i++) {
    const startResult = await startTournament({ totalRounds, runId, budgetCapUsd });
    if (!startResult) {
      console.error(`[RUN] Failed to create tournament ${i + 1}/${numTournaments}`);
      failures.push(`tournament_${i + 1}_create_failed`);
      continue;
    }
    tournamentIds.push(startResult.tournamentId);
    console.log(`[RUN] Created tournament ${i + 1}/${numTournaments}: ${startResult.tournamentId}`);
  }

  if (tournamentIds.length === 0) {
    return NextResponse.json({ error: 'All tournament creates failed' }, { status: 500 });
  }

  // Kick off chain for each tournament
  let queued = 0;
  for (const id of tournamentIds) {
    const ok = await kickOffChain(id);
    if (ok) queued++;
    else failures.push(`${id}_chain_not_started`);
  }

  console.log(`[RUN] Run ${runId} launched | ${queued}/${tournamentIds.length} chains queued`);

  return NextResponse.json({
    run_id:         runId,
    tournament_ids: tournamentIds,
    queued,
    failures:       failures.length > 0 ? failures : undefined,
  });
}
