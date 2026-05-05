/**
 * Pattern C — Calendar Monotonicity scanner.
 *
 * Detects same-question Polymarket markets at different cutoff dates that
 * violate the monotonic-in-time invariant: yes_price(earlier) ≤ yes_price(later).
 *
 * Research mode only — this module returns candidate signals as plain JS
 * objects. It does NOT persist to fa_arb_signals or open positions. The
 * /api/forecast/admin/scan-arb route exposes the output as JSON; daily-cycle
 * additionally writes the candidate list to fa_audit_events for 7-day
 * dry-run analysis.
 *
 * Detection invariant (Pattern C):
 *   For two markets A, B in the same Polymarket event with the same
 *   normalised "core question" and close_time(A) < close_time(B):
 *   the YES probability of B should be ≥ the YES probability of A,
 *   because the longer time horizon contains the shorter one.
 *
 *   Violation = yes_price(A) − yes_price(B) > MIN_EDGE_AFTER_FEES.
 *
 * After-fees minimum edge: a 2-leg trade pays a ~1¢ spread per leg = 2¢
 * floor cost. Require a 4¢ minimum so net EV is comfortably positive.
 */

import { faSelect } from '../db';

// ── Tunables ────────────────────────────────────────────────────────────────

/** Minimum violating gap (in price units) to emit a candidate. 0.04 = 4¢. */
export const MIN_EDGE_AFTER_FEES = 0.04;

/** Minimum 24h volume on each leg to consider it liquid enough. */
export const MIN_LIQUIDITY_USD = 1000;

/** Per-leg spread assumption used to compute net EV. */
export const SPREAD_PCT = 0.01;

// ── Types ───────────────────────────────────────────────────────────────────

export interface ArbScannerMarket {
  id:                 string;
  external_id:        string;
  title:              string;
  event_id:           string | null;
  event_slug:         string | null;
  event_title:        string | null;
  close_time:         string | null;
  current_yes_price:  number | null;
  volume_usd:         number | null;
  status:             string;
}

export interface CalendarPairCandidate {
  pattern_type:           'calendar_monotonic';
  event_id:               string;
  event_title:            string | null;
  core_question:          string;
  /** Earlier-cutoff leg — the over-priced side (we'd buy NO). */
  leg_short:              {
    market_id:        string;
    external_id:      string;
    title:            string;
    close_time:       string;
    yes_price:        number;
    no_price:         number;
    proposed_side:    'no';
    volume_usd:       number;
  };
  /** Later-cutoff leg — the under-priced side (we'd buy YES). */
  leg_long:               {
    market_id:        string;
    external_id:      string;
    title:            string;
    close_time:       string;
    yes_price:        number;
    proposed_side:    'yes';
    volume_usd:       number;
  };
  /** Raw violation in price units (e.g., 0.10 = 10¢). */
  inefficiency:           number;
  /** Net EV per $1 of cost after assumed spread/slippage. */
  ev_after_fees_per_usd:  number;
  /** Min liquidity across both legs. */
  liquidity_score:        number;
  detection_key:          string;
  detected_at:            string;
}

// ── Title normalisation ─────────────────────────────────────────────────────

/**
 * Strip date phrases from a market title so two same-question / different-date
 * markets compare equal. Conservative — only strips formats Polymarket actually
 * uses; anything unrecognised is left in place (leading to a no-match, which
 * is the safe failure mode).
 */
export function normaliseCoreQuestion(title: string): string {
  let t = ` ${title.toLowerCase()} `;

  // "by end of 2026" / "by end of 2027" / "by late 2026"
  t = t.replace(/\bby\s+(?:end\s+of\s+|late\s+|early\s+|mid[- ]|the\s+end\s+of\s+)?\d{4}\b/g, ' ');
  // "by Q1 2026", "by Q4 2027"
  t = t.replace(/\bby\s+q[1-4]\s+\d{4}\b/g, ' ');
  // "by January 2026", "by Dec 2026"
  t = t.replace(/\bby\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4}\b/g, ' ');
  // "by Dec 31, 2026" / "by January 15 2026"
  t = t.replace(/\bby\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/g, ' ');
  // "in 2026", "in 2027"
  t = t.replace(/\bin\s+\d{4}\b/g, ' ');
  // bare year markers like "(2026)" or " 2026 " (be careful — only strip 4-digit
  // years that look like calendar years 20xx).
  t = t.replace(/\b(?:19|20)\d{2}\b/g, ' ');
  // "before [date]" / "after [date]" — keep simple
  t = t.replace(/\bbefore\s+\d{4}\b/g, ' ');

  // Collapse whitespace + trim punctuation
  t = t.replace(/[?.!,;:]+/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

// ── Detection ───────────────────────────────────────────────────────────────

/**
 * Scan all active markets with event linkage and emit Pattern C candidates.
 *
 * Pure function — does NOT write to any DB table. Caller is responsible for
 * persistence (e.g., logging to fa_audit_events for dry-run analysis).
 */
export async function scanCalendarMonotonicity(): Promise<{
  candidates: CalendarPairCandidate[];
  stats: {
    markets_considered:        number;
    events_with_2plus_markets: number;
    core_question_clusters:    number;
    pairs_examined:            number;
    candidates_emitted:        number;
    min_edge_threshold:        number;
    min_liquidity_threshold:   number;
  };
}> {
  // Pull all active markets with event linkage and a price.
  const markets = await faSelect<ArbScannerMarket>(
    'fa_markets',
    'status=eq.active' +
    '&event_id=not.is.null' +
    '&close_time=not.is.null' +
    '&current_yes_price=not.is.null' +
    `&volume_usd=gte.${MIN_LIQUIDITY_USD}` +
    '&select=id,external_id,title,event_id,event_slug,event_title,close_time,current_yes_price,volume_usd,status' +
    '&order=event_id,close_time' +
    '&limit=2000',
  );

  const stats = {
    markets_considered:        markets.length,
    events_with_2plus_markets: 0,
    core_question_clusters:    0,
    pairs_examined:            0,
    candidates_emitted:        0,
    min_edge_threshold:        MIN_EDGE_AFTER_FEES,
    min_liquidity_threshold:   MIN_LIQUIDITY_USD,
  };

  // Group by event_id.
  const byEvent: Record<string, ArbScannerMarket[]> = {};
  for (const m of markets) {
    if (!m.event_id) continue;
    (byEvent[m.event_id] ??= []).push(m);
  }
  stats.events_with_2plus_markets = Object.values(byEvent).filter(g => g.length >= 2).length;

  const candidates: CalendarPairCandidate[] = [];
  const detectedAt = new Date().toISOString();

  for (const [eventId, group] of Object.entries(byEvent)) {
    if (group.length < 2) continue;

    // Within an event, sub-group by normalised core question.
    const byCore: Record<string, ArbScannerMarket[]> = {};
    for (const m of group) {
      const core = normaliseCoreQuestion(m.title);
      if (!core) continue;
      (byCore[core] ??= []).push(m);
    }

    for (const [core, sameQ] of Object.entries(byCore)) {
      if (sameQ.length < 2) continue;
      stats.core_question_clusters++;

      // Sort by close_time ascending.
      sameQ.sort((a, b) => {
        const ta = a.close_time ? Date.parse(a.close_time) : 0;
        const tb = b.close_time ? Date.parse(b.close_time) : 0;
        return ta - tb;
      });

      // Examine consecutive pairs (earlier vs later).
      for (let i = 0; i < sameQ.length - 1; i++) {
        const A = sameQ[i];
        const B = sameQ[i + 1];
        if (A.close_time === B.close_time) continue; // not a calendar pair
        if (A.current_yes_price == null || B.current_yes_price == null) continue;

        stats.pairs_examined++;

        const yesA = Number(A.current_yes_price);
        const yesB = Number(B.current_yes_price);
        const violation = yesA - yesB;
        if (violation <= MIN_EDGE_AFTER_FEES) continue;

        // Net EV per $1 of cost (locked-in worst case):
        //   buy NO of A at (1-yesA), buy YES of B at yesB; cost = (1-yesA) + yesB.
        //   Worst-case payout = $1 (event happens before A or never happens).
        //   net_min_pnl_usd = 1 − cost
        //   per-leg spread cost = SPREAD_PCT × cost
        //   ev_per_usd = (1 − cost − 2·SPREAD_PCT·cost) / cost
        const cost = (1 - yesA) + yesB;
        if (cost <= 0) continue;
        const minPayout = 1;
        const totalSpread = 2 * SPREAD_PCT * cost;
        const evNet = (minPayout - cost - totalSpread) / cost;

        const liquidity = Math.min(
          Number(A.volume_usd ?? 0),
          Number(B.volume_usd ?? 0),
        );

        candidates.push({
          pattern_type:           'calendar_monotonic',
          event_id:               eventId,
          event_title:            A.event_title ?? B.event_title ?? null,
          core_question:          core,
          leg_short: {
            market_id:        A.id,
            external_id:      A.external_id,
            title:            A.title,
            close_time:       A.close_time!,
            yes_price:        yesA,
            no_price:         1 - yesA,
            proposed_side:    'no',
            volume_usd:       Number(A.volume_usd ?? 0),
          },
          leg_long: {
            market_id:        B.id,
            external_id:      B.external_id,
            title:            B.title,
            close_time:       B.close_time!,
            yes_price:        yesB,
            proposed_side:    'yes',
            volume_usd:       Number(B.volume_usd ?? 0),
          },
          inefficiency:           Number(violation.toFixed(4)),
          ev_after_fees_per_usd:  Number(evNet.toFixed(4)),
          liquidity_score:        Number(liquidity.toFixed(2)),
          detection_key:          `C:${eventId}:${A.id}:${B.id}`,
          detected_at:            detectedAt,
        });
        stats.candidates_emitted++;
      }
    }
  }

  // Sort candidates by inefficiency descending (strongest signal first).
  candidates.sort((a, b) => b.inefficiency - a.inefficiency);

  return { candidates, stats };
}
