'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { BENCHMARK_AGENTS, type AgentConfig } from '@/lib/agents/dispatcher';
import type { IdiomDifficulty } from '@/lib/benchmark/idioms';

// ── Types ──────────────────────────────────────────────────────────────────────

type CardStatus = 'idle' | 'loading' | 'success' | 'error' | 'key_missing';

interface CardState {
  status:     CardStatus;
  guess:      string;
  strategy:   string;
  latencyMs:  number | null;
  isCorrect:  boolean;
  isWinner:   boolean;
  error?:     string;
}

interface BenchmarkRun {
  imageUrl:   string;
  phrase:     string;
  hint:       string;
  difficulty: IdiomDifficulty;
  idiomId:    number;
  startedAt:  number;
}

function makeIdleCard(): CardState {
  return { status: 'idle', guess: '', strategy: '', latencyMs: null, isCorrect: false, isWinner: false };
}

function makeLoadingCard(): CardState {
  return { status: 'loading', guess: '', strategy: '', latencyMs: null, isCorrect: false, isWinner: false };
}

// ── Difficulty badge ───────────────────────────────────────────────────────────

const DIFF_COLOR: Record<IdiomDifficulty, string> = {
  easy:   '#10b981',
  medium: '#f59e0b',
  hard:   '#ef4444',
};

// ── Agent Card Component ───────────────────────────────────────────────────────

function AgentCard({ agent, card }: { agent: AgentConfig; card: CardState }) {
  const isCorrect  = card.isCorrect;
  const isWinner   = card.isWinner;
  const isMissing  = card.status === 'key_missing';
  const isLoading  = card.status === 'loading';
  const isError    = card.status === 'error';
  const isIdle     = card.status === 'idle';
  const isSuccess  = card.status === 'success';

  const borderColor = isWinner
    ? '#fbbf24'
    : isCorrect
    ? '#10b981'
    : isError
    ? '#ef444430'
    : isMissing
    ? '#374151'
    : `${agent.accentColor}30`;

  const glowStyle = isWinner
    ? { boxShadow: `0 0 0 2px #fbbf24, 0 0 32px #fbbf2455, 0 0 64px #fbbf2422` }
    : isCorrect
    ? { boxShadow: `0 0 0 1px #10b981, 0 0 20px #10b98130` }
    : {};

  return (
    <div
      style={{
        background:   'rgba(255,255,255,0.03)',
        border:       `1px solid ${borderColor}`,
        borderRadius: '12px',
        padding:      '14px',
        position:     'relative',
        transition:   'all 0.3s ease',
        minHeight:    '180px',
        display:      'flex',
        flexDirection:'column',
        gap:          '8px',
        ...glowStyle,
      }}
    >
      {/* Winner crown */}
      {isWinner && (
        <div style={{
          position:  'absolute',
          top:       '-14px',
          left:      '50%',
          transform: 'translateX(-50%)',
          fontSize:  '24px',
          filter:    'drop-shadow(0 0 8px #fbbf24)',
        }}>
          👑
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '14px' }}>{agent.icon}</span>
          <div>
            <div style={{
              fontSize:    '12px',
              fontWeight:  700,
              color:       isMissing ? '#4b5563' : agent.accentColor,
              fontFamily:  'monospace',
              lineHeight:  1,
              whiteSpace:  'nowrap',
            }}>
              {agent.label}
            </div>
            <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '1px' }}>
              {agent.providerLabel}
            </div>
          </div>
        </div>

        {/* Status badge */}
        <div>
          {isMissing && (
            <span style={{
              fontSize:     '9px',
              padding:      '2px 6px',
              borderRadius: '99px',
              background:   'rgba(75,85,99,0.3)',
              border:       '1px solid rgba(75,85,99,0.5)',
              color:        '#6b7280',
              fontWeight:   700,
            }}>
              KEY MISSING
            </span>
          )}
          {isLoading && (
            <span style={{
              fontSize:     '9px',
              padding:      '2px 8px',
              borderRadius: '99px',
              background:   `${agent.accentColor}20`,
              border:       `1px solid ${agent.accentColor}50`,
              color:        agent.accentColor,
              fontWeight:   700,
              animation:    'pulse 1.5s ease-in-out infinite',
            }}>
              ● THINKING
            </span>
          )}
          {isCorrect && !isWinner && (
            <span style={{
              fontSize:     '9px',
              padding:      '2px 6px',
              borderRadius: '99px',
              background:   'rgba(16,185,129,0.15)',
              border:       '1px solid #10b981',
              color:        '#10b981',
              fontWeight:   700,
            }}>
              ✓ CORRECT
            </span>
          )}
          {isWinner && (
            <span style={{
              fontSize:     '9px',
              padding:      '2px 6px',
              borderRadius: '99px',
              background:   'rgba(251,191,36,0.2)',
              border:       '1px solid #fbbf24',
              color:        '#fbbf24',
              fontWeight:   700,
            }}>
              🏆 WINNER
            </span>
          )}
          {isError && (
            <span style={{
              fontSize:     '9px',
              padding:      '2px 6px',
              borderRadius: '99px',
              background:   'rgba(239,68,68,0.1)',
              border:       '1px solid rgba(239,68,68,0.4)',
              color:        '#f87171',
              fontWeight:   700,
            }}>
              ✕ ERROR
            </span>
          )}
          {isSuccess && !isCorrect && (
            <span style={{
              fontSize:     '9px',
              padding:      '2px 6px',
              borderRadius: '99px',
              background:   'rgba(107,114,128,0.15)',
              border:       '1px solid rgba(107,114,128,0.3)',
              color:        '#9ca3af',
              fontWeight:   700,
            }}>
              ✗ WRONG
            </span>
          )}
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: '1px', background: `${agent.accentColor}15` }} />

      {/* Content */}
      <div style={{ flex: 1 }}>
        {isIdle && (
          <div style={{ color: '#374151', fontSize: '11px', fontStyle: 'italic' }}>
            Awaiting benchmark…
          </div>
        )}

        {isLoading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <LoadingSkeleton width="60%" color={agent.accentColor} />
            <LoadingSkeleton width="90%" color={agent.accentColor} />
            <LoadingSkeleton width="45%" color={agent.accentColor} />
          </div>
        )}

        {isMissing && (
          <div style={{ color: '#4b5563', fontSize: '11px' }}>
            Set <code style={{ fontFamily: 'monospace', color: '#6b7280' }}>{agent.envKey}</code> to enable this agent.
          </div>
        )}

        {isError && (
          <div style={{ color: '#f87171', fontSize: '11px', wordBreak: 'break-word' }}>
            {card.error?.slice(0, 80)}
          </div>
        )}

        {isSuccess && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {/* Guess */}
            <div>
              <span style={{ fontSize: '10px', color: '#6b7280', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Guess</span>
              <div style={{
                fontSize:    '13px',
                fontWeight:  700,
                color:       isCorrect ? '#10b981' : '#e5e7eb',
                marginTop:   '1px',
                fontStyle:   card.guess ? 'normal' : 'italic',
              }}>
                {card.guess || '(no guess)'}
              </div>
            </div>

            {/* Strategy */}
            {card.strategy && (
              <div style={{ fontSize: '10px', color: '#9ca3af', lineHeight: 1.4 }}>
                {card.strategy.slice(0, 90)}{card.strategy.length > 90 ? '…' : ''}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer: latency */}
      {card.latencyMs !== null && (
        <div style={{
          fontSize:    '10px',
          color:       card.latencyMs < 3000 ? '#10b981' : card.latencyMs < 8000 ? '#f59e0b' : '#ef4444',
          fontFamily:  'monospace',
          display:     'flex',
          alignItems:  'center',
          gap:         '3px',
        }}>
          ⚡ {card.latencyMs.toLocaleString()}ms
        </div>
      )}
    </div>
  );
}

function LoadingSkeleton({ width, color }: { width: string; color: string }) {
  return (
    <div style={{
      height:       '10px',
      width,
      borderRadius: '4px',
      background:   `linear-gradient(90deg, ${color}10 0%, ${color}25 50%, ${color}10 100%)`,
      backgroundSize: '200% 100%',
      animation:    'shimmer 1.5s infinite',
    }} />
  );
}

// ── Global Stats Types ─────────────────────────────────────────────────────────

interface LeaderboardEntry {
  modelId:         string;
  label:           string;
  icon:            string;
  accentColor:     string;
  totalRuns:       number;
  correctCount:    number;
  successRate:     number;
  avgLatencyMs:    number | null;
  cleanRunCount:   number;
  errorCount:      number;
  reliabilityRate: number | null; // null when model has no API key configured
}

interface StatsPayload {
  leaderboard:   LeaderboardEntry[];
  speedKing:     { modelId: string; label: string; icon: string; avgLatencyMs: number } | null;
  hardestIdioms: { phrase: string; failCount: number; totalAttempts: number; failRate: number }[];
  totalRuns:     number;
  totalCorrect:  number;
}

// ── Global Stats Component ─────────────────────────────────────────────────────

function GlobalStats({ refreshKey }: { refreshKey: number }) {
  const [stats,   setStats]   = useState<StatsPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    // After a completed run (refreshKey > 0) give the fire-and-forget DB
    // writes ~2 s to land before querying stats.  On initial mount (refreshKey
    // === 0) fetch immediately so the leaderboard shows right away.
    const delay = refreshKey > 0 ? 2000 : 0;
    const t = setTimeout(() => {
      fetch('/api/benchmark/stats')
        .then(r => r.json())
        .then((data: StatsPayload) => { setStats(data); setLoading(false); })
        .catch(() => setLoading(false));
    }, delay);
    return () => clearTimeout(t);
  }, [refreshKey]);

  const cell: React.CSSProperties = {
    padding:      '7px 10px',
    fontSize:     '12px',
    color:        '#d1d5db',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    whiteSpace:   'nowrap',
  };
  const hcell: React.CSSProperties = {
    ...cell,
    fontSize:     '10px',
    color:        '#4b5563',
    fontFamily:   'monospace',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    fontWeight:   700,
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  };

  if (loading) {
    return (
      <div style={{ marginTop: '40px', paddingTop: '32px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ fontSize: '13px', color: '#374151', fontFamily: 'monospace' }}>
          ⟳ Loading global stats…
        </div>
      </div>
    );
  }

  const noData = !stats || stats.totalRuns === 0;

  return (
    <div style={{
      marginTop:  '40px',
      paddingTop: '32px',
      borderTop:  '1px solid rgba(255,255,255,0.06)',
      animation:  'fadeIn 0.5s ease',
    }}>
      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '20px' }}>
        <div style={{
          fontWeight:     700,
          fontSize:       '15px',
          letterSpacing:  '-0.02em',
          background:     'linear-gradient(135deg,#60a5fa,#a78bfa)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}>
          📊 Global Stats
        </div>
        {stats && stats.totalRuns > 0 && (
          <div style={{ fontSize: '11px', color: '#4b5563', fontFamily: 'monospace' }}>
            {stats.totalRuns.toLocaleString()} runs · {stats.totalCorrect.toLocaleString()} correct
            ({Math.round((stats.totalCorrect / stats.totalRuns) * 100)}% overall)
          </div>
        )}
      </div>

      {noData ? (
        <div style={{
          padding:      '40px',
          textAlign:    'center',
          color:        '#374151',
          fontSize:     '13px',
          background:   'rgba(255,255,255,0.02)',
          borderRadius: '12px',
          border:       '1px solid rgba(255,255,255,0.04)',
        }}>
          No benchmark runs recorded yet — results will appear here after the first run.
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start' }}>

          {/* ── Leaderboard ── */}
          <div style={{
            flex:         '1 1 520px',
            background:   'rgba(255,255,255,0.02)',
            border:       '1px solid rgba(255,255,255,0.06)',
            borderRadius: '12px',
            overflow:     'hidden',
          }}>
            <div style={{
              padding:      '12px 14px',
              fontSize:     '12px',
              fontWeight:   700,
              color:        '#9ca3af',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              display:      'flex',
              alignItems:   'center',
              gap:          '6px',
            }}>
              🏆 Leaderboard — Success Rate
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...hcell, width: '28px', textAlign: 'center' }}>#</th>
                  <th style={{ ...hcell }}>Model</th>
                  <th style={{ ...hcell, textAlign: 'right' }}>Runs</th>
                  <th style={{ ...hcell, textAlign: 'right' }}>Win %</th>
                  <th style={{ ...hcell, textAlign: 'right' }}>Avg ms</th>
                  <th style={{ ...hcell, textAlign: 'right' }}>Reliability</th>
                </tr>
              </thead>
              <tbody>
                {stats!.leaderboard.map((m, i) => (
                  <tr key={m.modelId} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                    <td style={{ ...cell, textAlign: 'center', color: i < 3 ? ['#fbbf24','#9ca3af','#b45309'][i] : '#4b5563', fontWeight: 700 }}>
                      {i + 1}
                    </td>
                    <td style={{ ...cell }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>{m.icon}</span>
                        <span style={{ color: m.accentColor, fontWeight: 600, fontFamily: 'monospace', fontSize: '11px' }}>
                          {m.label}
                        </span>
                      </div>
                    </td>
                    <td style={{ ...cell, textAlign: 'right', color: '#6b7280' }}>
                      {m.totalRuns}
                    </td>
                    <td style={{ ...cell, textAlign: 'right' }}>
                      {/* Success rate bar + number */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                        <div style={{ width: '48px', height: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '99px', overflow: 'hidden' }}>
                          <div style={{
                            height:     '100%',
                            width:      `${m.successRate}%`,
                            background: m.successRate >= 50 ? '#10b981' : m.successRate >= 25 ? '#f59e0b' : '#ef4444',
                            borderRadius: '99px',
                          }} />
                        </div>
                        <span style={{
                          color:      m.successRate >= 50 ? '#10b981' : m.successRate >= 25 ? '#f59e0b' : '#ef4444',
                          fontFamily: 'monospace',
                          fontWeight: 700,
                          fontSize:   '11px',
                          minWidth:   '36px',
                        }}>
                          {m.successRate}%
                        </span>
                      </div>
                    </td>
                    <td style={{ ...cell, textAlign: 'right', fontFamily: 'monospace', color: m.avgLatencyMs !== null
                      ? m.avgLatencyMs < 3000 ? '#10b981' : m.avgLatencyMs < 8000 ? '#f59e0b' : '#ef4444'
                      : '#4b5563' }}>
                      {m.avgLatencyMs !== null ? `${(m.avgLatencyMs / 1000).toFixed(1)}s` : '—'}
                    </td>
                    <td style={{ ...cell, textAlign: 'right', fontFamily: 'monospace', fontSize: '11px',
                      color: m.reliabilityRate === null ? '#4b5563'
                           : m.reliabilityRate >= 90 ? '#10b981'
                           : m.reliabilityRate >= 70 ? '#f59e0b' : '#ef4444' }}>
                      {m.reliabilityRate !== null ? `${m.reliabilityRate}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: '8px 14px', fontSize: '10px', color: '#374151', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              Win % = correct / total runs · Reliability = error-free responses / configured attempts (key_missing excluded)
            </div>
          </div>

          {/* ── Right column: Speed King + Hardest Idioms ── */}
          <div style={{ flex: '0 1 260px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

            {/* Speed King */}
            {stats!.speedKing && (
              <div style={{
                background:   'rgba(255,255,255,0.02)',
                border:       '1px solid rgba(16,185,129,0.2)',
                borderRadius: '12px',
                padding:      '14px',
              }}>
                <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: 700, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  ⚡ Speed King
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '20px' }}>
                    {stats!.leaderboard.find(m => m.modelId === stats!.speedKing!.modelId)?.icon ?? '🤖'}
                  </span>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#10b981' }}>
                      {stats!.speedKing.label}
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: '#34d399', fontFamily: 'monospace', lineHeight: 1.2 }}>
                      {stats!.speedKing.avgLatencyMs !== null
                        ? stats!.speedKing.avgLatencyMs < 1000
                          ? `${stats!.speedKing.avgLatencyMs}ms`
                          : `${(stats!.speedKing.avgLatencyMs / 1000).toFixed(1)}s`
                        : '—'}
                    </div>
                    <div style={{ fontSize: '10px', color: '#4b5563', marginTop: '1px' }}>
                      average latency
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Hardest Idioms */}
            {stats!.hardestIdioms.length > 0 && (
              <div style={{
                background:   'rgba(255,255,255,0.02)',
                border:       '1px solid rgba(255,255,255,0.06)',
                borderRadius: '12px',
                overflow:     'hidden',
              }}>
                <div style={{
                  padding:      '10px 14px',
                  fontSize:     '11px',
                  fontWeight:   700,
                  color:        '#9ca3af',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}>
                  🧩 Hardest Idioms
                </div>
                {stats!.hardestIdioms.map((idiom, i) => (
                  <div key={idiom.phrase} style={{
                    padding:      '8px 14px',
                    borderBottom: i < stats!.hardestIdioms.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                    display:      'flex',
                    alignItems:   'center',
                    justifyContent: 'space-between',
                    gap:          '8px',
                  }}>
                    <div>
                      <div style={{ fontSize: '12px', color: '#d1d5db', fontStyle: 'italic' }}>
                        "{idiom.phrase}"
                      </div>
                      <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '1px' }}>
                        {idiom.failCount}/{idiom.totalAttempts} models failed
                      </div>
                    </div>
                    <div style={{
                      fontSize:     '12px',
                      fontWeight:   700,
                      fontFamily:   'monospace',
                      color:        idiom.failRate >= 80 ? '#ef4444' : idiom.failRate >= 60 ? '#f59e0b' : '#9ca3af',
                      minWidth:     '36px',
                      textAlign:    'right',
                    }}>
                      {idiom.failRate}%
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

// ── Arena Round Types ──────────────────────────────────────────────────────────

interface ArenaGuessRecord {
  modelId: string; attempt: number; wave: number; action: string;
  guessText: string | null; confidence: number; reasoning: string;
  tMsFromStart: number; isCorrect: boolean; pointsAwarded: number;
  latencyMs: number; isKeyMissing: boolean; error?: string;
}

interface ArenaModelResult {
  modelId: string; label: string; icon: string; attemptsUsed: number;
  finalScore: number; guesses: ArenaGuessRecord[]; warmupLatencyMs: number | null;
  warmupOk: boolean; bestGuess: string | null; isCorrect: boolean; reasoning: string;
}

interface ArenaRoundResult {
  roundId: string; idiomPhrase: string; imageUrl: string;
  tStartIso: string; tEndIso: string; durationMs: number;
  models: ArenaModelResult[];
  winner: { modelId: string; label: string; score: number; tMs: number } | null;
}

export default function BenchmarkPage() {
  const [run,        setRun]        = useState<BenchmarkRun | null>(null);
  const [cards,      setCards]      = useState<Record<string, CardState>>(
    () => Object.fromEntries(BENCHMARK_AGENTS.map(a => [a.modelId, makeIdleCard()])),
  );
  const [isStarting, setIsStarting] = useState(false);
  const [winnerSet,  setWinnerSet]  = useState(false);
  const [revealPhrase, setRevealPhrase] = useState(false);
  const [difficulty, setDifficulty] = useState<IdiomDifficulty | 'random'>('random');
  const [runCount,   setRunCount]   = useState(0);
  const winnerSetRef = useRef(false);

  // Arena state
  const [arenaRunning,  setArenaRunning]  = useState(false);
  const [arenaResult,   setArenaResult]   = useState<ArenaRoundResult | null>(null);
  const [arenaError,    setArenaError]    = useState<string | null>(null);

  const updateCard = useCallback((modelId: string, patch: Partial<CardState>) => {
    setCards(prev => ({ ...prev, [modelId]: { ...prev[modelId], ...patch } }));
  }, []);

  const runBenchmark = useCallback(async () => {
    if (isStarting) return;
    setIsStarting(true);
    setWinnerSet(false);
    setRevealPhrase(false);
    winnerSetRef.current = false;

    // Reset all cards to loading
    setCards(Object.fromEntries(BENCHMARK_AGENTS.map(a => [a.modelId, makeLoadingCard()])));
    setRun(null);

    try {
      // 1. Start the benchmark — generate image + pick idiom
      const startRes = await fetch('/api/benchmark/start', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(difficulty !== 'random' ? { difficulty } : {}),
      });
      if (!startRes.ok) throw new Error(`Benchmark start failed: ${startRes.status}`);
      const { imageUrl, phrase, hint, difficulty: diff, idiomId } = await startRes.json();

      const newRun: BenchmarkRun = {
        imageUrl,
        phrase,
        hint,
        difficulty: diff,
        idiomId,
        startedAt: Date.now(),
      };
      setRun(newRun);
      setIsStarting(false);

      // 2. Fire all 10 probes in parallel — each updates its card when resolved
      const probes = BENCHMARK_AGENTS.map(agent =>
        fetch('/api/benchmark/probe', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ modelId: agent.modelId, imageUrl, phrase }),
        })
          .then(r => r.json())
          .then((result: {
            modelId: string; guess: string; strategy: string;
            latencyMs: number; isCorrect: boolean; isKeyMissing: boolean; error?: string;
          }) => {
            const isWinner = result.isCorrect && !winnerSetRef.current;
            if (isWinner) {
              winnerSetRef.current = true;
              setWinnerSet(true);
            }
            updateCard(agent.modelId, {
              status:    result.isKeyMissing ? 'key_missing' : result.error ? 'error' : 'success',
              guess:     result.guess,
              strategy:  result.strategy,
              latencyMs: result.latencyMs,
              isCorrect: result.isCorrect,
              isWinner,
              error:     result.error,
            });
          })
          .catch((err: Error) => {
            updateCard(agent.modelId, {
              status:    'error',
              guess:     '',
              strategy:  '',
              latencyMs: null,
              isCorrect: false,
              isWinner:  false,
              error:     err.message,
            });
          }),
      );

      await Promise.allSettled(probes);
      // All done — reveal the phrase, then trigger stats refresh
      setRevealPhrase(true);
      setRunCount(c => c + 1);
    } catch (err: any) {
      console.error('[BENCHMARK] Start error:', err.message);
      setIsStarting(false);
      // Reset all cards to idle on start failure
      setCards(Object.fromEntries(BENCHMARK_AGENTS.map(a => [a.modelId, makeIdleCard()])));
    }
  }, [isStarting, difficulty, updateCard]);

  // ── Arena round trigger ────────────────────────────────────────────────────
  const runArenaRound = useCallback(async () => {
    if (arenaRunning) return;
    setArenaRunning(true);
    setArenaResult(null);
    setArenaError(null);

    try {
      const res = await fetch('/api/arena/round', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ skipWarmup: false }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const result: ArenaRoundResult = await res.json();
      setArenaResult(result);
    } catch (err: any) {
      setArenaError(err?.message ?? 'Unknown error');
    } finally {
      setArenaRunning(false);
    }
  }, [arenaRunning]);

  const allDone = run && Object.values(cards).every(
    c => c.status !== 'loading',
  );
  const correctCount = Object.values(cards).filter(c => c.isCorrect).length;

  return (
    <div style={{
      minHeight:       '100vh',
      background:      '#020209',
      color:           '#e5e7eb',
      fontFamily:      'system-ui, -apple-system, sans-serif',
      padding:         '0',
    }}>
      <style>{`
        @keyframes shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.5; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        * { box-sizing: border-box; }
      `}</style>

      {/* ── Header ── */}
      <header style={{
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        padding:      '16px 24px',
        display:      'flex',
        alignItems:   'center',
        justifyContent: 'space-between',
        background:   'rgba(255,255,255,0.015)',
        backdropFilter: 'blur(12px)',
        position:     'sticky',
        top:          0,
        zIndex:       50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '20px' }}>🔬</span>
          <div>
            <div style={{
              fontWeight:     700,
              fontSize:       '15px',
              letterSpacing:  '-0.02em',
              background:     'linear-gradient(135deg,#60a5fa,#a78bfa,#34d399)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              Visual Benchmark Arena
            </div>
            <div style={{ fontSize: '11px', color: '#4b5563', marginTop: '1px' }}>
              Multi-Model · {BENCHMARK_AGENTS.length} Agents · English Idioms
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {runCount > 0 && (
            <div style={{ fontSize: '11px', color: '#6b7280', fontFamily: 'monospace' }}>
              Run #{runCount}
              {allDone && ` · ${correctCount}/${BENCHMARK_AGENTS.length} correct`}
            </div>
          )}

          {/* Difficulty picker */}
          <select
            value={difficulty}
            onChange={e => setDifficulty(e.target.value as IdiomDifficulty | 'random')}
            disabled={isStarting}
            style={{
              background:   'rgba(255,255,255,0.05)',
              border:       '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px',
              color:        '#9ca3af',
              fontSize:     '12px',
              padding:      '6px 10px',
              cursor:       'pointer',
              outline:      'none',
            }}
          >
            <option value="random">🎲 Random difficulty</option>
            <option value="easy">🟢 Easy</option>
            <option value="medium">🟡 Medium</option>
            <option value="hard">🔴 Hard</option>
          </select>

          {/* Run button */}
          <button
            onClick={runBenchmark}
            disabled={isStarting}
            style={{
              padding:      '8px 18px',
              borderRadius: '8px',
              border:       'none',
              cursor:       isStarting ? 'not-allowed' : 'pointer',
              fontWeight:   700,
              fontSize:     '13px',
              background:   isStarting
                ? 'rgba(99,102,241,0.2)'
                : 'linear-gradient(135deg,#6366f1,#8b5cf6)',
              color:        isStarting ? '#6366f1' : 'white',
              transition:   'all 0.2s',
              display:      'flex',
              alignItems:   'center',
              gap:          '6px',
            }}
          >
            {isStarting ? (
              <>
                <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>
                Generating…
              </>
            ) : (
              <>⚡ New Benchmark</>
            )}
          </button>

          {/* Arena round button */}
          <button
            onClick={runArenaRound}
            disabled={arenaRunning}
            style={{
              padding:      '8px 18px',
              borderRadius: '8px',
              border:       'none',
              cursor:       arenaRunning ? 'not-allowed' : 'pointer',
              fontWeight:   700,
              fontSize:     '13px',
              background:   arenaRunning
                ? 'rgba(251,191,36,0.2)'
                : 'linear-gradient(135deg,#f59e0b,#ef4444)',
              color:        arenaRunning ? '#f59e0b' : 'white',
              transition:   'all 0.2s',
              display:      'flex',
              alignItems:   'center',
              gap:          '6px',
            }}
          >
            {arenaRunning ? (
              <>
                <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>
                Arena running…
              </>
            ) : (
              <>🏟 Arena Round</>
            )}
          </button>
        </div>
      </header>

      <main style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>

        {/* ── Challenge panel ── */}
        {(isStarting || run) && (
          <div style={{
            display:       'flex',
            gap:           '20px',
            marginBottom:  '24px',
            flexWrap:      'wrap',
            animation:     'fadeIn 0.4s ease',
          }}>
            {/* Image */}
            <div style={{
              flex:         '0 0 auto',
              width:        '280px',
              height:       '280px',
              borderRadius: '16px',
              border:       '1px solid rgba(255,255,255,0.08)',
              background:   'rgba(255,255,255,0.03)',
              overflow:     'hidden',
              display:      'flex',
              alignItems:   'center',
              justifyContent: 'center',
              position:     'relative',
            }}>
              {run ? (
                <img
                  src={run.imageUrl}
                  alt="Benchmark challenge"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <div style={{ textAlign: 'center', color: '#374151' }}>
                  <div style={{ fontSize: '32px', marginBottom: '8px', animation: 'spin 2s linear infinite' }}>⟳</div>
                  <div style={{ fontSize: '12px' }}>Generating image…</div>
                </div>
              )}
            </div>

            {/* Idiom info */}
            <div style={{ flex: 1, minWidth: '200px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '12px' }}>
              {run ? (
                <>
                  <div>
                    <div style={{ fontSize: '11px', color: '#6b7280', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>
                      Challenge #{run.idiomId}
                    </div>
                    {/* Phrase — hidden until all done or revealed */}
                    <div style={{
                      fontSize:     revealPhrase ? '26px' : '18px',
                      fontWeight:   700,
                      color:        revealPhrase ? '#fbbf24' : 'transparent',
                      background:   revealPhrase ? 'none' : 'rgba(255,255,255,0.08)',
                      borderRadius: revealPhrase ? '0' : '8px',
                      padding:      revealPhrase ? '0' : '6px 12px',
                      display:      'inline-block',
                      transition:   'all 0.6s ease',
                      letterSpacing: '-0.02em',
                      filter:       revealPhrase ? 'none' : 'blur(0)',
                      userSelect:   revealPhrase ? 'text' : 'none',
                    }}>
                      {revealPhrase ? `"${run.phrase}"` : '████████████████'}
                    </div>
                    {!revealPhrase && (
                      <div style={{ fontSize: '11px', color: '#4b5563', marginTop: '4px', fontStyle: 'italic' }}>
                        Phrase hidden during benchmark
                      </div>
                    )}
                  </div>

                  <div>
                    <div style={{ fontSize: '11px', color: '#6b7280', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '3px' }}>
                      Hint
                    </div>
                    <div style={{ fontSize: '14px', color: '#9ca3af', fontStyle: 'italic' }}>
                      "{run.hint}"
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '11px', color: '#6b7280', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      Difficulty
                    </span>
                    <span style={{
                      fontSize:     '11px',
                      fontWeight:   700,
                      padding:      '2px 8px',
                      borderRadius: '99px',
                      background:   `${DIFF_COLOR[run.difficulty]}20`,
                      border:       `1px solid ${DIFF_COLOR[run.difficulty]}60`,
                      color:        DIFF_COLOR[run.difficulty],
                      textTransform: 'capitalize',
                    }}>
                      {run.difficulty}
                    </span>
                  </div>

                  {/* Manual reveal button */}
                  {!revealPhrase && (
                    <button
                      onClick={() => setRevealPhrase(true)}
                      style={{
                        alignSelf:    'flex-start',
                        padding:      '6px 14px',
                        borderRadius: '8px',
                        border:       '1px solid rgba(251,191,36,0.3)',
                        background:   'rgba(251,191,36,0.07)',
                        color:        '#fbbf24',
                        fontSize:     '12px',
                        cursor:       'pointer',
                        fontWeight:   600,
                      }}
                    >
                      👁 Reveal Answer
                    </button>
                  )}

                  {/* Progress bar */}
                  {!allDone && (
                    <div>
                      <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px', fontFamily: 'monospace' }}>
                        {Object.values(cards).filter(c => c.status !== 'loading').length}/{BENCHMARK_AGENTS.length} agents responded
                      </div>
                      <div style={{
                        height:       '4px',
                        background:   'rgba(255,255,255,0.06)',
                        borderRadius: '99px',
                        overflow:     'hidden',
                        width:        '180px',
                      }}>
                        <div style={{
                          height:     '100%',
                          width:      `${(Object.values(cards).filter(c => c.status !== 'loading').length / BENCHMARK_AGENTS.length) * 100}%`,
                          background: 'linear-gradient(90deg,#6366f1,#8b5cf6)',
                          transition: 'width 0.4s ease',
                          borderRadius: '99px',
                        }} />
                      </div>
                    </div>
                  )}

                  {allDone && (
                    <div style={{
                      padding:      '8px 14px',
                      borderRadius: '10px',
                      background:   winnerSet ? 'rgba(251,191,36,0.08)' : 'rgba(107,114,128,0.08)',
                      border:       winnerSet ? '1px solid rgba(251,191,36,0.3)' : '1px solid rgba(107,114,128,0.2)',
                      fontSize:     '13px',
                      fontWeight:   600,
                      color:        winnerSet ? '#fbbf24' : '#6b7280',
                    }}>
                      {winnerSet
                        ? `🏆 ${correctCount} agent${correctCount !== 1 ? 's' : ''} identified the idiom correctly`
                        : '⚪ No agent guessed correctly this round'}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ color: '#4b5563', fontSize: '14px', fontStyle: 'italic' }}>
                  Picking idiom and generating image…
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Empty state ── */}
        {!isStarting && !run && (
          <div style={{
            textAlign:    'center',
            padding:      '80px 20px',
            color:        '#374151',
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔬</div>
            <div style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px', color: '#4b5563' }}>
              Ready to benchmark
            </div>
            <div style={{ fontSize: '14px', marginBottom: '24px' }}>
              Click <strong style={{ color: '#6366f1' }}>⚡ New Benchmark</strong> to generate an idiom challenge and test all {BENCHMARK_AGENTS.length} vision models simultaneously.
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
              {BENCHMARK_AGENTS.map(a => (
                <span key={a.modelId} style={{
                  fontSize:     '11px',
                  padding:      '3px 10px',
                  borderRadius: '99px',
                  background:   `${a.accentColor}10`,
                  border:       `1px solid ${a.accentColor}25`,
                  color:        process.env[a.envKey ?? ''] !== undefined
                    ? a.accentColor
                    : '#4b5563',
                  fontFamily:   'monospace',
                }}>
                  {a.icon} {a.label}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── Agent grid ── */}
        <div style={{
          display:             'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap:                 '12px',
        }}>
          {BENCHMARK_AGENTS.map(agent => (
            <AgentCard
              key={agent.modelId}
              agent={agent}
              card={cards[agent.modelId]}
            />
          ))}
        </div>

        {/* ── Legend ── */}
        <div style={{
          marginTop:  '32px',
          paddingTop: '20px',
          borderTop:  '1px solid rgba(255,255,255,0.04)',
          display:    'flex',
          gap:        '20px',
          flexWrap:   'wrap',
          fontSize:   '11px',
          color:      '#4b5563',
        }}>
          <span>🏆 First correct = winner</span>
          <span>✓ CORRECT = phrase matched</span>
          <span>✗ WRONG = incorrect guess</span>
          <span>KEY MISSING = env var not set</span>
          <span>⚡ = response latency</span>
        </div>

        {/* ── Arena Round Result ── */}
        {(arenaRunning || arenaResult || arenaError) && (
          <div style={{
            marginTop:    '40px',
            paddingTop:   '32px',
            borderTop:    '1px solid rgba(255,255,255,0.06)',
            animation:    'fadeIn 0.5s ease',
          }}>
            <div style={{
              fontWeight:     700,
              fontSize:       '15px',
              letterSpacing:  '-0.02em',
              background:     'linear-gradient(135deg,#f59e0b,#ef4444)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              marginBottom:  '16px',
            }}>
              🏟 Arena Round {arenaResult ? `— "${arenaResult.idiomPhrase}"` : ''}
            </div>

            {arenaRunning && (
              <div style={{ fontSize: '13px', color: '#6b7280', fontFamily: 'monospace' }}>
                <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite', marginRight: '8px' }}>⟳</span>
                Running arena round (warmup → 3 waves × 12 models)… this takes 1-3 minutes.
              </div>
            )}

            {arenaError && (
              <div style={{
                padding:      '16px',
                background:   'rgba(239,68,68,0.1)',
                border:       '1px solid rgba(239,68,68,0.3)',
                borderRadius: '12px',
                color:        '#f87171',
                fontSize:     '13px',
              }}>
                Arena error: {arenaError}
              </div>
            )}

            {arenaResult && (
              <div>
                {/* Summary */}
                <div style={{
                  display:     'flex',
                  gap:         '16px',
                  flexWrap:    'wrap',
                  marginBottom: '16px',
                }}>
                  <div style={{ fontSize: '12px', color: '#6b7280', fontFamily: 'monospace' }}>
                    Round: {arenaResult.roundId.slice(0, 8)}…
                  </div>
                  <div style={{ fontSize: '12px', color: '#6b7280', fontFamily: 'monospace' }}>
                    Duration: {(arenaResult.durationMs / 1000).toFixed(1)}s
                  </div>
                  <div style={{ fontSize: '12px', color: '#6b7280', fontFamily: 'monospace' }}>
                    Models: {arenaResult.models.length}
                  </div>
                  {arenaResult.winner && (
                    <div style={{ fontSize: '12px', color: '#fbbf24', fontFamily: 'monospace', fontWeight: 700 }}>
                      Winner: {arenaResult.winner.label} (+{arenaResult.winner.score}pts at {arenaResult.winner.tMs}ms)
                    </div>
                  )}
                </div>

                {/* Image */}
                {arenaResult.imageUrl && (
                  <div style={{ marginBottom: '16px' }}>
                    <img
                      src={arenaResult.imageUrl}
                      alt={`Arena round: ${arenaResult.idiomPhrase}`}
                      style={{
                        width:        '200px',
                        height:       '150px',
                        objectFit:    'cover',
                        borderRadius: '12px',
                        border:       '1px solid rgba(255,255,255,0.08)',
                      }}
                    />
                  </div>
                )}

                {/* Scoreboard table */}
                <div style={{
                  background:   'rgba(255,255,255,0.02)',
                  border:       '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '12px',
                  overflow:     'hidden',
                }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ padding: '8px 12px', fontSize: '10px', color: '#4b5563', fontFamily: 'monospace', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>#</th>
                        <th style={{ padding: '8px 12px', fontSize: '10px', color: '#4b5563', fontFamily: 'monospace', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>Model</th>
                        <th style={{ padding: '8px 12px', fontSize: '10px', color: '#4b5563', fontFamily: 'monospace', textAlign: 'right', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>Score</th>
                        <th style={{ padding: '8px 12px', fontSize: '10px', color: '#4b5563', fontFamily: 'monospace', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>Att.</th>
                        <th style={{ padding: '8px 12px', fontSize: '10px', color: '#4b5563', fontFamily: 'monospace', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>Best Guess</th>
                        <th style={{ padding: '8px 12px', fontSize: '10px', color: '#4b5563', fontFamily: 'monospace', textAlign: 'right', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>Time</th>
                        <th style={{ padding: '8px 12px', fontSize: '10px', color: '#4b5563', fontFamily: 'monospace', textAlign: 'right', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>Warmup</th>
                      </tr>
                    </thead>
                    <tbody>
                      {arenaResult.models.map((m, i) => {
                        const correctGuess = m.guesses.find(g => g.isCorrect);
                        const firstGuess = m.guesses.find(g => g.action === 'guess');
                        const tMs = correctGuess?.tMsFromStart ?? firstGuess?.tMsFromStart ?? null;
                        return (
                          <tr key={m.modelId} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                            <td style={{ padding: '7px 12px', fontSize: '12px', color: i < 3 ? ['#fbbf24','#9ca3af','#b45309'][i] : '#4b5563', fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                              {i + 1}
                            </td>
                            <td style={{ padding: '7px 12px', fontSize: '12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                              <span style={{ marginRight: '6px' }}>{m.icon}</span>
                              <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '11px' }}>{m.label}</span>
                            </td>
                            <td style={{
                              padding: '7px 12px', fontSize: '13px', fontWeight: 700, fontFamily: 'monospace', textAlign: 'right',
                              color: m.finalScore > 0 ? '#10b981' : m.finalScore < 0 ? '#ef4444' : '#6b7280',
                              borderBottom: '1px solid rgba(255,255,255,0.04)',
                            }}>
                              {m.finalScore > 0 ? '+' : ''}{m.finalScore}
                            </td>
                            <td style={{ padding: '7px 12px', fontSize: '11px', color: '#6b7280', textAlign: 'center', fontFamily: 'monospace', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                              {m.attemptsUsed}/{3}
                            </td>
                            <td style={{
                              padding: '7px 12px', fontSize: '11px', fontStyle: m.bestGuess ? 'italic' : 'normal',
                              color: m.isCorrect ? '#10b981' : m.bestGuess ? '#d1d5db' : '#4b5563',
                              borderBottom: '1px solid rgba(255,255,255,0.04)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {m.bestGuess ?? (m.guesses[0]?.error ? `Error: ${m.guesses[0].error.slice(0, 30)}` : '(no guess)')}
                              {m.isCorrect && ' ✓'}
                            </td>
                            <td style={{ padding: '7px 12px', fontSize: '11px', color: '#6b7280', fontFamily: 'monospace', textAlign: 'right', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                              {tMs != null ? `${(tMs / 1000).toFixed(1)}s` : '—'}
                            </td>
                            <td style={{
                              padding: '7px 12px', fontSize: '11px', fontFamily: 'monospace', textAlign: 'right',
                              color: m.warmupOk ? '#10b981' : '#ef4444',
                              borderBottom: '1px solid rgba(255,255,255,0.04)',
                            }}>
                              {m.warmupLatencyMs != null ? `${(m.warmupLatencyMs / 1000).toFixed(1)}s` : '—'}
                              {m.warmupOk ? '' : ' ✕'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Global Stats ── refreshKey increments after each run so stats reload */}
        <GlobalStats refreshKey={runCount} />

      </main>
    </div>
  );
}
