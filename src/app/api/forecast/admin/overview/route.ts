/**
 * GET /api/forecast/admin/overview
 * Dashboard stats for the Forecast Arena admin.
 */

import { NextRequest, NextResponse } from 'next/server';
import { faSelect } from '@/lib/forecast/db';

export async function GET(request: NextRequest) {
  const password = request.headers.get('x-admin-password');
  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [markets, rounds, submissions, agents, scores, syncJobs] = await Promise.all([
      faSelect<any>('fa_markets', 'select=id,status'),
      faSelect<any>('fa_rounds', 'select=id,status,opened_at'),
      faSelect<any>('fa_submissions', 'select=id,cost_usd,error_text,submitted_at'),
      faSelect<any>('fa_agents', 'select=id,slug,is_active'),
      faSelect<any>('fa_scores', 'select=id,brier_score'),
      faSelect<any>('fa_sync_jobs', 'select=id,status,completed_at&order=started_at.desc&limit=5'),
    ]);

    const activeMarkets   = markets.filter((m: any) => m.status === 'active').length;
    const totalMarkets    = markets.length;
    const openRounds      = rounds.filter((r: any) => r.status === 'open').length;
    const completedRounds = rounds.filter((r: any) => r.status === 'completed' || r.status === 'resolved').length;
    const totalSubmissions = submissions.length;
    const errorSubmissions = submissions.filter((s: any) => s.error_text).length;
    const totalCost       = submissions.reduce((acc: number, s: any) => acc + (Number(s.cost_usd) || 0), 0);
    const avgBrier        = scores.length > 0
      ? scores.reduce((acc: number, s: any) => acc + (Number(s.brier_score) || 0), 0) / scores.length
      : null;

    // Rounds today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const roundsToday = rounds.filter((r: any) =>
      new Date(r.opened_at) >= todayStart,
    ).length;

    return NextResponse.json({
      activeMarkets,
      totalMarkets,
      openRounds,
      completedRounds,
      totalRounds:      rounds.length,
      roundsToday,
      totalSubmissions,
      errorSubmissions,
      errorRate:        totalSubmissions > 0 ? (errorSubmissions / totalSubmissions * 100).toFixed(1) : '0',
      totalCostUsd:     totalCost,
      scoredSubmissions: scores.length,
      avgBrierScore:    avgBrier,
      activeAgents:     agents.filter((a: any) => a.is_active).length,
      recentSyncJobs:   syncJobs,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
