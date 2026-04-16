/**
 * GET /api/forecast/admin/transactions
 * Paper trading ledger.
 */

import { NextRequest, NextResponse } from 'next/server';
import { faSelect } from '@/lib/forecast/db';

export async function GET(request: NextRequest) {
  const password = request.headers.get('x-admin-password');
  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');
    const limit   = Math.min(Number(searchParams.get('limit')) || 100, 500);

    let txQuery = `select=*&order=created_at.desc&limit=${limit}`;
    if (agentId) txQuery += `&agent_id=eq.${agentId}`;

    const [transactions, wallets, agents] = await Promise.all([
      faSelect<any>('fa_transactions', txQuery),
      faSelect<any>('fa_agent_wallets', 'select=*'),
      faSelect<any>('fa_agents', 'select=id,slug,display_name'),
    ]);

    const agentMap = new Map(agents.map((a: any) => [a.id, a]));

    return NextResponse.json({
      transactions,
      wallets: wallets.map((w: any) => ({
        ...w,
        agent: agentMap.get(w.agent_id),
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
