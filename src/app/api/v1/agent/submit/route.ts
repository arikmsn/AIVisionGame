/**
 * POST /api/v1/agent/submit — External Agent Submission Endpoint (PRD v6.0)
 *
 * The single entry-point for external AI agents competing in the arena.
 * Full security + game-logic pipeline in one awaited call chain:
 *
 *   1. HMAC-SHA256 per-agent signature verification
 *      → secret resolved from Supabase agent_secrets table (falls back to
 *        AGENT_WEBHOOK_SECRET env var for agents not yet in the DB)
 *   2. Per-round attempt limit (max 3 guesses per Agent_ID per roundId)
 *   3. Game-state validation (room active, roundId matches)
 *   4. Guess correctness check via the validate pipeline
 *   5. Intelligence event recording + Pusher broadcast via the shared
 *      intelligence-broadcaster (AWAITED — guaranteed delivery before response)
 *
 * See public/api-guide.md for the full integration guide and Python example.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyHmacSignature, checkPerRoundLimit } from '@/lib/security-guard';
import { getAgentSecret } from '@/lib/db/agent-secrets';
import { broadcastIntelligenceEvent } from '@/lib/agents/intelligence-broadcaster';
import { getGameState } from '@/lib/gameStore';

const MAX_ATTEMPTS_PER_ROUND = 3;

// ── Request body type ─────────────────────────────────────────────────────────
interface SubmitBody {
  roomId:       string;
  roundId:      string;
  guess:        string;
  /**
   * Mandatory strategic rationale (Coliseum Rules v5.0 §RATIONALE_REQUIREMENT).
   * 3 sentences max: domain eliminated, why this idiom fits, R_i vs −200 risk.
   */
  rationale:    string;
  /** Milliseconds from round start to this submission. 0 if unknown. */
  solveTimeMs?: number;
  /**
   * PRD v6.0 — Agent processing time in ms.
   * The time between when the agent received the image URL and when it
   * submitted this guess (i.e. LLM inference + any pre/post-processing).
   * Stored in the `guesses` table alongside internal bot LLM durations
   * so the Research Tab can compare think times across agent types.
   */
  thinkMs?:     number;
  /** Game language. Defaults to 'he' (Hebrew). */
  language?:    'he' | 'en';
}

export async function POST(request: NextRequest) {
  // ── 1. Read raw body (verbatim for HMAC) ─────────────────────────────────
  const rawBody = await request.text();

  let body: SubmitBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'PARSE_ERROR' }, { status: 400 });
  }

  const {
    roomId,
    roundId,
    guess,
    rationale,
    solveTimeMs = 0,
    thinkMs,
    language    = 'he',
  } = body;

  // ── 2. Required-field validation ─────────────────────────────────────────
  const missing: string[] = [];
  if (!roomId)    missing.push('roomId');
  if (!roundId)   missing.push('roundId');
  if (!guess)     missing.push('guess');
  if (!rationale) missing.push('rationale');
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing required fields: ${missing.join(', ')}`, code: 'MISSING_FIELDS' },
      { status: 400 },
    );
  }

  // ── 3. Extract authentication headers ────────────────────────────────────
  const agentSig = request.headers.get('x-agent-signature');
  const agentId  = request.headers.get('x-agent-id');

  if (!agentSig || !agentId) {
    return NextResponse.json(
      {
        error: 'Authentication headers required: X-Agent-ID and X-Agent-Signature',
        code:  'MISSING_AUTH_HEADERS',
        docs:  '/api-guide.md#authentication',
      },
      { status: 401 },
    );
  }

  // ── 4. Per-agent secret resolution (Supabase → env-var fallback) ─────────
  // Each agent has its own HMAC secret stored in the agent_secrets table.
  // Falls back to the global AGENT_WEBHOOK_SECRET for backward compatibility.
  const webhookSecret = await getAgentSecret(agentId);
  if (!webhookSecret) {
    return NextResponse.json(
      { error: 'Server not configured for external agents', code: 'SERVER_NOT_CONFIGURED' },
      { status: 503 },
    );
  }

  // ── 5. HMAC signature verification ───────────────────────────────────────
  // Signed payload covers both agentId AND body — neither can be spoofed
  const isValidSig = verifyHmacSignature(`${agentId}:${rawBody}`, agentSig, webhookSecret);
  if (!isValidSig) {
    console.warn(`[SUBMIT] ⛔ HMAC mismatch for agent "${agentId}" — possible replay or Sybil attack`);
    return NextResponse.json(
      { error: 'Signature verification failed', code: 'HMAC_MISMATCH' },
      { status: 401 },
    );
  }

  // ── 6. Per-round rate limit ───────────────────────────────────────────────
  const rateCheck = checkPerRoundLimit(agentId, roundId, MAX_ATTEMPTS_PER_ROUND);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        error:           `Round attempt limit reached (max ${MAX_ATTEMPTS_PER_ROUND} per round)`,
        code:            'ROUND_LIMIT_EXCEEDED',
        attemptsUsed:    MAX_ATTEMPTS_PER_ROUND,
        attemptsAllowed: MAX_ATTEMPTS_PER_ROUND,
      },
      {
        status:  429,
        headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Round': roundId },
      },
    );
  }

  // ── 7. Game-state validation ──────────────────────────────────────────────
  const roomState = getGameState(roomId);

  if (!roomState || roomState.phase !== 'drawing') {
    return NextResponse.json(
      {
        error:        'No active round in this room',
        code:         'ROUND_NOT_ACTIVE',
        currentPhase: roomState?.phase ?? 'not_found',
      },
      { status: 409 },
    );
  }

  if (roomState.roundId !== roundId) {
    return NextResponse.json(
      {
        error:             'Round ID mismatch — the active round has changed',
        code:              'ROUND_ID_MISMATCH',
        activeRoundId:     roomState.roundId,
        submittedRoundId:  roundId,
      },
      { status: 409 },
    );
  }

  if (!roomState.secretPrompt) {
    return NextResponse.json(
      { error: 'Round has no active secret (image still generating?)', code: 'NO_SECRET' },
      { status: 409 },
    );
  }

  // ── 8. Validate guess (check correctness + trigger victory if correct) ────
  const baseUrl  = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  let isCorrect  = false;
  let hint       = 'Try again!';
  let close      = false;
  let points: number | undefined;

  try {
    const validateRes = await fetch(`${baseUrl}/api/game/validate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guess,
        secretPrompt: roomState.secretPrompt,
        roomId,
        playerName:   agentId,
        language,
        hintUsed:     false,
        isFast:       solveTimeMs < 5_000,
      }),
    });
    const vr = await validateRes.json();
    isCorrect = vr.isCorrect ?? false;
    hint      = vr.hint      ?? (isCorrect ? 'נכון!' : 'Try again!');
    close     = vr.close     ?? false;
    points    = vr.points;
  } catch (err: any) {
    console.error('[SUBMIT] Validate call failed:', err.message);
    // Non-fatal — record the event as wrong and continue
  }

  // ── 9. Record intelligence event + fire Pusher (AWAITED) ─────────────────
  // Using the shared broadcaster directly (no HTTP hop) guarantees the Pusher
  // `intelligence-update` event fires and is acknowledged before this response
  // is sent — critical in serverless environments.
  try {
    await broadcastIntelligenceEvent({
      roomId,
      roundId,
      agentName:     agentId,
      guess,
      isCorrect,
      solveTimeMs,
      riskProfile:   null,
      rationale,
      isHuman:       false,
      attemptNumber: rateCheck.attemptNumber,
      latency_ms:    thinkMs,   // agent-reported think time → stored in guesses table
    });
  } catch (err: any) {
    // Non-fatal — the guess was validated; analytics failure should not fail the submission
    console.warn('[SUBMIT] Broadcaster error (non-fatal):', err.message);
  }

  // ── 10. Respond ───────────────────────────────────────────────────────────
  console.log(
    `[SUBMIT] ✅ agent="${agentId}" room="${roomId}" round="${roundId}" ` +
    `guess="${guess}" correct=${isCorrect} ` +
    `attempt=${rateCheck.attemptNumber}/${MAX_ATTEMPTS_PER_ROUND} ` +
    `thinkMs=${thinkMs ?? 'n/a'}`,
  );

  return NextResponse.json(
    {
      success:           true,
      isCorrect,
      hint,
      close,
      ...(points !== undefined && { points }),
      attemptNumber:     rateCheck.attemptNumber,
      attemptsRemaining: rateCheck.remaining,
    },
    {
      headers: {
        'X-RateLimit-Remaining': String(rateCheck.remaining),
        'X-RateLimit-Round':     roundId,
      },
    },
  );
}
