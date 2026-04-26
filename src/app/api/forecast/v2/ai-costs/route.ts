/**
 * GET /api/forecast/v2/ai-costs
 *
 * Returns aggregate AI inference cost metrics for the active v2 pilot.
 *
 * Query params:
 *   ?period=24h|7d|all   (default: all)
 *
 * Response:
 * {
 *   period: string,
 *   total_cost_usd: number,
 *   total_calls: number,
 *   by_model: [{ model_id, role, calls, cost_usd }],
 *   by_domain: [{ domain, calls, cost_usd }],
 *   by_day: [{ date, calls, cost_usd }],
 *   pilot_id: string,
 *   generated_at: string,
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { faSelect }                  from '@/lib/forecast/db';
import { getActivePilot }            from '@/lib/forecast/v2/pilot';

function authorizeAdmin(req: NextRequest): boolean {
  return !!process.env.ADMIN_PASSWORD &&
    req.headers.get('x-admin-password') === process.env.ADMIN_PASSWORD;
}

export async function GET(req: NextRequest) {
  // Open to anyone in read — costs are not sensitive. Admin header optional.
  const period  = req.nextUrl.searchParams.get('period') ?? 'all';
  const pilot   = await getActivePilot();
  if (!pilot) return NextResponse.json({ error: 'no active pilot' }, { status: 404 });

  const cutoff = period === '24h'
    ? new Date(Date.now() - 86_400_000).toISOString()
    : period === '7d'
      ? new Date(Date.now() - 7 * 86_400_000).toISOString()
      : null;

  const filter = cutoff
    ? `pilot_id=eq.${pilot.id}&created_at=gte.${cutoff}&select=model_id,role,domain,cost_usd,created_at`
    : `pilot_id=eq.${pilot.id}&select=model_id,role,domain,cost_usd,created_at`;

  let rows: { model_id: string; role: string | null; domain: string | null; cost_usd: number; created_at: string }[] = [];
  try {
    rows = await faSelect<typeof rows[0]>('fa_v2_ai_usage', filter);
  } catch {
    return NextResponse.json({
      error: 'fa_v2_ai_usage table not yet created — apply migration 018 first.',
      sql:   'POST /api/forecast/admin/apply-migration-018 with { supabase_pat: "sbp_..." }',
    }, { status: 503 });
  }

  const totalCost  = rows.reduce((s, r) => s + Number(r.cost_usd), 0);
  const totalCalls = rows.length;

  // by_model
  const modelMap: Record<string, { model_id: string; role: string | null; calls: number; cost_usd: number }> = {};
  for (const r of rows) {
    const k = r.model_id;
    if (!modelMap[k]) modelMap[k] = { model_id: k, role: r.role, calls: 0, cost_usd: 0 };
    modelMap[k].calls++;
    modelMap[k].cost_usd += Number(r.cost_usd);
  }
  const by_model = Object.values(modelMap).sort((a, b) => b.cost_usd - a.cost_usd);

  // by_domain
  const domainMap: Record<string, { domain: string; calls: number; cost_usd: number }> = {};
  for (const r of rows) {
    const k = r.domain ?? 'other';
    if (!domainMap[k]) domainMap[k] = { domain: k, calls: 0, cost_usd: 0 };
    domainMap[k].calls++;
    domainMap[k].cost_usd += Number(r.cost_usd);
  }
  const by_domain = Object.values(domainMap).sort((a, b) => b.cost_usd - a.cost_usd);

  // by_day (ISO date strings)
  const dayMap: Record<string, { date: string; calls: number; cost_usd: number }> = {};
  for (const r of rows) {
    const d = r.created_at.slice(0, 10);
    if (!dayMap[d]) dayMap[d] = { date: d, calls: 0, cost_usd: 0 };
    dayMap[d].calls++;
    dayMap[d].cost_usd += Number(r.cost_usd);
  }
  const by_day = Object.values(dayMap).sort((a, b) => b.date.localeCompare(a.date));

  return NextResponse.json({
    period,
    total_cost_usd: totalCost,
    total_calls:    totalCalls,
    by_model,
    by_domain,
    by_day,
    pilot_id:       pilot.id,
    generated_at:   new Date().toISOString(),
  });
}
