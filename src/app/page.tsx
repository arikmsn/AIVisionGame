'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

const COOL_NAMES = [
  'Cyber-Sphinx', 'Logic-Ghost', 'Pixel-Wizard', 'Neural-Ninja',
  'Binary-Bard', 'Data-Druid', 'Code-Crusader', 'Byte-Boss',
  'Circuit-Sage', 'Data-Dynamo', 'Pixel-Prophet', 'Quantum-Leap',
];

function generateName(): string {
  const saved = typeof window !== 'undefined' ? localStorage.getItem('playerName') : null;
  if (saved) return saved;
  const name = COOL_NAMES[Math.floor(Math.random() * COOL_NAMES.length)] + '-' + Math.floor(Math.random() * 100);
  if (typeof window !== 'undefined') localStorage.setItem('playerName', name);
  return name;
}

function generateRoomId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export default function Home() {
  const router = useRouter();
  // Start empty — useEffect fills from localStorage. Server and first client
  // render are both empty strings, so no hydration mismatch.
  const [playerName, setPlayerName] = useState('');
  const [roomId, setRoomId] = useState('');

  useEffect(() => {
    // Hydrate name from localStorage after mount
    setPlayerName(generateName());

    // Resume active session: if user was in a room with a live round, send them back
    const lastRoom = sessionStorage.getItem('lastRoom');
    if (lastRoom) {
      fetch(`/api/game/state?roomId=${lastRoom}`)
        .then((r) => r.json())
        .then((state) => {
          if (state.imageUrl && state.phase !== 'idle') {
            router.push(`/game/${lastRoom}`);
          }
        })
        .catch(() => {});
    }
  }, [router]);

  const handleEnter = useCallback(() => {
    const name = playerName.trim() || generateName();
    const room = roomId.trim().toUpperCase() || generateRoomId();
    localStorage.setItem('playerName', name);
    router.push(`/game/${room}`);
  }, [playerName, roomId, router]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleEnter();
  };

  return (
    <div className="min-h-screen bg-[#050510] flex flex-col items-center justify-center px-4">
      {/* Subtle ambient background */}
      <div className="fixed inset-0 pointer-events-none">
        <div
          className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[600px] rounded-full"
          style={{ background: 'radial-gradient(ellipse, rgba(6,182,212,0.035) 0%, transparent 70%)' }}
        />
        <div
          className="absolute bottom-1/4 right-1/4 w-[500px] h-[400px] rounded-full"
          style={{ background: 'radial-gradient(ellipse, rgba(168,85,247,0.03) 0%, transparent 70%)' }}
        />
      </div>

      <div className="relative z-10 w-full max-w-xs">
        {/* Hero */}
        <div className="text-center mb-10">
          {/* Live indicator */}
          <div
            className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 rounded-full"
            style={{
              background: 'rgba(16,185,129,0.08)',
              border: '1px solid rgba(16,185,129,0.2)',
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"
              style={{ boxShadow: '0 0 6px #10b981' }}
            />
            <span className="text-emerald-400 text-[11px] font-bold tracking-[0.2em] uppercase">
              Live Now
            </span>
          </div>

          <h1 className="text-[2.6rem] font-bold text-white tracking-tight leading-none mb-3">
            AI Vision Arena
          </h1>
          <p className="text-gray-500 text-sm leading-relaxed">
            Compete against AI agents.<br />
            Guess Hebrew idioms from generated images.
          </p>
        </div>

        {/* Entry form */}
        <div className="space-y-2.5">
          <input
            type="text"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full px-4 py-3 text-white rounded-xl outline-none text-sm transition-colors"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.09)',
            }}
            placeholder="Your name"
            maxLength={24}
            onFocus={(e) => (e.target.style.borderColor = 'rgba(6,182,212,0.4)')}
            onBlur={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.09)')}
          />
          <input
            type="text"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            className="w-full px-4 py-3 text-white rounded-xl outline-none text-sm font-mono tracking-widest transition-colors"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.09)',
            }}
            placeholder="Room code (empty = new room)"
            maxLength={8}
            onFocus={(e) => (e.target.style.borderColor = 'rgba(6,182,212,0.4)')}
            onBlur={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.09)')}
          />
          <button
            onClick={handleEnter}
            className="w-full py-3 font-bold rounded-xl text-white text-sm transition-all active:scale-[0.98]"
            style={{
              background: 'linear-gradient(135deg, rgba(6,182,212,0.85) 0%, rgba(168,85,247,0.85) 100%)',
              boxShadow: '0 0 32px rgba(6,182,212,0.18)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 0 40px rgba(6,182,212,0.35)')}
            onMouseLeave={(e) => (e.currentTarget.style.boxShadow = '0 0 32px rgba(6,182,212,0.18)')}
          >
            Enter Arena →
          </button>
        </div>

        {/* Footer links */}
        <div className="flex items-center justify-center gap-5 mt-8">
          <a
            href="/api-guide.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-gray-600 hover:text-gray-400 transition-colors"
          >
            Developer Docs
          </a>
          <span className="text-gray-800 text-xs">·</span>
          <span className="text-[11px] text-gray-700">Hebrew Idioms v1.0 🇮🇱</span>
        </div>
      </div>
    </div>
  );
}
