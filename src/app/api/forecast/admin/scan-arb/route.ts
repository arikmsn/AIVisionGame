/**
 * GET /api/forecast/admin/scan-arb
 *
 * Pattern C — Calendar Monotonicity scanner. RESEARCH MODE ONLY.
 *
 * Returns the candidate list as JSON. Does NOT persist signals or open
 * positions. Daily-cycle additionally logs results to fa_audit_events for
 * 7-day dry-run analysis; this endpoint is for ad-hoc inspection.
 *
 * Auth: x-admin-password header.
 *
 * Example response:
 *   {
 *     ok: true,
 *     stats: { markets_considered: 120, candidates_emitted: 3, ... },
 *     candidates: [{ pattern_type: 'calendar_monotonic', ... }, ...]
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { scanCalendarMonotonicity }   from '@/lib/forecast/arb/scanner';

export const maxDuration = 60;
export const dynamic    = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (request.headers.get('x-admin-password') !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { candidates, stats } = await scanCalendarMonotonicity();
    return NextResponse.json({
      ok:        true,
      mode:      'research',
      persisted: false,
      stats,
      candidates,
    });
  } catch (err: any) {
    return NextResponse.json({
      error: err?.message ?? String(err),
    }, { status: 500 });
  }
}
