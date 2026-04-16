/**
 * POST /api/forecast/seed-agents
 *
 * Seeds the 4 forecast agents into fa_agents table.
 * Also creates wallets. Idempotent via upsert on slug.
 * Protected by ADMIN_PASSWORD header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { faUpsert, faInsert, faSelect } from '@/lib/forecast/db';
import { agentSeedRows } from '@/lib/forecast/agents';

export async function POST(request: NextRequest) {
  const password = request.headers.get('x-admin-password');
  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rows = agentSeedRows();
    const ok = await faUpsert('fa_agents', rows, 'slug');

    if (!ok) {
      return NextResponse.json({ error: 'Failed to seed agents' }, { status: 500 });
    }

    // Create wallets for agents that don't have one
    const agents = await faSelect<{ id: string; slug: string }>('fa_agents', 'select=id,slug');
    const wallets = await faSelect<{ agent_id: string }>('fa_agent_wallets', 'select=agent_id');
    const existingWalletAgents = new Set(wallets.map(w => w.agent_id));

    const newWallets = agents
      .filter(a => !existingWalletAgents.has(a.id))
      .map(a => ({ agent_id: a.id }));

    if (newWallets.length > 0) {
      await faInsert('fa_agent_wallets', newWallets);
    }

    return NextResponse.json({
      ok: true,
      agents: agents.map(a => a.slug),
      walletsCreated: newWallets.length,
    });
  } catch (err: any) {
    console.error('[API/FORECAST/SEED] Error:', err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
