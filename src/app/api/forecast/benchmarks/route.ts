/**
 * /api/forecast/benchmarks
 *
 *   GET   → returns the latest benchmark row per (domain, baseline) for a window.
 *            Public read (diagnostic only).
 *   POST  → recomputes benchmarks on-demand. Protected by x-admin-password.
 */

import { NextRequest, NextResponse } from 'next/server';
import { faSelect }        from '@/lib/forecast/db';
import { computeBenchmarks } from '@/lib/forecast/benchmarks';

export const maxDuration = 60;

interface BenchmarkRow {
  id:               string;
  computed_at:      string;
  computed_day:     string;
  window:           string;
  domain:           string;
  baseline:         string;
  baseline_detail:  string | null;
  brier_score:      number | null;
  log_loss:         number | null;
  n_resolved:       number;
}

export async function GET(request: NextRequest) {
  const window = request.nextUrl.searchParams.get('window') ?? '90d';
  try {
    const rows = await faSelect<BenchmarkRow>(
      'fa_benchmarks',
      `window=eq.${window}&order=computed_at.desc&limit=2000&select=*`,
    );

    // Keep only most-recent row per (domain, baseline)
    const seen = new Set<string>();
    const latest: BenchmarkRow[] = [];
    for (const r of rows) {
      const key = `${r.domain}::${r.baseline}`;
      if (seen.has(key)) continue;
      seen.add(key);
      latest.push(r);
    }

    return NextResponse.json({ ok: true, window, count: latest.length, rows: latest });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (request.headers.get('x-admin-password') !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const window = (body as { window?: '30d' | '90d' | 'all' }).window ?? '90d';
    const result = await computeBenchmarks(window);
    return NextResponse.json({ ok: !result.error, ...result });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
