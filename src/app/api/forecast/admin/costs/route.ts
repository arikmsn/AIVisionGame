/**
 * GET /api/forecast/admin/costs
 * Cost/usage data aggregated by agent and model.
 */

import { NextRequest, NextResponse } from 'next/server';
import { faSelect } from '@/lib/forecast/db';

export async function GET(request: NextRequest) {
  const password = request.headers.get('x-admin-password');
  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get all submissions with agent info
    const submissions = await faSelect<any>(
      'fa_submissions',
      'select=agent_id,cost_usd,input_tokens,output_tokens,latency_ms,submitted_at,error_text&order=submitted_at.desc&limit=500',
    );
    const agents = await faSelect<any>('fa_agents', 'select=id,slug,display_name,model_id,provider');

    const agentMap = new Map(agents.map((a: any) => [a.id, a]));

    // Aggregate by agent
    const byAgent: Record<string, {
      slug: string; display_name: string; model_id: string; provider: string;
      total_cost: number; total_input: number; total_output: number;
      avg_latency: number; call_count: number; error_count: number;
    }> = {};

    for (const sub of submissions) {
      const agent = agentMap.get(sub.agent_id);
      if (!agent) continue;
      const key = agent.slug;
      if (!byAgent[key]) {
        byAgent[key] = {
          slug: agent.slug,
          display_name: agent.display_name,
          model_id: agent.model_id,
          provider: agent.provider,
          total_cost: 0,
          total_input: 0,
          total_output: 0,
          avg_latency: 0,
          call_count: 0,
          error_count: 0,
        };
      }
      byAgent[key].total_cost   += Number(sub.cost_usd) || 0;
      byAgent[key].total_input  += Number(sub.input_tokens) || 0;
      byAgent[key].total_output += Number(sub.output_tokens) || 0;
      byAgent[key].avg_latency  += Number(sub.latency_ms) || 0;
      byAgent[key].call_count   += 1;
      if (sub.error_text) byAgent[key].error_count += 1;
    }

    // Finalize averages
    for (const v of Object.values(byAgent)) {
      if (v.call_count > 0) v.avg_latency = Math.round(v.avg_latency / v.call_count);
    }

    const totalCost = Object.values(byAgent).reduce((s, v) => s + v.total_cost, 0);

    return NextResponse.json({
      totalCostUsd: totalCost,
      totalCalls:   submissions.length,
      byAgent:      Object.values(byAgent),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
