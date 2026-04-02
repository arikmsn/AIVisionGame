/**
 * Strategy Profiles API — PRD v5.0
 *
 * Returns all in-memory StrategyProfile records so the Analytics Terminal
 * can render the AGENTS tab with live strategy evolution data.
 *
 * GET /api/game/strategy-profiles
 *   Returns: { profiles: StrategyProfile[] }
 *
 * This endpoint is read-only and unauthenticated — the data is advisory
 * analytics, not game-critical state. Profile updates happen server-side
 * via runPostRoundReview() in the orchestrate-bots route.
 */

import { NextResponse } from 'next/server';
import { getAllStrategyProfiles } from '@/lib/agents/strategy-profile';

export async function GET() {
  try {
    const profiles = getAllStrategyProfiles();
    return NextResponse.json({ profiles });
  } catch (err: any) {
    console.error('[STRATEGY-PROFILES] Error:', err.message);
    return NextResponse.json({ profiles: [] });
  }
}
