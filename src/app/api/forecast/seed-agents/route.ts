/**
 * POST /api/forecast/seed-agents
 *
 * Upserts the 6 core league agents + 4 legacy (disabled) agents.
 * Creates paper wallets for any agent that doesn't have one.
 * Idempotent — safe to call multiple times.
 * Protected by ADMIN_PASSWORD header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { faUpsert, faInsert, faSelect } from '@/lib/forecast/db';
import { agentSeedRows, CORE_FORECAST_AGENTS, LEGACY_FORECAST_AGENTS } from '@/lib/forecast/agents';

export async function POST(request: NextRequest) {
  const password = request.headers.get('x-admin-password');
  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rows = agentSeedRows();
    const ok   = await faUpsert('fa_agents', rows, 'slug');

    if (!ok) {
      return NextResponse.json({ error: 'Failed to upsert agents' }, { status: 500 });
    }

    // Create wallets for agents that don't have one yet
    const agents  = await faSelect<{ id: string; slug: string; is_active: boolean }>(
      'fa_agents', 'select=id,slug,is_active',
    );
    const wallets = await faSelect<{ agent_id: string }>('fa_agent_wallets', 'select=agent_id');
    const hasWallet = new Set(wallets.map(w => w.agent_id));

    const newWallets = agents
      .filter(a => !hasWallet.has(a.id))
      .map(a => ({ agent_id: a.id }));

    if (newWallets.length > 0) {
      await faInsert('fa_agent_wallets', newWallets);
    }

    const core   = agents.filter(a => a.is_active);
    const legacy = agents.filter(a => !a.is_active);

    return NextResponse.json({
      ok: true,
      core_league: core.map(a => a.slug),
      legacy_disabled: legacy.map(a => a.slug),
      wallets_created: newWallets.length,
    });
  } catch (err: any) {
    console.error('[API/FORECAST/SEED] Error:', err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
