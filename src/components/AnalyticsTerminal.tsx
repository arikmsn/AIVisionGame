'use client';

/**
 * Analytics Terminal — PRD v5.0 Intelligence Dashboard.
 *
 * Four-tab interface:
 *  • FEED     — Live reasoning log: every agent guess with rationale + strategy context
 *  • SCATTER  — Risk/Reward scatter plot: Speed (x) vs Accuracy (y) per agent
 *  • AGENTS   — Per-agent strategy cards with risk profiles, strategy evolution,
 *               and Coliseum Rules v5.0 style adaptation
 *  • RESEARCH — Bayesian Learning Graph, ZLE Log, Improvement Curve, SER Leaderboard
 *
 * Pure presentational component. All data flows in via props from page.tsx
 * which handles the Pusher `intelligence-update` subscription and polls
 * the strategy-profiles endpoint after each round.
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getAgentByName, IntelligenceEvent, RiskProfile } from '@/lib/agents/config';
import { computeSER, serTier } from '@/lib/game/mechanics';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Lightweight summary of server-side StrategyProfile — safe to pass as a prop.
 * Mirrors the shape returned by GET /api/game/strategy-profiles.
 */
export interface StrategyProfileSummary {
  agentName:          string;
  currentStyle:       string;  // 'Aggressive Blitzer' | 'Calculated Observer' | 'Adaptive Opportunist'
  netPayoffRolling:   number;
  streakPositive:     number;
  streakNegative:     number;
  roundsPlayed:       number;
  totalZLEsCommitted: number;
  totalHintsUsed:     number;
  /** Style with the highest average netPayoff across all tracked rounds — null until computed */
  mostEffectiveStyle: string | null;
}

interface AgentStat {
  name: string;
  accentColor: string;
  icon: string;
  wins: number;
  attempts: number;
  /** Average solve time for CORRECT guesses only (ms) */
  avgSolveTimeMs: number;
  /** 0–1, higher = faster (derived from avgSolveTimeMs) */
  speedScore: number;
  /** 0–1, wins/attempts */
  accuracy: number;
  riskProfile: RiskProfile | null;
}

export interface AnalyticsTerminalProps {
  isOpen: boolean;
  onClose: () => void;
  events: IntelligenceEvent[];
  localName: string;
  leaderboard: { player: string; score: number; streak: number }[];
  /** PRD v5.0 — Strategy profiles fetched from /api/game/strategy-profiles */
  strategyProfiles?: StrategyProfileSummary[];
}

type Tab = 'feed' | 'scatter' | 'agents' | 'research';

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_SOLVE_MS = 28_000;

// PRD v5.0 — Prestige tier display metadata
const PRESTIGE_META: Record<string, { icon: string; label: string }> = {
  ELITE:        { icon: '👑', label: 'ELITE'        },
  COMPETITIVE:  { icon: '⚡', label: 'COMPETITIVE'  },
  LEARNING:     { icon: '📈', label: 'LEARNING'     },
  CALIBRATING:  { icon: '🔬', label: 'CALIBRATING'  },
};

// Strategy style shorthand labels for compact display
const STYLE_ABBREV: Record<string, { short: string; color: string; bg: string }> = {
  'Aggressive Blitzer':   { short: 'BLITZ',  color: '#ef4444', bg: 'rgba(239,68,68,0.12)'   },
  'Calculated Observer':  { short: 'CALC',   color: '#06b6d4', bg: 'rgba(6,182,212,0.12)'   },
  'Adaptive Opportunist': { short: 'ADAPT',  color: '#a855f7', bg: 'rgba(168,85,247,0.12)'  },
};

const RISK_META: Record<NonNullable<RiskProfile>, { label: string; color: string; bg: string }> = {
  aggressive: { label: 'AGGR', color: '#ef4444', bg: 'rgba(239,68,68,0.12)'  },
  defensive:  { label: 'DEF',  color: '#06b6d4', bg: 'rgba(6,182,212,0.12)'  },
  balanced:   { label: 'BAL',  color: '#a855f7', bg: 'rgba(168,85,247,0.12)' },
};

// SVG plot geometry
const SVG_W  = 290;
const SVG_H  = 185;
const PAD    = { l: 46, r: 16, t: 12, b: 30 };
const PLOT_W = SVG_W - PAD.l - PAD.r;
const PLOT_H = SVG_H - PAD.t - PAD.b;

// ── Helper: format timestamp as HH:MM:SS ──────────────────────────────────────

function fmtTime(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 8);
}

// ── Compute per-agent statistics from the event feed ─────────────────────────

function computeAgentStats(events: IntelligenceEvent[]): AgentStat[] {
  const map = new Map<string, {
    wins: number; attempts: number; totalWinMs: number; lastProfile: RiskProfile | null;
  }>();

  for (const ev of events) {
    const cur = map.get(ev.agentName) ?? { wins: 0, attempts: 0, totalWinMs: 0, lastProfile: null };
    map.set(ev.agentName, {
      wins:        cur.wins + (ev.isCorrect ? 1 : 0),
      attempts:    cur.attempts + 1,
      totalWinMs:  cur.totalWinMs + (ev.isCorrect ? ev.solveTimeMs : 0),
      lastProfile: ev.riskProfile ?? cur.lastProfile,
    });
  }

  return Array.from(map.entries()).map(([name, s]) => {
    const cfg           = getAgentByName(name);
    const avgSolveTimeMs = s.wins > 0 ? Math.round(s.totalWinMs / s.wins) : 0;
    const speedScore     = avgSolveTimeMs > 0
      ? Math.max(0, Math.min(1, 1 - avgSolveTimeMs / MAX_SOLVE_MS))
      : 0;
    const accuracy = s.attempts > 0 ? s.wins / s.attempts : 0;

    return {
      name,
      accentColor:    cfg?.accentColor ?? '#3B82F6',
      icon:           cfg?.icon        ?? '👤',
      wins:           s.wins,
      attempts:       s.attempts,
      avgSolveTimeMs,
      speedScore,
      accuracy,
      riskProfile:    s.lastProfile,
    };
  });
}

// ── Scatter Plot ──────────────────────────────────────────────────────────────

function ScatterPlot({ stats }: { stats: AgentStat[] }) {
  const plotted = stats.filter(s => s.attempts > 0);

  if (plotted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-2 text-gray-700">
        <div className="flex gap-0.5">{[0,1,2].map(i => (
          <span key={i} className="w-1 h-1 rounded-full bg-cyan-800 inline-block"
            style={{ animation: `typing-bounce 1s ${i * 0.15}s infinite` }} />
        ))}</div>
        <span className="text-xs tracking-widest">AWAITING AGENT DATA</span>
      </div>
    );
  }

  return (
    <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="w-full" style={{ fontFamily: 'monospace' }}>
      {/* Grid */}
      {[0, 0.25, 0.5, 0.75, 1].map(t => {
        const gy = PAD.t + PLOT_H - t * PLOT_H;
        const gx = PAD.l + t * PLOT_W;
        return (
          <g key={t}>
            <line x1={PAD.l} y1={gy} x2={PAD.l + PLOT_W} y2={gy}
              stroke="rgba(6,182,212,0.07)" strokeWidth="1" />
            <text x={PAD.l - 4} y={gy + 3} textAnchor="end" fontSize="6.5" fill="#374151">
              {Math.round(t * 100)}%
            </text>
            <line x1={gx} y1={PAD.t} x2={gx} y2={PAD.t + PLOT_H}
              stroke="rgba(6,182,212,0.07)" strokeWidth="1" />
          </g>
        );
      })}

      {/* Axes */}
      <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={PAD.t + PLOT_H}
        stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
      <line x1={PAD.l} y1={PAD.t + PLOT_H} x2={PAD.l + PLOT_W} y2={PAD.t + PLOT_H}
        stroke="rgba(255,255,255,0.1)" strokeWidth="1" />

      {/* Axis labels */}
      <text
        x={PAD.l - 34} y={PAD.t + PLOT_H / 2}
        textAnchor="middle" fontSize="6.5" fill="#4b5563"
        transform={`rotate(-90, ${PAD.l - 34}, ${PAD.t + PLOT_H / 2})`}
      >ACCURACY %</text>
      <text x={PAD.l + PLOT_W / 2} y={SVG_H - 2}
        textAnchor="middle" fontSize="6.5" fill="#4b5563">SPEED →</text>
      <text x={PAD.l} y={SVG_H - 2} textAnchor="start" fontSize="5.5" fill="#374151">slow</text>
      <text x={PAD.l + PLOT_W} y={SVG_H - 2} textAnchor="end" fontSize="5.5" fill="#374151">fast</text>

      {/* "Ideal zone" marker — top-right */}
      <rect
        x={PAD.l + PLOT_W * 0.65} y={PAD.t}
        width={PLOT_W * 0.35} height={PLOT_H * 0.35}
        fill="rgba(16,185,129,0.03)" stroke="rgba(16,185,129,0.12)"
        strokeWidth="0.5" strokeDasharray="3 3" rx="2"
      />
      <text x={PAD.l + PLOT_W * 0.95} y={PAD.t + 8}
        textAnchor="end" fontSize="5.5" fill="rgba(16,185,129,0.45)">IDEAL</text>

      {/* Agent dots */}
      {plotted.map(stat => {
        const cx = PAD.l + stat.speedScore * PLOT_W;
        const cy = PAD.t + PLOT_H - stat.accuracy * PLOT_H;
        return (
          <g key={stat.name}>
            {/* Outer glow halo */}
            <circle cx={cx} cy={cy} r={12} fill={stat.accentColor} opacity={0.07} />
            {/* Main dot */}
            <circle cx={cx} cy={cy} r={7} fill={stat.accentColor} opacity={0.85}>
              <title>{`${stat.icon} ${stat.name}\nAccuracy: ${Math.round(stat.accuracy * 100)}%\nAvg solve: ${(stat.avgSolveTimeMs / 1000).toFixed(1)}s\nWins: ${stat.wins} / ${stat.attempts}`}</title>
            </circle>
            {/* Icon overlay */}
            <text x={cx} y={cy + 3} textAnchor="middle" fontSize="7">{stat.icon}</text>
            {/* Name label */}
            <text x={cx} y={cy - 11} textAnchor="middle" fontSize="5.5"
              fill={stat.accentColor} opacity={0.85}>
              {stat.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Reasoning Feed ────────────────────────────────────────────────────────────

function ReasoningFeed({
  events,
  feedRef,
}: {
  events: IntelligenceEvent[];
  feedRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [expandedRationale, setExpandedRationale] = useState<Set<number>>(new Set());

  function toggleRationale(idx: number) {
    setExpandedRationale(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-3 text-gray-700 py-8">
        <span className="text-2xl opacity-30">⬡</span>
        <span className="text-xs tracking-widest">NO EVENTS YET — WAITING FOR AGENTS</span>
      </div>
    );
  }

  return (
    <div ref={feedRef} className="flex-1 overflow-y-auto space-y-0.5 pr-1"
      style={{ fontFamily: 'monospace' }}>
      {events.map((ev, i) => {
        const cfg      = getAgentByName(ev.agentName);
        const color    = cfg?.accentColor ?? '#3B82F6';
        const icon     = cfg?.icon        ?? '👤';
        const isLatest = i === events.length - 1;
        const profMeta = ev.riskProfile ? RISK_META[ev.riskProfile] : null;
        const hasRationale = !!ev.rationale;
        const rationaleExpanded = expandedRationale.has(i);
        const rationalePreview  = ev.rationale
          ? (ev.rationale.length > 72 ? ev.rationale.slice(0, 72) + '…' : ev.rationale)
          : null;

        return (
          <div key={`${ev.agentName}-${ev.timestamp}-${i}`}>
            <motion.div
              initial={isLatest ? { opacity: 0, x: -6 } : false}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.18 }}
              className="flex items-start gap-1.5 py-1 px-2 rounded text-[11px] group"
              style={{
                background: isLatest
                  ? `${color}0d`
                  : ev.isCorrect ? 'rgba(16,185,129,0.04)' : 'transparent',
                borderLeft: isLatest ? `2px solid ${color}` : '2px solid transparent',
              }}
            >
              {/* Timestamp */}
              <span className="text-gray-700 flex-shrink-0 text-[10px] mt-0.5">
                {fmtTime(ev.timestamp)}
              </span>

              {/* Agent badge */}
              <span className="flex-shrink-0 text-[11px]" style={{ color }}>{icon}</span>
              <span className="flex-shrink-0 font-bold text-[11px] min-w-[52px]" style={{ color }}>
                {ev.agentName}
              </span>

              {/* Guess + result */}
              <span className="flex-1 min-w-0">
                <span className="text-gray-400">→ </span>
                <span className="text-white" dir="auto">"{ev.guess}"</span>
                {' '}
                {ev.isCorrect ? (
                  <span className="text-emerald-400 font-bold">✓ SOLVED</span>
                ) : (
                  <span className="text-red-500">✗</span>
                )}
              </span>

              {/* Attempt number badge (only for retries) */}
              {ev.attemptNumber && ev.attemptNumber > 1 && (
                <span className="flex-shrink-0 text-[9px] px-1 py-0.5 rounded font-bold"
                  style={{ background: 'rgba(251,191,36,0.12)', color: '#fbbf24' }}>
                  #{ev.attemptNumber}
                </span>
              )}

              {/* Risk profile badge */}
              {profMeta && (
                <span className="flex-shrink-0 text-[9px] px-1 py-0.5 rounded font-bold"
                  style={{ background: profMeta.bg, color: profMeta.color }}>
                  {profMeta.label}
                </span>
              )}

              {/* Solve time */}
              {ev.solveTimeMs > 0 && (
                <span className="flex-shrink-0 text-gray-700 text-[10px]">
                  {(ev.solveTimeMs / 1000).toFixed(1)}s
                </span>
              )}

              {/* Agent think time / LLM latency (PRD v6.0 telemetry) */}
              {ev.latency_ms != null && ev.latency_ms > 0 && (
                <span
                  className="flex-shrink-0 text-[9px] px-1 py-0.5 rounded font-mono"
                  title="Agent think time (LLM call duration for bots · processing time for external agents)"
                  style={{ background: 'rgba(139,92,246,0.12)', color: '#a78bfa' }}
                >
                  ⚡{ev.latency_ms >= 1000
                    ? `${(ev.latency_ms / 1000).toFixed(1)}s`
                    : `${ev.latency_ms}ms`}
                </span>
              )}

              {/* Rationale expand toggle */}
              {hasRationale && (
                <button
                  onClick={() => toggleRationale(i)}
                  className="flex-shrink-0 text-[9px] px-1 py-0.5 rounded transition-colors"
                  style={{
                    background: rationaleExpanded ? 'rgba(251,191,36,0.18)' : 'rgba(251,191,36,0.07)',
                    color: '#fbbf24',
                    border: '1px solid rgba(251,191,36,0.22)',
                  }}
                  title="Toggle strategic rationale"
                >
                  {rationaleExpanded ? '▲' : '▼'} WHY
                </button>
              )}

              {/* Pruned cluster (collapsed, shown on row hover) */}
              {!ev.isCorrect && ev.semanticCluster.length > 0 && (
                <span className="flex-shrink-0 text-gray-800 text-[9px] group-hover:text-gray-600 transition-colors"
                  title={`Pruned: ${ev.semanticCluster.join(', ')}`}>
                  ⊘
                </span>
              )}
            </motion.div>

            {/* PRD v5.0 — Rationale row (collapsed by default, expand on click) */}
            {hasRationale && (
              <AnimatePresence>
                {(rationaleExpanded || isLatest) && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden"
                  >
                    <div
                      className="mx-2 mb-1 px-2 py-1.5 rounded text-[10px] leading-relaxed"
                      style={{
                        background: 'rgba(251,191,36,0.05)',
                        border: '1px solid rgba(251,191,36,0.14)',
                        color: '#d4a853',
                        fontFamily: 'monospace',
                        fontStyle: 'italic',
                        borderLeft: `2px solid rgba(251,191,36,0.35)`,
                      }}
                    >
                      <span className="not-italic font-bold text-[9px] text-yellow-600 tracking-widest mr-1.5">
                        RATIONALE
                      </span>
                      {rationaleExpanded ? ev.rationale : rationalePreview}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Agent Strategy Cards ─────────────────────────────────────────────────────

function AgentCards({
  stats,
  strategyProfiles = [],
  events,
}: {
  stats: AgentStat[];
  strategyProfiles?: StrategyProfileSummary[];
  events: IntelligenceEvent[];
}) {
  if (stats.length === 0) {
    return (
      <div className="flex items-center justify-center flex-1 text-gray-700 text-xs py-8 tracking-widest">
        NO AGENTS ACTIVE YET
      </div>
    );
  }

  // Build a ZLE rate map from client-side events for fallback display
  const zleRateMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const stat of stats) {
      const agentEvs = events.filter(e => e.agentName === stat.name);
      const zleCount = agentEvs.filter(e => e.zeroLearning).length;
      map.set(stat.name, agentEvs.length > 0 ? zleCount / agentEvs.length : 0);
    }
    return map;
  }, [stats, events]);

  return (
    <div className="space-y-2 overflow-y-auto flex-1">
      {stats.map(stat => {
        const profMeta    = stat.riskProfile ? RISK_META[stat.riskProfile] : null;
        const accuracyPct = Math.round(stat.accuracy * 100);
        const avgS        = (stat.avgSolveTimeMs / 1000).toFixed(1);
        const cfg         = getAgentByName(stat.name);
        const profile     = strategyProfiles.find(p => p.agentName === stat.name);
        const styleData   = profile ? (STYLE_ABBREV[profile.currentStyle] ?? null) : null;
        const zleRate     = zleRateMap.get(stat.name) ?? 0;
        const payoffColor = profile && profile.netPayoffRolling >= 0 ? '#34d399' : '#f87171';

        return (
          <div key={stat.name}
            className="rounded-xl p-3"
            style={{
              background: `${stat.accentColor}08`,
              border: `1px solid ${stat.accentColor}28`,
            }}
          >
            {/* Header row */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xl" style={{ filter: `drop-shadow(0 0 5px ${stat.accentColor})` }}>
                  {stat.icon}
                </span>
                <div>
                  <div className="text-sm font-bold" style={{ color: stat.accentColor, fontFamily: 'monospace' }}>
                    {stat.name}
                  </div>
                  {cfg && (
                    <div className="text-[10px] text-gray-600 truncate max-w-[140px]">{cfg.description}</div>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                {profMeta && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold"
                    style={{ background: profMeta.bg, color: profMeta.color, fontFamily: 'monospace' }}>
                    {profMeta.label}
                  </span>
                )}
                {/* PRD v5.0 — Current strategy style badge */}
                {styleData && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold"
                    style={{ background: styleData.bg, color: styleData.color, fontFamily: 'monospace' }}>
                    {styleData.short}
                  </span>
                )}
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: 'WINS',     value: stat.wins },
                { label: 'ACCURACY', value: `${accuracyPct}%` },
                { label: 'AVG TIME', value: stat.wins > 0 ? `${avgS}s` : '—' },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg py-1.5"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="text-[10px] text-gray-600 tracking-wider">{label}</div>
                  <div className="text-sm font-bold text-white mt-0.5">{value}</div>
                </div>
              ))}
            </div>

            {/* Accuracy bar */}
            <div className="mt-2 h-1 rounded-full overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.05)' }}>
              <motion.div className="h-full rounded-full"
                style={{ background: stat.accentColor }}
                initial={{ width: 0 }}
                animate={{ width: `${accuracyPct}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
              />
            </div>

            {/* PRD v5.0 — Strategy Evolution Panel */}
            {profile ? (
              <div className="mt-2 pt-2 space-y-1.5"
                style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="text-[9px] text-gray-600 tracking-widest" style={{ fontFamily: 'monospace' }}>
                  STRATEGY EVOLUTION
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                  {/* Style */}
                  <div className="flex items-center gap-1">
                    <span className="text-gray-600">Style:</span>
                    <span style={{ color: styleData?.color ?? '#9ca3af', fontFamily: 'monospace' }}>
                      {profile.currentStyle}
                    </span>
                  </div>
                  {/* Net payoff */}
                  <div className="flex items-center gap-1">
                    <span className="text-gray-600">Payoff:</span>
                    <span style={{ color: payoffColor, fontFamily: 'monospace' }}>
                      {profile.netPayoffRolling >= 0 ? '+' : ''}{Math.round(profile.netPayoffRolling)}
                    </span>
                  </div>
                  {/* Streak */}
                  <div className="flex items-center gap-1">
                    <span className="text-gray-600">Streak:</span>
                    {profile.streakPositive > 0 ? (
                      <span className="text-emerald-400 font-bold" style={{ fontFamily: 'monospace' }}>
                        ↑{profile.streakPositive}W
                      </span>
                    ) : profile.streakNegative > 0 ? (
                      <span className="text-red-400 font-bold" style={{ fontFamily: 'monospace' }}>
                        ↓{profile.streakNegative}L
                      </span>
                    ) : (
                      <span className="text-gray-600" style={{ fontFamily: 'monospace' }}>—</span>
                    )}
                  </div>
                  {/* ZLE rate */}
                  <div className="flex items-center gap-1">
                    <span className="text-gray-600">ZLE rate:</span>
                    <span style={{
                      fontFamily: 'monospace',
                      color: profile.totalZLEsCommitted > 0 ? '#f87171' : '#34d399',
                    }}>
                      {profile.roundsPlayed > 0
                        ? `${(profile.totalZLEsCommitted / profile.roundsPlayed).toFixed(2)}/rnd`
                        : '0.00/rnd'}
                    </span>
                  </div>
                </div>
                {/* Streak indicator warning */}
                {profile.streakNegative >= 2 && (
                  <div className="text-[9px] px-1.5 py-0.5 rounded text-center font-bold"
                    style={{
                      background: 'rgba(239,68,68,0.08)',
                      color: '#f87171',
                      border: '1px solid rgba(239,68,68,0.2)',
                      fontFamily: 'monospace',
                    }}>
                    ⚠ STYLE PIVOT TRIGGERED — {profile.streakNegative} CONSECUTIVE LOSSES
                  </div>
                )}
              </div>
            ) : (
              /* Fallback: derive ZLE rate from events when server profile not available */
              zleRate > 0 && (
                <div className="mt-2 pt-2 flex items-center gap-1.5 text-[10px]"
                  style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <span className="text-gray-600">ZLE rate:</span>
                  <span style={{ color: '#f87171', fontFamily: 'monospace' }}>
                    {(zleRate * 100).toFixed(0)}% of guesses
                  </span>
                </div>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Improvement Curve ─────────────────────────────────────────────────────────

/**
 * Bar chart: success rate per attempt number (attempt 1, 2, 3).
 * Answers: "Does giving agents more tries actually improve win rate?"
 * Shows grouped bars per agent, one group per attempt number.
 */
function ImprovementCurve({ events }: { events: IntelligenceEvent[] }) {
  const maxAttempts = 3;

  // For each (agentName, attemptNumber): { successes, total }
  interface AttemptBucket { successes: number; total: number }
  const buckets = new Map<string, AttemptBucket>();  // key = `${name}::${attempt}`

  for (const ev of events) {
    if (!ev.attemptNumber) continue;
    const k   = `${ev.agentName}::${ev.attemptNumber}`;
    const cur = buckets.get(k) ?? { successes: 0, total: 0 };
    buckets.set(k, {
      successes: cur.successes + (ev.isCorrect ? 1 : 0),
      total:     cur.total + 1,
    });
  }

  const agentNames = [...new Set(events.filter(e => e.attemptNumber).map(e => e.agentName))];
  const hasData    = agentNames.length > 0 && buckets.size > 0;

  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center h-24 gap-2 text-gray-700">
        <span className="text-xs tracking-widest">IMPROVEMENT CURVE REQUIRES MULTI-ATTEMPT DATA</span>
      </div>
    );
  }

  const barH     = 80;
  const barW     = 18;
  const groupGap = 10;
  const agentGap = 4;
  const padL     = 24;
  const padB     = 20;
  const padT     = 8;

  const totalWidth = padL + maxAttempts * (agentNames.length * (barW + agentGap) + groupGap) + 16;
  const svgH       = barH + padT + padB;

  // Colors per attempt: attempt 1 = muted, attempt 2 = mid, attempt 3 = bright
  const attemptAlpha = ['0.40', '0.65', '0.90'];

  return (
    <svg viewBox={`0 0 ${totalWidth} ${svgH}`} className="w-full" style={{ fontFamily: 'monospace' }}>
      {/* Y-axis grid */}
      {[0, 0.5, 1].map(t => {
        const gy = padT + barH - t * barH;
        return (
          <g key={t}>
            <line x1={padL} y1={gy} x2={totalWidth - 8} y2={gy}
              stroke="rgba(6,182,212,0.07)" strokeWidth="0.8" />
            <text x={padL - 3} y={gy + 3} textAnchor="end" fontSize="6" fill="#374151">
              {Math.round(t * 100)}%
            </text>
          </g>
        );
      })}

      {/* Bars */}
      {Array.from({ length: maxAttempts }, (_, ai) => {
        const attempt   = ai + 1;
        const groupX    = padL + ai * (agentNames.length * (barW + agentGap) + groupGap);
        return (
          <g key={attempt}>
            {/* Attempt label */}
            <text
              x={groupX + (agentNames.length * (barW + agentGap)) / 2}
              y={svgH - 4}
              textAnchor="middle" fontSize="6.5" fill="#4b5563"
            >
              ATT #{attempt}
            </text>
            {agentNames.map((name, ni) => {
              const cfg    = getAgentByName(name);
              const color  = cfg?.accentColor ?? '#3B82F6';
              const bk     = `${name}::${attempt}`;
              const bucket = buckets.get(bk) ?? { successes: 0, total: 0 };
              const rate   = bucket.total > 0 ? bucket.successes / bucket.total : 0;
              const bx     = groupX + ni * (barW + agentGap);
              const bh     = Math.max(2, Math.round(rate * barH));
              const by     = padT + barH - bh;

              return (
                <g key={name}>
                  <rect x={bx} y={by} width={barW} height={bh} rx="2"
                    fill={color} opacity={parseFloat(attemptAlpha[ai])}>
                    <title>{`${name} attempt ${attempt}: ${bucket.successes}/${bucket.total} (${Math.round(rate * 100)}%)`}</title>
                  </rect>
                  {/* Rate label */}
                  {bucket.total > 0 && (
                    <text x={bx + barW / 2} y={by - 2} textAnchor="middle" fontSize="5.5" fill={color} opacity={0.8}>
                      {Math.round(rate * 100)}%
                    </text>
                  )}
                  {/* Agent icon */}
                  <text x={bx + barW / 2} y={svgH - padB + 10} textAnchor="middle" fontSize="7">
                    {cfg?.icon ?? '👤'}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}

      {/* Y-axis */}
      <line x1={padL} y1={padT} x2={padL} y2={padT + barH}
        stroke="rgba(255,255,255,0.08)" strokeWidth="0.8" />
      <text x={padL - 20} y={padT + barH / 2} textAnchor="middle" fontSize="5.5" fill="#4b5563"
        transform={`rotate(-90, ${padL - 20}, ${padT + barH / 2})`}>WIN %</text>
    </svg>
  );
}

// ── Bayesian Learning Graph ────────────────────────────────────────────────────

/**
 * SVG line chart: cumulative pruned concepts per agent over event sequence.
 * Each line shows how fast an agent "learns" from the round's failure history.
 */
function BayesianLearningGraph({ events }: { events: IntelligenceEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-36 gap-2 text-gray-700">
        <span className="text-2xl opacity-20">∿</span>
        <span className="text-xs tracking-widest">AWAITING ROUND DATA</span>
      </div>
    );
  }

  // Build per-agent cumulative pruned-concept curves
  // For each agent, at each event index: how many concepts from events *before*
  // this one overlap with the agent's own guesses? (measures ZLE exposure)
  const agentNames = [...new Set(events.map(e => e.agentName))];
  const W = 258, H = 120;
  const padL = 28, padB = 18, padT = 8, padR = 8;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = events.length;

  // For each agent: array of (eventIndex → cumulative pruned count seen so far in feed)
  const curves: Array<{ name: string; color: string; points: [number, number][] }> = agentNames.map(name => {
    const cfg = getAgentByName(name);
    const color = cfg?.accentColor ?? '#3B82F6';
    const points: [number, number][] = [];
    let cumPruned = 0;
    const seenClusters = new Set<string>();
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (!ev.isCorrect) {
        ev.semanticCluster.forEach(c => seenClusters.add(c));
      }
      // Exposure for this agent: how many pruned concepts are in the global set at event i
      // We count it as the global pruned-set size — same for all agents per event
      cumPruned = seenClusters.size;
      // Agent's line: increments only on events BEFORE theirs (knowledge they should have had)
      if (ev.agentName === name) {
        points.push([i, cumPruned]);
      }
    }
    if (points.length === 0) points.push([0, 0]);
    return { name, color, points };
  });

  // Y max = total unique pruned concepts across all events
  const allClusters = new Set(events.filter(e => !e.isCorrect).flatMap(e => e.semanticCluster));
  const yMax = Math.max(1, allClusters.size);

  function toSvg(evIdx: number, pruned: number): [number, number] {
    const x = padL + (n <= 1 ? plotW / 2 : (evIdx / (n - 1)) * plotW);
    const y = padT + plotH - (pruned / yMax) * plotH;
    return [x, y];
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ fontFamily: 'monospace' }}>
      {/* Grid lines */}
      {[0, 0.5, 1].map(t => {
        const gy = padT + plotH - t * plotH;
        return (
          <g key={t}>
            <line x1={padL} y1={gy} x2={padL + plotW} y2={gy}
              stroke="rgba(6,182,212,0.07)" strokeWidth="0.8" />
            <text x={padL - 3} y={gy + 3} textAnchor="end" fontSize="6" fill="#374151">
              {Math.round(t * yMax)}
            </text>
          </g>
        );
      })}
      {/* Axes */}
      <line x1={padL} y1={padT} x2={padL} y2={padT + plotH}
        stroke="rgba(255,255,255,0.08)" strokeWidth="0.8" />
      <line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH}
        stroke="rgba(255,255,255,0.08)" strokeWidth="0.8" />
      <text x={padL - 24} y={padT + plotH / 2} textAnchor="middle" fontSize="5.5" fill="#4b5563"
        transform={`rotate(-90, ${padL - 24}, ${padT + plotH / 2})`}>PRUNED</text>
      <text x={padL + plotW / 2} y={H - 2} textAnchor="middle" fontSize="5.5" fill="#4b5563">EVENT →</text>

      {/* Curves */}
      {curves.map(({ name, color, points }) => {
        if (points.length < 1) return null;
        const pathPts = points.map(([ei, p]) => toSvg(ei, p));
        const d = pathPts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
        return (
          <g key={name}>
            <path d={d} fill="none" stroke={color} strokeWidth="1.5" opacity={0.7} strokeLinecap="round" strokeLinejoin="round" />
            {pathPts.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={2} fill={color} opacity={0.9}>
                <title>{`${name} @ event ${points[i][0]+1}: ${points[i][1]} pruned`}</title>
              </circle>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

// ── Zero-Learning Event Log ────────────────────────────────────────────────────

function ZLELog({ events }: { events: IntelligenceEvent[] }) {
  const zleEvents = events.filter(e => e.zeroLearning);

  return (
    <div className="space-y-0.5 overflow-y-auto flex-1" style={{ maxHeight: 110 }}>
      {zleEvents.length === 0 ? (
        <div className="text-center py-3 text-gray-700 text-xs tracking-widest">
          NO ZERO-LEARNING EVENTS — AGENTS ARE PRUNING CORRECTLY
        </div>
      ) : (
        zleEvents.map((ev, i) => {
          const cfg = getAgentByName(ev.agentName);
          const color = cfg?.accentColor ?? '#ef4444';
          return (
            <div key={`${ev.agentName}-${ev.timestamp}-${i}`}
              className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px]"
              style={{
                background: 'rgba(239,68,68,0.07)',
                border: '1px solid rgba(239,68,68,0.18)',
                fontFamily: 'monospace',
              }}
            >
              <span className="text-red-500 font-bold flex-shrink-0">ZLE</span>
              <span style={{ color }} className="flex-shrink-0 font-bold">{cfg?.icon ?? '⚠'} {ev.agentName}</span>
              <span className="text-gray-500 flex-shrink-0">→</span>
              <span className="text-gray-400 truncate" dir="auto">"{ev.guess}"</span>
              <span className="text-gray-700 text-[9px] flex-shrink-0 ml-auto">
                {(ev.solveTimeMs / 1000).toFixed(1)}s
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}

// ── SER Leaderboard ────────────────────────────────────────────────────────────

function SERLeaderboard({ stats }: { stats: AgentStat[] }) {
  // Compute SER from stat data
  const serStats = stats
    .map(s => {
      const failedAttempts = s.attempts - s.wins;
      const ser  = computeSER(s.wins, s.avgSolveTimeMs * s.wins, failedAttempts);
      const tier = serTier(ser);
      const prestige = PRESTIGE_META[tier.label] ?? { icon: '🔬', label: tier.label };
      return { ...s, ser, tier, prestige };
    })
    .sort((a, b) => b.ser - a.ser);

  if (serStats.length === 0) {
    return (
      <div className="text-center py-3 text-gray-700 text-xs tracking-widest">
        SER REQUIRES AT LEAST ONE COMPLETED ROUND
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {serStats.map((s, i) => (
        <div key={s.name} className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
          style={{
            background: i === 0 ? `${s.tier.color}0a` : `${s.accentColor}08`,
            border: `1px solid ${i === 0 ? s.tier.color + '30' : s.accentColor + '22'}`,
            boxShadow: i === 0 ? `0 0 12px ${s.tier.color}12` : undefined,
          }}
        >
          <span className="text-gray-600 text-[11px] font-bold w-4 flex-shrink-0">#{i + 1}</span>
          <span style={{ color: s.accentColor }}>{s.icon}</span>
          <span className="text-[11px] font-bold flex-1" style={{ color: s.accentColor, fontFamily: 'monospace' }}>
            {s.name}
          </span>

          {/* PRD v5.0 — Prestige tier badge with icon */}
          <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-bold"
            style={{
              background: `${s.tier.color}1a`,
              color: s.tier.color,
              fontFamily: 'monospace',
              border: `1px solid ${s.tier.color}30`,
            }}>
            <span>{s.prestige.icon}</span>
            <span>{s.prestige.label}</span>
          </span>

          <span className="text-[11px] font-bold text-white font-mono flex-shrink-0">
            {s.ser.toFixed(5)}
          </span>
        </div>
      ))}

      {/* Prestige tier legend */}
      <div className="mt-2 pt-2 space-y-1" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="text-[9px] text-gray-700 tracking-wider text-center" style={{ fontFamily: 'monospace' }}>
          SER = wins / (Σlatency_s × Σfailed)
        </div>
        <div className="flex justify-center gap-2 flex-wrap">
          {[
            { label: 'ELITE',       icon: '👑', threshold: '≥0.050', color: '#fbbf24' },
            { label: 'COMPETITIVE', icon: '⚡', threshold: '≥0.020', color: '#06b6d4' },
            { label: 'LEARNING',    icon: '📈', threshold: '≥0.005', color: '#a855f7' },
            { label: 'CALIBRATING', icon: '🔬', threshold: '<0.005', color: '#4b5563' },
          ].map(t => (
            <div key={t.label} className="flex items-center gap-0.5 text-[9px]"
              style={{ color: t.color, fontFamily: 'monospace' }}>
              <span>{t.icon}</span>
              <span>{t.label}</span>
              <span className="text-gray-700 ml-0.5">{t.threshold}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Research Tab ──────────────────────────────────────────────────────────────

function ResearchTab({ events, stats }: { events: IntelligenceEvent[]; stats: AgentStat[] }) {
  const zleCount = events.filter(e => e.zeroLearning).length;

  return (
    <div className="flex flex-col gap-3 overflow-y-auto flex-1">
      {/* Bayesian Learning Graph */}
      <div>
        <div className="text-[9px] text-gray-600 tracking-widest mb-1" style={{ fontFamily: 'monospace' }}>
          BAYESIAN LEARNING GRAPH — PRUNED CONCEPT ACCUMULATION
        </div>
        <div className="rounded-xl p-2" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <BayesianLearningGraph events={events} />
          {/* Curve legend */}
          <div className="flex flex-wrap gap-2 mt-1 justify-center">
            {[...new Set(events.map(e => e.agentName))].map(name => {
              const cfg = getAgentByName(name);
              return (
                <div key={name} className="flex items-center gap-1 text-[9px]" style={{ fontFamily: 'monospace' }}>
                  <span style={{ color: cfg?.accentColor ?? '#3B82F6' }}>■</span>
                  <span style={{ color: cfg?.accentColor ?? '#3B82F6' }}>{name}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ZLE Log */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[9px] text-gray-600 tracking-widest" style={{ fontFamily: 'monospace' }}>
            ZERO-LEARNING EVENTS
          </span>
          {zleCount > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded font-bold"
              style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', fontFamily: 'monospace' }}>
              {zleCount} ZLE
            </span>
          )}
        </div>
        <div className="rounded-xl p-2" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <ZLELog events={events} />
        </div>
      </div>

      {/* Improvement Curve */}
      <div>
        <div className="text-[9px] text-gray-600 tracking-widest mb-1" style={{ fontFamily: 'monospace' }}>
          IMPROVEMENT CURVE — WIN RATE BY ATTEMPT NUMBER
        </div>
        <div className="rounded-xl p-2" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <ImprovementCurve events={events} />
        </div>
      </div>

      {/* SER Leaderboard */}
      <div>
        <div className="text-[9px] text-gray-600 tracking-widest mb-1" style={{ fontFamily: 'monospace' }}>
          STRATEGIC EFFICIENCY RATIO — GLOBAL RANK
        </div>
        <SERLeaderboard stats={stats} />
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'feed',     label: 'FEED',     icon: '⬡' },
  { id: 'scatter',  label: 'SCATTER',  icon: '◎' },
  { id: 'agents',   label: 'AGENTS',   icon: '⬢' },
  { id: 'research', label: 'RESEARCH', icon: '∿' },
];

export function AnalyticsTerminal({ isOpen, onClose, events, localName, leaderboard, strategyProfiles = [] }: AnalyticsTerminalProps) {
  const [activeTab, setActiveTab] = useState<Tab>('feed');
  const feedRef = useRef<HTMLDivElement>(null);

  const agentStats = useMemo(() => computeAgentStats(events), [events]);

  // Auto-scroll feed when new events arrive
  useEffect(() => {
    if (activeTab === 'feed' && feedRef.current) {
      const el = feedRef.current;
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      if (isNearBottom) el.scrollTop = el.scrollHeight;
    }
  }, [events.length, activeTab]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, x: 320 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 320 }}
          transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          className="fixed right-0 top-0 h-full w-80 z-40 flex flex-col"
          style={{
            background: 'rgba(5,5,16,0.97)',
            backdropFilter: 'blur(32px)',
            borderLeft: '1px solid rgba(6,182,212,0.14)',
            boxShadow: '-8px 0 40px rgba(0,0,0,0.6)',
          }}
        >
          {/* ── Header ── */}
          <div className="flex items-center justify-between px-4 py-3 flex-shrink-0"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-2">
              <span className="text-cyan-400 text-base">⬡</span>
              <div>
                <div className="text-xs font-bold tracking-widest text-white uppercase" style={{ fontFamily: 'monospace' }}>
                  Intelligence Terminal
                </div>
                <div className="text-[10px] text-gray-600 tracking-wider" style={{ fontFamily: 'monospace' }}>
                  {events.length} events · {agentStats.length} agents
                </div>
              </div>
              {/* Live pulse */}
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse ml-1"
                style={{ boxShadow: '0 0 6px #06b6d4' }} />
            </div>
            <button onClick={onClose}
              className="text-gray-600 hover:text-gray-300 transition-colors text-lg leading-none px-1">
              ×
            </button>
          </div>

          {/* ── Tab bar ── */}
          <div className="flex flex-shrink-0"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex-1 py-2 text-[11px] font-bold tracking-widest transition-all"
                style={{
                  fontFamily: 'monospace',
                  color: activeTab === tab.id ? '#06b6d4' : '#4b5563',
                  borderBottom: activeTab === tab.id ? '1px solid #06b6d4' : '1px solid transparent',
                  background: activeTab === tab.id ? 'rgba(6,182,212,0.05)' : 'transparent',
                }}
              >
                <span className="mr-1 text-[10px]">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── Tab content ── */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden p-3">
            {activeTab === 'feed' && (
              <ReasoningFeed events={events} feedRef={feedRef} />
            )}
            {activeTab === 'scatter' && (
              <div className="flex-1 flex flex-col">
                <div className="text-[10px] text-gray-700 mb-2 tracking-widest text-center" style={{ fontFamily: 'monospace' }}>
                  SPEED × ACCURACY — CURRENT SESSION
                </div>
                <div className="rounded-xl p-2" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <ScatterPlot stats={agentStats} />
                </div>
                {/* Legend */}
                <div className="mt-3 flex flex-col gap-1">
                  {agentStats.map(s => (
                    <div key={s.name} className="flex items-center gap-2 text-[11px]">
                      <span style={{ color: s.accentColor }}>{s.icon} {s.name}</span>
                      <span className="text-gray-700 ml-auto">
                        {Math.round(s.accuracy * 100)}% acc · {s.wins > 0 ? `${(s.avgSolveTimeMs / 1000).toFixed(1)}s avg` : 'no wins'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {activeTab === 'agents' && (
              <AgentCards stats={agentStats} strategyProfiles={strategyProfiles} events={events} />
            )}
            {activeTab === 'research' && (
              <ResearchTab events={events} stats={agentStats} />
            )}
          </div>

          {/* ── Footer: pruned concepts ── */}
          {(() => {
            const failed   = events.filter(e => !e.isCorrect);
            const concepts = [...new Set(failed.flatMap(e => e.semanticCluster))].slice(0, 8);
            if (concepts.length === 0) return null;
            return (
              <div className="px-3 py-2 flex-shrink-0"
                style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                <div className="text-[9px] text-gray-700 mb-1 tracking-widest" style={{ fontFamily: 'monospace' }}>
                  PRUNED SEMANTIC CLUSTERS
                </div>
                <div className="flex flex-wrap gap-1">
                  {concepts.map(c => (
                    <span key={c} className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{
                        background: 'rgba(239,68,68,0.08)',
                        border: '1px solid rgba(239,68,68,0.22)',
                        color: '#f87171',
                        fontFamily: 'monospace',
                        textDecoration: 'line-through',
                      }}
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
