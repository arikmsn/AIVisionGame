'use client';

import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AgentConfig, IntelligenceEvent } from '@/lib/agents/config';
import type { StrategyProfileSummary } from '@/components/AnalyticsTerminal';

interface AgentStatusCardProps {
  agent: AgentConfig;
  /** All intelligence events (component filters by agent + current round) */
  events: IntelligenceEvent[];
  /** True when a `bot-typing` Pusher event is active for this agent */
  isTyping: boolean;
  /** Current strategy profile from /api/game/strategy-profiles */
  strategyProfile?: StrategyProfileSummary;
  /** Active round ID — used to scope attempt counter to the current round */
  currentRoundId?: string;
}

// Style labels + colors for each strategy class
const STYLE_META: Record<string, { label: string; bg: string; color: string; border: string }> = {
  'Aggressive Blitzer': {
    label: 'BLITZ',
    bg: 'rgba(239,68,68,0.12)',
    color: '#f87171',
    border: 'rgba(239,68,68,0.3)',
  },
  'Calculated Observer': {
    label: 'CALC',
    bg: 'rgba(59,130,246,0.12)',
    color: '#93c5fd',
    border: 'rgba(59,130,246,0.3)',
  },
  'Adaptive Opportunist': {
    label: 'ADAPT',
    bg: 'rgba(168,85,247,0.12)',
    color: '#c4b5fd',
    border: 'rgba(168,85,247,0.3)',
  },
};

/**
 * Live Agent Status Card — semi-transparent overlay panel.
 * Shows: agent name + icon, strategy style badge, latest rationale,
 * last guess result, per-round attempt dots, and think-time latency.
 */
export function AgentStatusCard({
  agent,
  events,
  isTyping,
  strategyProfile,
  currentRoundId,
}: AgentStatusCardProps) {
  // Latest event for this agent (most recent regardless of round)
  const latestEvent = useMemo(
    () => events.filter((e) => e.agentName === agent.name).slice(-1)[0],
    [events, agent.name],
  );

  // How many attempts this agent has made in the current round
  const roundAttempts = useMemo(() => {
    const rid = currentRoundId ?? latestEvent?.roundId;
    if (!rid) return 0;
    return events.filter((e) => e.agentName === agent.name && e.roundId === rid).length;
  }, [events, agent.name, currentRoundId, latestEvent]);

  const styleMeta = strategyProfile?.currentStyle
    ? (STYLE_META[strategyProfile.currentStyle] ?? {
        label: strategyProfile.currentStyle.slice(0, 5).toUpperCase(),
        bg: 'rgba(255,255,255,0.07)',
        color: '#9ca3af',
        border: 'rgba(255,255,255,0.15)',
      })
    : null;

  return (
    <div className="h-full flex flex-col gap-2 p-3 overflow-hidden">
      {/* ── Agent header ─────────────────────────────────────────────────── */}
      <div
        className="rounded-xl p-3 flex-shrink-0"
        style={{
          background: `${agent.accentColor}0c`,
          border: `1px solid ${agent.accentColor}28`,
          backdropFilter: 'blur(20px)',
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          {/* Icon */}
          <span
            className="text-xl flex-shrink-0"
            style={{ filter: `drop-shadow(0 0 5px ${agent.accentColor})` }}
          >
            {agent.icon}
          </span>

          {/* Name + description */}
          <div className="flex-1 min-w-0">
            <div
              className="font-bold text-sm truncate leading-tight"
              style={{
                color: agent.accentColor,
                fontFamily: 'monospace',
                textShadow: `0 0 8px ${agent.accentColor}55`,
              }}
            >
              {agent.name}
            </div>
            <div className="text-[10px] text-gray-600 truncate leading-tight mt-0.5">
              {agent.description}
            </div>
          </div>

          {/* Live / typing indicator */}
          <div className="flex-shrink-0">
            <AnimatePresence mode="wait">
              {isTyping ? (
                <motion.div
                  key="typing"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="flex gap-0.5 items-center px-1.5 py-1 rounded-full"
                  style={{
                    background: `${agent.accentColor}18`,
                    border: `1px solid ${agent.accentColor}40`,
                  }}
                >
                  {[0, 1, 2].map((j) => (
                    <span
                      key={j}
                      className="w-1 h-1 rounded-full inline-block typing-dot"
                      style={{ background: agent.accentColor }}
                    />
                  ))}
                </motion.div>
              ) : (
                <motion.span
                  key="live"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="w-2 h-2 rounded-full block status-dot-live"
                  style={{
                    background: agent.accentColor,
                    boxShadow: `0 0 5px ${agent.accentColor}`,
                  }}
                />
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Strategy style badge */}
        {styleMeta && (
          <div
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold tracking-[0.15em]"
            style={{
              background: styleMeta.bg,
              color: styleMeta.color,
              border: `1px solid ${styleMeta.border}`,
            }}
          >
            {styleMeta.label}
          </div>
        )}
      </div>

      {/* ── Latest guess ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {latestEvent && (
          <motion.div
            key={latestEvent.timestamp}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl p-3 flex-shrink-0"
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.07)',
              backdropFilter: 'blur(16px)',
            }}
          >
            <div className="text-[9px] text-gray-600 uppercase tracking-[0.15em] mb-1.5">
              Last Guess
            </div>

            {/* Guess + result */}
            <div className="flex items-center gap-2 mb-2">
              <span
                className="font-bold text-sm text-white flex-1 truncate"
                style={{ fontFamily: 'monospace', direction: 'rtl', unicodeBidi: 'embed' }}
              >
                {latestEvent.guess}
              </span>
              <span
                className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold"
                style={{
                  background: latestEvent.isCorrect
                    ? 'rgba(16,185,129,0.18)'
                    : 'rgba(239,68,68,0.18)',
                  color: latestEvent.isCorrect ? '#6ee7b7' : '#f87171',
                }}
              >
                {latestEvent.isCorrect ? '✓' : '✗'}
              </span>
            </div>

            {/* Attempt dots (3 max per round) */}
            <div className="flex items-center gap-1.5">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className="w-2 h-2 rounded-full transition-all duration-300"
                  style={{
                    background:
                      n <= roundAttempts
                        ? latestEvent.isCorrect && n === roundAttempts
                          ? '#10b981'
                          : `${agent.accentColor}80`
                        : 'rgba(255,255,255,0.08)',
                    border:
                      n <= roundAttempts
                        ? 'none'
                        : '1px solid rgba(255,255,255,0.1)',
                    boxShadow:
                      n <= roundAttempts && latestEvent.isCorrect && n === roundAttempts
                        ? '0 0 5px #10b981'
                        : 'none',
                  }}
                />
              ))}
              <span className="text-[9px] text-gray-700 ml-0.5">
                {roundAttempts}/3
              </span>

              {/* Latency badge */}
              {latestEvent.latency_ms != null && latestEvent.latency_ms > 0 && (
                <span
                  className="ml-auto text-[9px] px-1.5 py-0.5 rounded font-bold"
                  style={{ background: 'rgba(139,92,246,0.12)', color: '#a78bfa' }}
                >
                  ⚡
                  {latestEvent.latency_ms >= 1000
                    ? `${(latestEvent.latency_ms / 1000).toFixed(1)}s`
                    : `${latestEvent.latency_ms}ms`}
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Rationale ────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {latestEvent?.rationale && (
          <motion.div
            key={`rationale-${latestEvent.timestamp}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl p-3 flex-1 overflow-hidden"
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.05)',
              backdropFilter: 'blur(16px)',
            }}
          >
            <div className="text-[9px] text-gray-600 uppercase tracking-[0.15em] mb-1.5">
              Reasoning
            </div>
            <p
              className="text-[11px] text-gray-400 leading-relaxed italic"
              style={{
                fontFamily: 'monospace',
                display: '-webkit-box',
                WebkitLineClamp: 7,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {latestEvent.rationale}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {!latestEvent && (
        <div
          className="flex-1 flex flex-col items-center justify-center rounded-xl"
          style={{
            background: 'rgba(255,255,255,0.015)',
            border: '1px solid rgba(255,255,255,0.04)',
          }}
        >
          <div className="text-2xl mb-2 opacity-20">{agent.icon}</div>
          <p
            className="text-[9px] text-gray-700 tracking-[0.15em] text-center uppercase leading-relaxed"
          >
            Awaiting<br />Round Start
          </p>
        </div>
      )}
    </div>
  );
}
