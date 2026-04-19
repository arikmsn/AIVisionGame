/**
 * POST /api/forecast/admin/seed-agents
 *
 * Upserts fa_agents from the canonical FORECAST_AGENTS config in agents.ts.
 * Idempotent — safe to run repeatedly. Used to push config changes (e.g.
 * new role assignments, display_name updates, prompt_version bumps) to the
 * live DB without a schema migration.
 *
 * Protected by x-admin-password.
 */

import { NextRequest, NextResponse } from 'next/server';
import { agentSeedRows }             from '@/lib/forecast/agents';
import { faUpsert }                  from '@/lib/forecast/db';

export const maxDuration = 30;
export const dynamic    = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (request.headers.get('x-admin-password') !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rows = agentSeedRows();
    const ok   = await faUpsert('fa_agents', rows, 'slug');

    return NextResponse.json({
      ok:    true,
      seeded: rows.length,
      agents: rows.map(r => ({
        slug:           r.slug,
        display_name:   r.display_name,
        prompt_version: r.prompt_version,
        role:           (r.strategy_profile_json as any).role ?? null,
        is_active:      r.is_active,
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}
