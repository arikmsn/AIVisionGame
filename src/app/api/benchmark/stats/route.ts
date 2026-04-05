/**
 * GET /api/benchmark/stats
 *
 * Aggregates all benchmark_results rows and returns:
 *   - leaderboard   — models ranked by success rate
 *   - speedKing     — model with the lowest average latency (non-error runs only)
 *   - hardestIdioms — idioms failed by the most models (by fail rate)
 *   - totals        — global run + correct counts
 *
 * Aggregation is done in-process from a single Supabase fetch (≤ 5000 rows).
 * When Supabase is not configured, returns empty-but-valid payload so the UI
 * can render a "no data yet" state gracefully.
 */

import { NextResponse } from 'next/server';
import { fetchAllBenchmarkResults } from '@/lib/db/benchmark-results';
import { BENCHMARK_AGENTS }        from '@/lib/agents/dispatcher';

export const maxDuration = 30;
export const revalidate  = 0; // never cache — stats should always be fresh

// Build a lookup map from modelId → { label, icon, accentColor }
const AGENT_META = Object.fromEntries(
  BENCHMARK_AGENTS.map(a => [a.modelId, { label: a.label, icon: a.icon, accentColor: a.accentColor }]),
);

export async function GET() {
  const rows = await fetchAllBenchmarkResults(5000);

  if (rows.length === 0) {
    return NextResponse.json({
      leaderboard:   [],
      speedKing:     null,
      hardestIdioms: [],
      totalRuns:     0,
      totalCorrect:  0,
    });
  }

  // ── Per-model aggregation ────────────────────────────────────────────────────

  const modelMap = new Map<string, {
    total:       number;
    correct:     number;
    errorCount:  number;
    latencies:   number[]; // only from non-error runs
  }>();

  for (const row of rows) {
    if (!modelMap.has(row.model_id)) {
      modelMap.set(row.model_id, { total: 0, correct: 0, errorCount: 0, latencies: [] });
    }
    const m = modelMap.get(row.model_id)!;
    m.total++;
    if (row.is_correct) m.correct++;
    if (row.error)      m.errorCount++;
    else if (row.latency_ms !== null) m.latencies.push(row.latency_ms);
  }

  const leaderboard = [...modelMap.entries()]
    .map(([modelId, m]) => {
      const meta         = AGENT_META[modelId];
      const successRate  = m.total > 0 ? (m.correct / m.total) * 100 : 0;
      const avgLatencyMs = m.latencies.length > 0
        ? Math.round(m.latencies.reduce((a, b) => a + b, 0) / m.latencies.length)
        : null;
      const reliabilityRate = m.total > 0
        ? ((m.total - m.errorCount) / m.total) * 100
        : 100;

      return {
        modelId,
        label:           meta?.label         ?? modelId,
        icon:            meta?.icon          ?? '🤖',
        accentColor:     meta?.accentColor   ?? '#6b7280',
        totalRuns:       m.total,
        correctCount:    m.correct,
        successRate:     Math.round(successRate * 10) / 10,  // 1 dp
        avgLatencyMs,
        errorCount:      m.errorCount,
        reliabilityRate: Math.round(reliabilityRate * 10) / 10,
      };
    })
    // Sort: primary = successRate desc, secondary = avgLatency asc (faster = better tie-break)
    .sort((a, b) => {
      if (b.successRate !== a.successRate) return b.successRate - a.successRate;
      const la = a.avgLatencyMs ?? Infinity;
      const lb = b.avgLatencyMs ?? Infinity;
      return la - lb;
    });

  // ── Speed King (model with lowest avg latency, ≥ 3 non-error runs) ───────────

  const speedKing = leaderboard
    .filter(m => m.avgLatencyMs !== null && (m.totalRuns - m.errorCount) >= 3)
    .sort((a, b) => (a.avgLatencyMs ?? Infinity) - (b.avgLatencyMs ?? Infinity))[0] ?? null;

  // ── Hardest Idioms ────────────────────────────────────────────────────────────
  // Count how many models guessed WRONG (non-error attempt + is_correct=false).
  // Exclude: errors, key-missing rows (they didn't really attempt the idiom).

  const idiomMap = new Map<string, { attempts: number; failures: number }>();

  for (const row of rows) {
    if (row.error) continue; // skip error/key-missing rows
    if (!idiomMap.has(row.idiom_phrase)) {
      idiomMap.set(row.idiom_phrase, { attempts: 0, failures: 0 });
    }
    const e = idiomMap.get(row.idiom_phrase)!;
    e.attempts++;
    if (!row.is_correct) e.failures++;
  }

  const hardestIdioms = [...idiomMap.entries()]
    .filter(([, e]) => e.attempts >= 2) // need at least 2 real attempts to rank
    .map(([phrase, e]) => ({
      phrase,
      failCount:    e.failures,
      totalAttempts: e.attempts,
      failRate:     Math.round((e.failures / e.attempts) * 100),
    }))
    .sort((a, b) => b.failRate - a.failRate || b.failCount - a.failCount)
    .slice(0, 8);

  // ── Totals ────────────────────────────────────────────────────────────────────

  const totalRuns    = rows.length;
  const totalCorrect = rows.filter(r => r.is_correct).length;

  return NextResponse.json({
    leaderboard,
    speedKing: speedKing
      ? { modelId: speedKing.modelId, label: speedKing.label, icon: speedKing.icon, avgLatencyMs: speedKing.avgLatencyMs }
      : null,
    hardestIdioms,
    totalRuns,
    totalCorrect,
  });
}
