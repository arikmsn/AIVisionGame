/**
 * Forecast Arena — Benchmark Harness
 *
 * Answers the question: "Are we actually beating the market / the best
 * single model?"  (Manus blueprint §8.3.)
 *
 * For each domain (+ 'all') and each window, computes Brier & log-loss for:
 *   - market       : uses p_market_at_open from the event
 *   - ensemble     : uses p_system (aggregated) — rows with null p_system excluded
 *   - best_single  : the agent with the lowest Brier across the window
 *   - agent:<slug> : per-agent rows (one per active agent with ≥ 1 event)
 *
 * Results upsert into fa_benchmarks keyed on (computed_day, window, domain, baseline).
 * Same-day reruns overwrite. Cross-day rows accumulate → history chart.
 */

import { faSelect, faUpsert, faInsert } from './db';
import { brierScore, logLoss }          from './scoring';
import { DOMAINS, type Domain }         from './domains';
import { type Window }                   from './calibration';

interface EventRow {
  agent_id:         string;
  domain:           string;
  p_model:          number;
  p_market_at_open: number | null;
  p_system:         number | null;
  outcome:          boolean;
  brier:            number;
  log_loss:         number;
}

interface AgentRow { id: string; slug: string; display_name: string; }

interface Stat { brier: number; log_loss: number; n: number; }

function aggStat(values: Array<{ p: number; outcome: boolean }>): Stat | null {
  if (values.length === 0) return null;
  const b = values.reduce((s, v) => s + brierScore(v.p, v.outcome), 0) / values.length;
  const l = values.reduce((s, v) => s + logLoss(v.p, v.outcome), 0) / values.length;
  return { brier: b, log_loss: l, n: values.length };
}

function windowCutoff(w: Window): string | null {
  if (w === 'all') return null;
  const days = w === '30d' ? 30 : 90;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export async function computeBenchmarks(
  window: Window = '90d',
): Promise<{ window: Window; rows: number; domains: string[]; error?: string }> {
  try {
    const cutoff = windowCutoff(window);
    const filter = cutoff
      ? `resolved_at=gte.${cutoff}&select=agent_id,domain,p_model,p_market_at_open,p_system,outcome,brier,log_loss&limit=50000`
      : `select=agent_id,domain,p_model,p_market_at_open,p_system,outcome,brier,log_loss&limit=50000`;

    const events = await faSelect<EventRow>('fa_calibration_events', filter);
    if (events.length === 0) {
      return { window, rows: 0, domains: [] };
    }

    const agents = await faSelect<AgentRow>('fa_agents', 'select=id,slug,display_name');
    const slugById = new Map(agents.map(a => [a.id, a.slug]));

    const benchmarkRows: Record<string, unknown>[] = [];
    const nowIso = new Date().toISOString();
    const todayDate = nowIso.slice(0, 10);

    const domainsToRun: Array<Domain | 'all'> = [...DOMAINS, 'all'];

    for (const dom of domainsToRun) {
      const domEvents = dom === 'all' ? events : events.filter(e => e.domain === dom);
      if (domEvents.length === 0) continue;

      // ── Market baseline ──────────────────────────────────────────────
      const marketPoints = domEvents
        .filter(e => e.p_market_at_open != null)
        .map(e => ({ p: Number(e.p_market_at_open), outcome: e.outcome }));
      const marketStat = aggStat(marketPoints);
      if (marketStat) {
        benchmarkRows.push({
          computed_at:  nowIso,
          computed_day: todayDate,
          window,
          domain:       dom,
          baseline:     'market',
          baseline_detail: null,
          brier_score:  marketStat.brier,
          log_loss:     marketStat.log_loss,
          n_resolved:   marketStat.n,
        });
      }

      // ── Ensemble baseline (p_system) ─────────────────────────────────
      // De-dupe by round: each submission in the same round has the same
      // p_system, so we only score it once per round. We approximate by
      // filtering one event per distinct (round's) p_system+outcome tuple
      // via agent_id — just use each event; they all share p_system so
      // aggregating them all just increases n proportionally. To avoid
      // inflated n, pick one event per round:
      const seenPerDecision = new Set<string>();
      const ensemblePoints: Array<{ p: number; outcome: boolean }> = [];
      for (const e of domEvents) {
        if (e.p_system == null) continue;
        // Key on (p_system, outcome) proxy — best-effort dedupe since we
        // don't carry round_id in the event projection. Each domain round
        // resolves at one time with one outcome, one p_system.
        const key = `${e.p_system}::${e.outcome}`;
        if (seenPerDecision.has(key)) continue;
        seenPerDecision.add(key);
        ensemblePoints.push({ p: Number(e.p_system), outcome: e.outcome });
      }
      const ensembleStat = aggStat(ensemblePoints);
      if (ensembleStat) {
        benchmarkRows.push({
          computed_at:  nowIso,
          computed_day: todayDate,
          window,
          domain:       dom,
          baseline:     'ensemble',
          baseline_detail: null,
          brier_score:  ensembleStat.brier,
          log_loss:     ensembleStat.log_loss,
          n_resolved:   ensembleStat.n,
        });
      }

      // ── Per-agent + best_single ──────────────────────────────────────
      const perAgent = new Map<string, Stat>();
      const byAgent = new Map<string, Array<{ p: number; outcome: boolean }>>();
      for (const e of domEvents) {
        const arr = byAgent.get(e.agent_id);
        const pt = { p: Number(e.p_model), outcome: e.outcome };
        if (arr) arr.push(pt); else byAgent.set(e.agent_id, [pt]);
      }
      for (const [agentId, pts] of byAgent) {
        const st = aggStat(pts);
        if (!st) continue;
        perAgent.set(agentId, st);
        const slug = slugById.get(agentId) ?? agentId.slice(0, 8);
        benchmarkRows.push({
          computed_at:  nowIso,
          computed_day: todayDate,
          window,
          domain:       dom,
          baseline:     `agent:${slug}`,
          baseline_detail: slug,
          brier_score:  st.brier,
          log_loss:     st.log_loss,
          n_resolved:   st.n,
        });
      }

      // best_single = lowest Brier among agents with ≥ 3 resolutions
      let bestId: string | null = null;
      let bestBrier = Infinity;
      for (const [agentId, st] of perAgent) {
        if (st.n < 3) continue;
        if (st.brier < bestBrier) { bestBrier = st.brier; bestId = agentId; }
      }
      if (bestId) {
        const st = perAgent.get(bestId)!;
        benchmarkRows.push({
          computed_at:  nowIso,
          computed_day: todayDate,
          window,
          domain:       dom,
          baseline:     'best_single',
          baseline_detail: slugById.get(bestId) ?? bestId,
          brier_score:  st.brier,
          log_loss:     st.log_loss,
          n_resolved:   st.n,
        });
      }
    }

    if (benchmarkRows.length > 0) {
      await faUpsert('fa_benchmarks', benchmarkRows, 'computed_day,window,domain,baseline');
    }

    await faInsert('fa_audit_events', [{
      event_type:   'benchmarks_computed',
      entity_type:  'system',
      actor:        'system',
      payload_json: { window, rows: benchmarkRows.length, domains: domainsToRun.length },
    }]).catch(() => {});

    return {
      window,
      rows: benchmarkRows.length,
      domains: domainsToRun.filter(d =>
        benchmarkRows.some(r => (r as any).domain === d),
      ) as string[],
    };
  } catch (err: any) {
    console.error('[FA/BENCH] computeBenchmarks error:', err?.message ?? err);
    return { window, rows: 0, domains: [], error: err?.message ?? String(err) };
  }
}
