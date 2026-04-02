/**
 * Security Guard — HMAC-SHA256 signature verification for external agents.
 *
 * Purpose: Prevent Sybil Attacks where a single actor floods the arena with
 * thousands of fake agents. Each legitimate external agent is issued a secret
 * key; it must sign every payload before submission.
 *
 * All crypto is done via Node's built-in `crypto` module — no external deps.
 *
 * External agent integration:
 *   const sig = signPayload(JSON.stringify(body), process.env.MY_AGENT_SECRET);
 *   fetch('/api/v1/agent/submit', {
 *     headers: { 'X-Agent-Signature': sig, 'X-Agent-ID': 'my-agent-id' },
 *     body: JSON.stringify(body),
 *   });
 */

import { createHmac, timingSafeEqual } from 'crypto';

// ── Core HMAC helpers ────────────────────────────────────────────────────────

/**
 * Sign an arbitrary string payload using HMAC-SHA256.
 * Returns a lowercase hex digest.
 */
export function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

/**
 * Verify a payload against a provided HMAC-SHA256 hex signature.
 * Uses Node's `timingSafeEqual` to prevent timing-based attacks.
 */
export function verifyHmacSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  try {
    const expected = signPayload(payload, secret);
    // Reject immediately if lengths differ (avoids allocation attacks)
    if (expected.length !== signature.length) return false;
    const expectedBuf = Buffer.from(expected, 'hex');
    const sigBuf      = Buffer.from(signature, 'hex');
    // Final buffer lengths must match for timingSafeEqual
    if (expectedBuf.length !== sigBuf.length) return false;
    return timingSafeEqual(expectedBuf, sigBuf);
  } catch {
    return false;
  }
}

// ── Request-level helpers ────────────────────────────────────────────────────

/**
 * Extract X-Agent-ID + X-Agent-Signature headers and verify them.
 * Returns the verified agent ID, or null on failure.
 *
 * The signed payload is `${agentId}:${rawBody}` so the agent ID
 * is also covered by the signature and cannot be spoofed separately.
 */
export function extractVerifiedAgentId(
  headers: Headers,
  rawBody: string,
  secret: string,
): string | null {
  const signature = headers.get('x-agent-signature');
  const agentId   = headers.get('x-agent-id');
  if (!signature || !agentId) return null;
  const valid = verifyHmacSignature(`${agentId}:${rawBody}`, signature, secret);
  return valid ? agentId : null;
}

// ── In-memory token-bucket rate limiter (general / per-minute) ──────────────
// Anchored to globalThis so Turbopack module re-evaluations don't wipe state.
// Production deployments should replace this with a Redis-backed solution.

interface Bucket { tokens: number; lastRefill: number }

declare global {
  var __rateBuckets:     Map<string, Bucket> | undefined;
  var __perRoundBuckets: Map<string, number> | undefined;
}
if (!globalThis.__rateBuckets)     globalThis.__rateBuckets     = new Map();
if (!globalThis.__perRoundBuckets) globalThis.__perRoundBuckets = new Map();

const rateBuckets     = globalThis.__rateBuckets;
const perRoundBuckets = globalThis.__perRoundBuckets;

const BUCKET_CAP = 20;       // max guesses per window (general limiter)
const REFILL_MS  = 60_000;   // 1-minute window

export function checkRateLimit(agentId: string): { allowed: boolean; remaining: number } {
  const now    = Date.now();
  const bucket = rateBuckets.get(agentId) ?? { tokens: BUCKET_CAP, lastRefill: now };

  if (now - bucket.lastRefill >= REFILL_MS) {
    bucket.tokens    = BUCKET_CAP;
    bucket.lastRefill = now;
  }

  if (bucket.tokens <= 0) {
    rateBuckets.set(agentId, bucket);
    return { allowed: false, remaining: 0 };
  }

  bucket.tokens -= 1;
  rateBuckets.set(agentId, bucket);
  return { allowed: true, remaining: bucket.tokens };
}

// ── Per-round attempt limiter (PRD §MAX_ATTEMPTS = 3) ───────────────────────
/**
 * Enforce the PRD rule: each external Agent_ID may submit at most `maxAttempts`
 * guesses per round. The key is `agentId:roundId`, so limits reset automatically
 * when a new round starts (new roundId).
 *
 * @returns `{ allowed, remaining, attemptNumber }` where `attemptNumber` is 1-based.
 */
export function checkPerRoundLimit(
  agentId:     string,
  roundId:     string,
  maxAttempts: number = 3,
): { allowed: boolean; remaining: number; attemptNumber: number } {
  const key  = `${agentId}:${roundId}`;
  const used = perRoundBuckets.get(key) ?? 0;

  if (used >= maxAttempts) {
    return { allowed: false, remaining: 0, attemptNumber: used + 1 };
  }

  const newUsed = used + 1;
  perRoundBuckets.set(key, newUsed);
  return { allowed: true, remaining: maxAttempts - newUsed, attemptNumber: newUsed };
}

/**
 * Wipe all per-round counters — call from reset-session to give a clean slate.
 */
export function clearPerRoundBuckets(): void {
  perRoundBuckets.clear();
}

/**
 * Wipe all general rate-limit buckets — call from reset-session.
 */
export function clearRateBuckets(): void {
  rateBuckets.clear();
}
