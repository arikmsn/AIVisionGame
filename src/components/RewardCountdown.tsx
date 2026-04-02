'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';

interface RewardCountdownProps {
  /** Current decayed reward value (R_i) */
  points: number;
  /** Maximum possible reward — used to compute decay % (default: 1000) */
  maxPoints?: number;
}

/**
 * High-contrast, animated R_i reward countdown.
 * Color transitions: emerald (>65%) → amber (>40%) → orange (>20%) → red.
 * Used as the central spectator element during an active round.
 */
export function RewardCountdown({ points, maxPoints = 1000 }: RewardCountdownProps) {
  const pct = Math.max(0, Math.min(1, points / maxPoints));

  const { color, glow } = useMemo(() => {
    if (pct > 0.65) return { color: '#10b981', glow: 'rgba(16,185,129,0.65)' };
    if (pct > 0.40) return { color: '#f59e0b', glow: 'rgba(245,158,11,0.65)' };
    if (pct > 0.20) return { color: '#f97316', glow: 'rgba(249,115,22,0.65)' };
    return { color: '#ef4444', glow: 'rgba(239,68,68,0.65)' };
  }, [pct]);

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      {/* Label */}
      <span
        className="text-[9px] tracking-[0.3em] uppercase font-bold"
        style={{ color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace' }}
      >
        R<sub style={{ fontSize: '6px', verticalAlign: 'sub' }}>i</sub>
        &thinsp;REWARD
      </span>

      {/* Big pulsing number */}
      <motion.div
        className="tabular-nums font-bold leading-none"
        style={{
          fontSize: 'clamp(3.5rem, 6vw, 5.5rem)',
          fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace',
          color,
          textShadow: `0 0 20px ${glow}, 0 0 48px ${glow.replace('0.65', '0.2')}`,
          transition: 'color 0.8s ease, text-shadow 0.8s ease',
        }}
        animate={{
          textShadow: [
            `0 0 14px ${glow.replace('0.65', '0.4')}`,
            `0 0 36px ${glow}`,
            `0 0 14px ${glow.replace('0.65', '0.4')}`,
          ],
        }}
        transition={{ repeat: Infinity, duration: 1.7, ease: 'easeInOut' }}
      >
        {points}
      </motion.div>

      {/* Decay progress bar */}
      <div
        className="w-32 h-px rounded-full overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.07)' }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct * 100}%`,
            background: color,
            boxShadow: `0 0 5px ${glow}`,
            transition: 'width 0.4s linear, background 0.8s ease, box-shadow 0.8s ease',
          }}
        />
      </div>
    </div>
  );
}
