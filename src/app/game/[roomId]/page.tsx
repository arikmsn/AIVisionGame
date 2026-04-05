'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

const shakeKeyframes = `
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-8px); }
    75% { transform: translateX(8px); }
  }
  .animate-shake { animation: shake 0.4s ease-in-out; }

  @keyframes twinkle {
    0%, 100% { opacity: 0.08; transform: scale(1); }
    50% { opacity: 0.9; transform: scale(1.8); }
  }
  .particle {
    position: fixed;
    border-radius: 50%;
    background: white;
    pointer-events: none;
    animation: twinkle 3s infinite ease-in-out;
  }

  @keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-20px); }
  }
  .float-animation { animation: float 6s infinite ease-in-out; }

  @keyframes scan-line {
    0%   { top: -4px; opacity: 0; }
    5%   { opacity: 1; }
    95%  { opacity: 1; }
    100% { top: 100%; opacity: 0; }
  }
  .scan-line {
    position: absolute; left: 0; right: 0; height: 2px;
    background: linear-gradient(90deg, transparent 0%, #06b6d4 30%, #a855f7 60%, #06b6d4 80%, transparent 100%);
    box-shadow: 0 0 8px #06b6d4;
    animation: scan-line 2.6s ease-in-out infinite;
    pointer-events: none; z-index: 2;
  }

  @keyframes glow-pulse-cyan {
    0%, 100% { box-shadow: 0 0 10px rgba(6,182,212,0.2), 0 0 20px rgba(6,182,212,0.08); }
    50%       { box-shadow: 0 0 22px rgba(6,182,212,0.55), 0 0 45px rgba(6,182,212,0.22), 0 0 70px rgba(6,182,212,0.08); }
  }
  .glow-pulse-cyan { animation: glow-pulse-cyan 2.2s ease-in-out infinite; }

  @keyframes arena-grid-pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.55; }
  }
  .arena-grid {
    background-image:
      linear-gradient(rgba(6,182,212,0.035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(6,182,212,0.035) 1px, transparent 1px);
    background-size: 48px 48px;
    animation: arena-grid-pulse 7s ease-in-out infinite;
  }

  @keyframes typing-bounce {
    0%, 60%, 100% { transform: translateY(0); opacity: 0.6; }
    30%            { transform: translateY(-4px); opacity: 1; }
  }
  .typing-dot:nth-child(1) { animation: typing-bounce 1s 0s   infinite; }
  .typing-dot:nth-child(2) { animation: typing-bounce 1s 0.15s infinite; }
  .typing-dot:nth-child(3) { animation: typing-bounce 1s 0.3s  infinite; }

  @keyframes status-breathe {
    0%, 100% { opacity: 0.7; }
    50%       { opacity: 1; box-shadow: 0 0 8px currentColor; }
  }
  .status-dot-live { animation: status-breathe 1.8s ease-in-out infinite; }

  @keyframes border-flow {
    0%   { background-position: 0% 50%; }
    50%  { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }

  @keyframes victory-border-flash {
    0%   { opacity: 0; box-shadow: inset 0 0 0 0px var(--vbf-color, #D946EF); }
    12%  { opacity: 1; box-shadow: inset 0 0 0 3px var(--vbf-color, #D946EF), 0 0 40px var(--vbf-color, #D946EF); }
    85%  { opacity: 1; box-shadow: inset 0 0 0 3px var(--vbf-color, #D946EF), 0 0 40px var(--vbf-color, #D946EF); }
    100% { opacity: 0; box-shadow: inset 0 0 0 0px var(--vbf-color, #D946EF); }
  }
  .victory-border-flash { animation: victory-border-flash 1.5s ease-in-out forwards; pointer-events: none; }
`;
import { useParams } from 'next/navigation';
import Pusher from 'pusher-js';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import { AGENT_REGISTRY, isAgentPlayer, getAgentByName, IntelligenceEvent } from '@/lib/agents/config';
import { AnalyticsTerminal, StrategyProfileSummary } from '@/components/AnalyticsTerminal';
import { computeDecayedReward } from '@/lib/game/mechanics';
import { AgentStatusCard } from '@/components/AgentStatusCard';
import { RewardCountdown } from '@/components/RewardCountdown';

// Audio disabled until sound files are added to /public/sounds/
// const SOUNDS = {
//   victory: '/sounds/victory.mp3',
//   tick: '/sounds/tick.mp3',
//   wrong: '/sounds/wrong.mp3',
// };

const COOL_NAMES = [
  'Cyber-Sphinx', 'Logic-Ghost', 'Pixel-Wizard', 'Neural-Ninja', 'Quantum-Leap',
  'Binary-Bard', 'Data-Druid', 'Code-Crusader', 'Byte-Boss', 'Pixel-Pirate',
  'AI-Avenger', 'Tech-Titan', 'Digital-Detective', 'Byte-Bender', 'Neural-Nomad',
  'Circuit-Sage', 'Data-Dynamo', 'Code-Commander', 'Binary-Bruiser', 'Pixel-Prophet',
];

function generateGuestName(): string {
  const stored = typeof window !== 'undefined' ? localStorage.getItem('playerName') : null;
  if (stored) return stored;
  const name = COOL_NAMES[Math.floor(Math.random() * COOL_NAMES.length)] + '-' + Math.floor(Math.random() * 100);
  if (typeof window !== 'undefined') localStorage.setItem('playerName', name);
  return name;
}

const TRANSLATIONS = {
  en: {
    title: 'Guess What\'s in the Picture',
    room: 'Room',
    playingAs: 'Playing as',
    myScore: 'My Score',
    playersConnected: 'players connected',
    guess: 'Type your guess...',
    submitGuess: 'Guess',
    loading: 'Generating image...',
    youWon: 'Great Job! 🎉',
    someoneWon: 'won! 👏',
    nextRound: 'Next Round',
    getHint: 'Get Hint',
    close: 'Getting warm! 🔥',
    outOfGuesses: 'Out of guesses!',
    guessHistory: 'Guess History',
    noGuesses: 'No guesses yet',
    points: 'pts',
    countdownTitleWin: 'Great Job!',
    countdownTitleLose: 'The answer was',
    countdownSubtitle: 'Next image in...',
    loadingNext: 'Loading new challenge...',
    solvedIn: 'Solved in',
    seconds: 's',
    shareResult: 'Share Result',
    copied: 'Copied!',
    aiInsight: 'AI Insight',
  },
  he: {
    title: 'נחשו מה בתמונה',
    room: 'חדר',
    playingAs: 'משחק כ',
    myScore: 'הניקוד שלי',
    playersConnected: 'משתתפים מחוברים',
    guess: 'הקלד את הניחוש שלך...',
    submitGuess: 'נחש',
    loading: 'יוצר תמונה...',
    youWon: 'כל הכבוד! 🎉',
    someoneWon: 'ניצח/ה! 👏',
    nextRound: 'סיבוב הבא',
    getHint: 'קבל רמז',
    close: 'קרוב! 🔥',
    outOfGuesses: 'נגמרו הניחושים!',
    guessHistory: 'היסטוריית ניחושים',
    noGuesses: 'אין עדיין ניחושים',
    points: 'נק',
    countdownTitleWin: 'כל הכבוד!',
    countdownTitleLose: 'לא נורא, התשובה הייתה',
    countdownSubtitle: 'התמונה הבאה בעוד...',
    loadingNext: 'טוען אתגר חדש...',
    solvedIn: 'פתרת את החידה תוך',
    seconds: ' שניות!',
    shareResult: 'שתף תוצאה',
    copied: 'הועתק!',
    aiInsight: 'תובנת AI',
  },
};

// Retry fetch on DNS/network failures (EAI_AGAIN)
async function clientFetch(url: string, options: RequestInit, retries = 3): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetch(url, options);
    } catch (err: any) {
      const isNet = err?.message?.includes('EAI_AGAIN') || err?.message?.includes('fetch failed') || err?.message?.includes('network');
      if (isNet && attempt < retries) {
        console.warn(`[FETCH] DNS error, retry ${attempt}/${retries}: ${url}`);
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Request failed after all retries');
}

// Client-side fast match mirrors the server's strictIdiomMatch.
// Used for optimistic victory: if this returns true the UI updates instantly
// while the server request is still in flight.
function quickLocalMatch(guess: string, secret: string): boolean {
  const norm = (s: string) =>
    s.replace(/[\u05B0-\u05BC\u05BF]/g, '').toLowerCase().trim();
  const g = norm(guess);
  const s = norm(secret);
  if (g === s) return true;
  // All content words match (same logic as server strictIdiomMatch full-word check)
  const gWords = g.split(/\s+/).filter(w => w.length > 1);
  const sWords = s.split(/\s+/).filter(w => w.length > 1);
  if (sWords.length === 0) return false;
  return sWords.every(sw => gWords.some(gw => gw === sw || sw.includes(gw) || gw.includes(sw)));
}

type GameCategory = 'flag' | 'painter' | 'landmark' | 'person';

interface GuessEntry {
  player: string;
  text: string;
  timestamp: number;
  isCorrect?: boolean;
}

export default function GamePage() {
  const params = useParams();
  const roomId = Array.isArray(params.roomId) ? params.roomId[0] : params.roomId || 'demo-room';
  
  const [isMounted, setIsMounted] = useState(false);
  const [localName, setLocalName] = useState('');
  const [language, setLanguage] = useState<'en' | 'he'>('he');
  const [guessText, setGuessText] = useState('');
  const [lastHint, setLastHint] = useState<string | null>(null);
  const [showWinner, setShowWinner] = useState(false);
  const [roundTimedOut, setRoundTimedOut] = useState(false);
  const [isWinner, setIsWinner] = useState(false);
  const [loading, setLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [secretPrompt, setSecretPrompt] = useState<string | null>(null);
  const [currentExplanation, setCurrentExplanation] = useState<string | null>(null);
  const [category, setCategory] = useState<GameCategory | null>(null);
  const [phase, setPhase] = useState<'idle' | 'drawing' | 'playing' | 'solved' | 'winner'>('idle');
  const [connected, setConnected] = useState(false);
  const [playerCount, setPlayerCount] = useState(1);
  const [winnerName, setWinnerName] = useState<string | null>(null);
  const [guessHistory, setGuessHistory] = useState<GuessEntry[]>([]);
  const [strikes, setStrikes] = useState(3);
  const [hintUsed, setHintUsed] = useState(false);
  const [revealedHint, setRevealedHint] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [roundStartTime, setRoundStartTime] = useState<number | null>(null);
  // Unique opaque ID per round — used as React key on <img> to force a fresh
  // browser fetch even if the URL were somehow reused (cache-buster).
  const [roundId, setRoundId] = useState<string>('');
  // imageLoaded removed — image renders as soon as imageUrl is set, no onLoad gate needed
  // nextImageUrl / nextSecret / nextCategory / isPrefetching removed — prefetch is server-driven
  const [countdownActive, setCountdownActive] = useState(false);
  const [countdownSeconds, setCountdownSeconds] = useState(5);
  const [isHost, setIsHost] = useState(false);
  const [forceStartVisible, setForceStartVisible] = useState(false);
  const [imageClickCount, setImageClickCount] = useState(0);
  const [showSecretCheat, setShowSecretCheat] = useState(false);
  const [lastClickTime, setLastClickTime] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [reactions, setReactions] = useState<{ id: number; emoji: string; x: number; y: number }[]>([]);
  const reactionIdRef = useRef(0);
  /** Agent names currently displaying a typing indicator (cleared after 3 s) */
  const [botTypingNames, setBotTypingNames] = useState<string[]>([]);
  /** Accent color of the bot that won the current round — drives border flash */
  const [victoryBotColor, setVictoryBotColor] = useState<string | null>(null);
  /** Intelligence events accumulated this session — fed to AnalyticsTerminal */
  const [intelligenceEvents, setIntelligenceEvents] = useState<IntelligenceEvent[]>([]);
  /** PRD v5.0 — Strategy profiles fetched from /api/game/strategy-profiles */
  const [strategyProfiles, setStrategyProfiles] = useState<StrategyProfileSummary[]>([]);
  /** Whether the Analytics Terminal panel is open */
  const [showAnalytics, setShowAnalytics] = useState(false);
  
  // Refs for values used in Pusher handlers (to avoid re-creating handlers)
  const localNameRef = useRef(localName);
  const imageUrlRef = useRef(imageUrl);
  const phaseRef = useRef(phase);
  const strikesRef = useRef(strikes);
  const secretPromptRef = useRef(secretPrompt);
  const categoryRef = useRef(category);
  const guessHistoryRef = useRef(guessHistory);
  const showWinnerRef = useRef(showWinner);
  const winnerNameRef = useRef(winnerName);
  const isHostRef = useRef(false);
  const triggerServerRoundRef = useRef<() => void>(() => {});
  const [countdownShake, setCountdownShake] = useState(false);
  // nextImageLoaded removed
  const [streak, setStreak] = useState(0);
  const [currentPotentialPoints, setCurrentPotentialPoints] = useState(1000);
  const [showStreak, setShowStreak] = useState(false);
  const [responseTime, setResponseTime] = useState<number | null>(null);
  const [leaderboard, setLeaderboard] = useState<{ player: string; score: number; streak: number }[]>([]);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [copyLinkSuccess, setCopyLinkSuccess] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [lobbyCountdown, setLobbyCountdown] = useState(10);
  const [lobbyActive, setLobbyActive] = useState(true);
  const [showTutorial, setShowTutorial] = useState(false);
  const [hasSeenTutorial, setHasSeenTutorial] = useState(false);
  const [globalPlayersOnline, setGlobalPlayersOnline] = useState(127);
  const [bots, setBots] = useState<{ name: string; joinedAt: number; ready: boolean }[]>([]);
  const botTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pusherRef = useRef<Pusher | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Audio disabled - uncomment when sound files exist
  // const audioVictoryRef = useRef<HTMLAudioElement | null>(null);
  // const audioTickRef = useRef<HTMLAudioElement | null>(null);
  // const audioWrongRef = useRef<HTMLAudioElement | null>(null);
  // nextRoundDataRef removed
  const scoreIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isGeneratingRef = useRef(false); // Debounce flag for API calls
  // Counts consecutive poll responses where server is idle/winner with no new image.
  // When it reaches POLL_IDLE_THRESHOLD, the client self-heals by calling start-round.
  const pollIdleCountRef = useRef(0);
  const POLL_IDLE_THRESHOLD = 5;
  // Tracks which Pusher channel name is currently subscribed so we can skip
  // duplicate subscriptions that can occur during HMR / React Strict Mode.
  const subscribedChannelRef = useRef<string>('');

  const t = TRANSLATIONS[language];
  const isRTL = language === 'he';

  const resetGame = () => {
    setImageUrl(null);
    setSecretPrompt(null);
    setCategory(null);
    setLastHint(null);
    setShowWinner(false);
    setIsWinner(false);
    setWinnerName(null);
    setPhase('idle');
    setGuessText('');
    setGuessHistory([]);
    setStrikes(3);
    setHintUsed(false);
    setRevealedHint(null);
    setRoundStartTime(null);
    setCountdownActive(false);
    setCountdownSeconds(5);
  };

  // prefetchNextRound removed — server drives all round transitions via game-started Pusher.

  // Shared helper: apply a new round's data to client state
  // roundStartTime comes from the server — all clients share the same reference point
  const applyRoundStateFn = useCallback((data: { imageUrl: string; prompt: string; category: string; explanation?: string; roundStartTime?: number; roundId?: string }) => {
    console.log('🖼️ applyRoundState:', data.imageUrl?.slice(0, 60), '| serverTime:', data.roundStartTime, '| roundId:', data.roundId);
    setImageUrl(data.imageUrl);
    setSecretPrompt(data.prompt);
    setCurrentExplanation(data.explanation || '');
    setCategory(data.category as GameCategory);
    setPhase('playing');
    setLoading(false);
    isGeneratingRef.current = false;
    setGuessHistory([]);
    setStrikes(3);
    setHintUsed(false);
    setRevealedHint(null);
    setShowWinner(false);
    setIsWinner(false);
    setLobbyActive(false);
    // Use server's authoritative roundStartTime so every client's timer is in sync
    setRoundStartTime(data.roundStartTime ?? Date.now());
    // roundId is used as React key on <img> — forces fresh browser fetch every new round
    if (data.roundId) setRoundId(data.roundId);
    setTimeout(() => inputRef.current?.focus(), 300);
  }, []);

  const triggerServerRound = useCallback(async () => {
    if (isGeneratingRef.current) return;
    isGeneratingRef.current = true;
    setImageUrl(null);    // clear stale image immediately — prevents ghost flicker
    setLoading(true);
    
    console.log('[triggerServerRound] Calling /api/game/start-round');
    
    try {
      const res = await clientFetch('/api/game/start-round', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, language }),
      });
      
      const data = await res.json();
      
      if (data.error) {
        console.error('[triggerServerRound] Error:', data.error);
        setLastHint(`Error: ${data.error}`);
        setLoading(false);
        isGeneratingRef.current = false;
        return;
      }
      
      if (data.inProgress && data.state?.imageUrl) {
        // Round already active - apply existing state directly (server is source of truth)
        console.log('[triggerServerRound] Round in progress, applying existing state');
        applyRoundStateFn({
          imageUrl: data.state.imageUrl,
          prompt: data.state.secretPrompt,
          category: data.state.category,
          explanation: data.state.explanation || '',
          roundStartTime: data.state.roundStartTime ?? undefined,
        });
        return;
      }

      if (data.imageUrl) {
        // SUCCESS: this client triggered the round — apply directly (Pusher also fires for others)
        console.log('[triggerServerRound] ✅ Image ready, applying');
        applyRoundStateFn({
          imageUrl: data.imageUrl,
          prompt: data.secret,
          category: 'idiom',
          explanation: data.explanation || '',
          roundStartTime: data.roundStartTime ?? undefined,
        });
      }
      // If inProgress but no imageUrl yet: generation is in flight.
      // Stay in loading state — game-started Pusher will resolve it.
    } catch (e) {
      console.error('[triggerServerRound] Network error:', e);
      setLoading(false);
      isGeneratingRef.current = false;
    }
  }, [roomId, language, applyRoundStateFn]);

  // Keep triggerServerRoundRef always pointing to latest version
  useEffect(() => {
    triggerServerRoundRef.current = triggerServerRound;
  });

  // startNewRound removed — it called /api/game/image directly, bypassing the
  // server-side generatingRooms lock. All round starts go through triggerServerRound
  // → /api/game/start-round → Pusher game-started → every client updates atomically.

  const handleRestart = () => {
    // All round transitions go through the server — single source of truth for imageUrl.
    // The server lock (generatingRooms Set) ensures only one Fal.ai call per room,
    // and the game-started Pusher event delivers the same URL to every client.
    triggerServerRoundRef.current();
  };

  useEffect(() => {
    setLocalName(generateGuestName());
    const browserLang = navigator.language.startsWith('he') ? 'he' : 'en';
    setLanguage(browserLang);
    setIsMounted(true);
    
    const savedMuted = localStorage.getItem('isMuted');
    if (savedMuted === 'true') setIsMuted(true);

    // Remember last room for resume-on-refresh
    sessionStorage.setItem('lastRoom', roomId);

    // Every client is a potential host — server /api/game/start-round deduplicates
    // via the inProgress check, so calling it twice is safe.
    setIsHost(true);
    isHostRef.current = true;
    console.log('[HOST] 👑 Host assigned on mount (server deduplicates)');

    // Immediate state sync on mount — don't wait for Pusher
    fetch(`/api/game/state?roomId=${roomId}`)
      .then(r => r.json())
      .then(state => {
        console.log('[MOUNT] Server state on mount:', state);
        if (state.imageUrl && state.phase && state.phase !== 'idle') {
          console.log('[MOUNT] 🖼️ Active round found, restoring state immediately');
          setImageUrl(state.imageUrl);
          setSecretPrompt(state.secretPrompt);
          setCurrentExplanation(state.explanation || '');
          setCategory(state.category || 'idiom');
          setPhase('playing');
          setLoading(false);
          setLobbyActive(false);
          setRoundStartTime(state.roundStartTime || Date.now());
        }
      })
      .catch(e => console.log('[MOUNT] State fetch failed:', e));

    // Show Force Start button immediately in dev
    if (process.env.NODE_ENV === 'development') {
      setForceStartVisible(true);
    }

    // Audio disabled - uncomment when sound files exist
    // try {
    //   audioVictoryRef.current = new Audio(SOUNDS.victory);
    //   audioTickRef.current = new Audio(SOUNDS.tick);
    //   audioWrongRef.current = new Audio(SOUNDS.wrong);
    // } catch (e) {
    //   console.log('[AUDIO] Sound files not available, disabling audio');
    // }
  }, []);

  // Sync refs with state for Pusher handlers (no dep array = runs every render, no size change)
  useEffect(() => {
    localNameRef.current = localName;
    imageUrlRef.current = imageUrl;
    phaseRef.current = phase;
    strikesRef.current = strikes;
    secretPromptRef.current = secretPrompt;
    categoryRef.current = category;
    guessHistoryRef.current = guessHistory;
    showWinnerRef.current = showWinner;
    winnerNameRef.current = winnerName;
    isHostRef.current = isHost;
  });

  // ── Visibility-change re-sync ────────────────────────────────────────────
  // When the user switches back to a tab, pull fresh state from the server.
  // This is a backstop for any Pusher events that were missed while the tab
  // was hidden (browser may throttle connections for background tabs).
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      console.log('[VISIBILITY] Tab became visible — re-syncing from server');
      fetch(`/api/game/state?roomId=${roomId}`)
        .then(r => r.json())
        .then(state => {
          console.log('[VISIBILITY] Server state:', { phase: state.phase, secret: state.secretPrompt?.slice(0, 20), imageUrl: state.imageUrl?.slice(-30) });
          if (state.phase === 'drawing' && state.imageUrl) {
            // Only apply if image changed — avoid clearing mid-game state
            if (state.imageUrl !== imageUrlRef.current) {
              console.log('[VISIBILITY] 🔄 New image detected — applying state');
              setImageUrl(state.imageUrl);
              setSecretPrompt(state.secretPrompt);
              setCurrentExplanation(state.explanation || '');
              setCategory(state.category || 'idiom');
              setPhase('playing');
              setLoading(false);
              setLobbyActive(false);
              setShowWinner(false);
              setCountdownActive(false);
              setLastHint(null);
              setGuessHistory([]);
              setStrikes(3);
            }
          }
        })
        .catch(e => console.log('[VISIBILITY] State fetch failed:', e));
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  useEffect(() => {
    const pusherKey = process.env.NEXT_PUBLIC_PUSHER_KEY;
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || 'eu';
    
    if (!pusherKey || pusherKey === 'your_key_here') {
      console.log('[PUSHER] No key configured, skipping connection');
      return;
    }

    // ── Singleton init: create Pusher ONCE, but ALWAYS re-subscribe to the channel ──
    // Root-cause fix: After HMR, React cleanup calls channel.unbind_all() + unsubscribe().
    // The old "if (pusherRef.current) return" guard skipped re-subscription entirely,
    // leaving a live Pusher instance with NO active channel — all events were silently dropped.
    // Now we skip only the constructor; the channel subscribe + bind always runs.
    if (!pusherRef.current) {
      console.log('[PUSHER] Initializing for room:', roomId);
      const newPusher = new Pusher(pusherKey, {
        cluster,
        forceTLS: true,
        authEndpoint: '/api/pusher/auth',
      });
      pusherRef.current = newPusher;

      newPusher.connection.bind('connected', () => {
        console.log('[PUSHER] Connected to', cluster);
        setConnected(true);
      });
      newPusher.connection.bind('error', (err: unknown) => {
        console.log('[PUSHER] Connection error:', err);
      });
      newPusher.connection.bind('disconnected', () => {
        console.log('[PUSHER] Disconnected');
        setConnected(false);
      });
    } else {
      console.log('[PUSHER] Reusing existing instance — re-subscribing channel for room:', roomId);
    }

    const pusher = pusherRef.current;
    const channelName = `presence-${roomId}`;

    // ── Dedup guard: skip re-subscription if we're already on this channel ──
    // React Strict Mode (dev) runs effects twice; without this guard the second
    // run creates a duplicate subscription, doubling all event handlers.
    if (subscribedChannelRef.current === channelName) {
      console.log('[PUSHER] Already subscribed to', channelName, '— skipping duplicate bind');
      return;
    }
    subscribedChannelRef.current = channelName;

    const channel = pusher.subscribe(channelName);

    channel.bind('pusher:subscription_succeeded', async (members: { members: Record<string, unknown>; count: number; myID: string }) => {
      console.log('✅ Subscribed! Members:', members.count, '| isHost:', isHostRef.current);
      setConnected(true);
      setPlayerCount(members.count);

      const memberList = Object.keys(members.members).map((id) => {
        const member = members.members[id] as { name?: string } | undefined;
        return { player: member?.name || `Player_${id.slice(0, 4)}`, score: 0, streak: 0 };
      });
      setLeaderboard(memberList);

      // Fetch current game state from server (source of truth)
      try {
        console.log('[SYNC] Fetching server state for room:', roomId);
        const stateRes = await fetch(`/api/game/state?roomId=${roomId}`);
        const serverState = await stateRes.json();
        console.log('[SYNC] Server state:', JSON.stringify(serverState));
        
        if (serverState.phase === 'winner' || (serverState.phase === 'drawing' && !serverState.imageUrl)) {
          // Round just ended OR Fal.ai generation still in-flight.
          // Set loading=true so the polling fallback activates and picks up the
          // new image the moment start-round finishes writing it to the store.
          // Also reset isGeneratingRef so nothing blocks the poll from applying state.
          console.log('[SYNC] Phase is', serverState.phase, '— activating polling to catch incoming game-started');
          isGeneratingRef.current = false;
          setImageUrl(null);
          setLoading(true);
          setLobbyActive(false);
          // Clear any lingering winner UI from the previous round
          setShowWinner(false);
          setCountdownActive(false);
          setLastHint(null);
        } else if (serverState.imageUrl && serverState.phase && serverState.phase !== 'idle') {
          console.log('🖼️ Active round found on join — applying state');
          setImageUrl(serverState.imageUrl);
          setSecretPrompt(serverState.secretPrompt);
          setCurrentExplanation(serverState.explanation || '');
          setCategory(serverState.category || 'idiom');
          setPhase('playing');
          setLoading(false);
          setLobbyActive(false);
          setRoundStartTime(serverState.roundStartTime || Date.now());
          // Populate leaderboard from server scoreboard so new player sees current scores
          if (serverState.scoreboard) {
            const entries = Object.entries(serverState.scoreboard as Record<string, { score: number; streak: number }>)
              .map(([player, s]) => ({ player, score: s.score, streak: s.streak }))
              .sort((a, b) => b.score - a.score);
            if (entries.length > 0) setLeaderboard(entries);
          }
        } else {
          console.log('[SYNC] No active round — starting lobby');
          setLobbyActive(true);
          setLobbyCountdown(10);
        }
      } catch (e) {
        console.log('[SYNC] State fetch failed:', e);
        setLobbyActive(true);
        setLobbyCountdown(10);
      }
    });

    channel.bind('pusher:member_added', (member: { id: string; info: { name?: string } }) => {
      setPlayerCount(prev => prev + 1);
      setLeaderboard(prev => {
        const exists = prev.find(p => p.player === (member.info.name || `Player_${member.id.slice(0, 4)}`));
        if (exists) return prev;
        return [...prev, { player: member.info.name || `Player_${member.id.slice(0, 4)}`, score: 0, streak: 0 }];
      });
    });

    channel.bind('pusher:member_removed', (member: { id: string; info: { name?: string } }) => {
      setPlayerCount(prev => Math.max(1, prev - 1));
      setLeaderboard(prev => prev.filter(p => p.player !== (member.info.name || `Player_${member.id.slice(0, 4)}`)));
    });

    const handleScoreUpdated = (data: { player: string; score: number; streak: number }) => {
      console.log('📡 PUSHER RECEIVED: client-score-updated', data);
      setLeaderboard(prev => {
        const updated = prev.map(p =>
          p.player === data.player ? { ...p, score: data.score, streak: data.streak } : p
        );
        return updated.sort((a, b) => b.score - a.score);
      });
    };

    const handleGameStarted = (data: { imageUrl: string; prompt: string; category: string; explanation?: string; roundStartTime?: number; roundId?: string }) => {
      console.log('📡 [PUSHER] game-started ▶', { url: data.imageUrl?.slice(0, 80), prompt: data.prompt, roundStartTime: data.roundStartTime, roundId: data.roundId });
      // ── Hard full reset ──────────────────────────────────────────────────────
      // game-started is the ONLY event that transitions the UI out of solved/winner.
      // Every field is explicitly reset so no winner overlay state can linger.
      setImageUrl(data.imageUrl);
      setSecretPrompt(data.prompt);
      setCurrentExplanation(data.explanation || '');
      setCategory(data.category as GameCategory);
      setPhase('playing');
      setLoading(false);
      setLobbyActive(false);
      setStrikes(3);
      setHintUsed(false);
      setRevealedHint(null);
      setLastHint(null);
      setShowWinner(false);
      setIsWinner(false);
      setWinnerName(null);
      setCountdownActive(false);
      setCountdownSeconds(5);
      setGuessHistory([]);
      // setImageLoaded removed
      isGeneratingRef.current = false;
      // Use client receive-time as the local decay timer start — gives exactly 1000 pts
      // at the moment game-started arrives, independent of network latency.
      setRoundStartTime(Date.now());
      setRoundTimedOut(false);
      setBotTypingNames([]);
      setVictoryBotColor(null);
      setIntelligenceEvents([]); // fresh slate each round
      if (data.roundId) setRoundId(data.roundId);
      setTimeout(() => inputRef.current?.focus(), 300);

      // Kick off AI agents — fire-and-forget fallback for the case where the
      // server-side after() orchestration landed on a different Vercel instance.
      // Full round data is included so the receiving instance can reconstruct
      // in-memory state even if it never saw the start-round request.
      if (data.roundId) {
        fetch('/api/game/orchestrate-bots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId,
            roundId:        data.roundId,
            hints:          [],
            imageUrl:       data.imageUrl,
            secretPrompt:   data.prompt,
            roundStartTime: data.roundStartTime,
            explanation:    data.explanation,
            category:       data.category,
          }),
        }).catch(() => {});
      }
    };

    const handleRoundSolved = (data: {
      winner: string | null;
      secret: string;
      timedOut?: boolean;
      points?: number;
      nextRoundIn?: number;
      scoreboard?: Record<string, { score: number; streak: number }>;
    }) => {
      const timedOut = data.timedOut === true || data.winner === null;
      console.log('📡 [PUSHER] round-solved ▶', { winner: data.winner, timedOut, secret: data.secret?.slice(0, 30), nextRoundIn: data.nextRoundIn, points: data.points });
      const won = !timedOut && data.winner === localNameRef.current;
      const winnerBotConfig = data.winner ? getAgentByName(data.winner) : null;
      setVictoryBotColor(winnerBotConfig ? winnerBotConfig.accentColor : null);

      // Stop the decaying points timer immediately
      if (scoreIntervalRef.current) {
        clearInterval(scoreIntervalRef.current);
        scoreIntervalRef.current = null;
      }

      setRoundTimedOut(timedOut);
      setWinnerName(data.winner ?? null);
      setShowWinner(true);
      setIsWinner(won);
      setPhase('winner');
      console.log('[round-solved] ✅ phase=winner timedOut=', timedOut, 'winner=', data.winner);
      setCountdownActive(true);
      setCountdownSeconds(data.nextRoundIn ?? 5);

      // Authoritative secret from server — always reveal on timeout
      if (data.secret) {
        setSecretPrompt(data.secret);
        if (!timedOut) setLastHint(`The answer was: ${data.secret}`);
      }

      // Update leaderboard from server scoreboard (single source of truth)
      if (data.scoreboard) {
        const entries = Object.entries(data.scoreboard)
          .map(([player, s]) => ({ player, score: s.score, streak: s.streak }))
          .sort((a, b) => b.score - a.score);
        setLeaderboard(entries);
        const myEntry = data.scoreboard[localNameRef.current];
        if (myEntry) setScore(myEntry.score);
      } else if (won && data.points) {
        setScore(prev => prev + data.points!);
      }

      if (won) triggerConfetti();
    };

    const handleGameReset = (data: { triggeredBy: string }) => {
      console.log('📡 PUSHER RECEIVED: game-reset', data);
      resetGame();
    };

    const handleGuessMade = (data: { player: string; guess: string; isCorrect?: boolean }) => {
      console.log('📡 PUSHER RECEIVED: guess-made', data);
      // Skip own guesses — they're already added optimistically in handleSubmitGuess
      if (data.player === localNameRef.current) return;
      setGuessHistory(prev => [...prev, { player: data.player, text: data.guess, timestamp: Date.now(), isCorrect: data.isCorrect }]);
    };

    const handleRequestSync = (data: { player: string }) => {
      console.log('📡 PUSHER RECEIVED: client-request-sync', data);
      if (imageUrlRef.current && phaseRef.current !== 'idle') {
        fetch('/api/game/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId,
            action: 'client-sync-state',
            data: {
              imageUrl: imageUrlRef.current,
              secretPrompt: secretPromptRef.current,
              category: categoryRef.current,
              phase: phaseRef.current,
              strikes: strikesRef.current,
              guessHistory: guessHistoryRef.current,
              showWinner: showWinnerRef.current,
              winnerName: winnerNameRef.current,
              requestedBy: data.player,
            },
          }),
        }).catch(console.error);
      }
    };

    const handleSyncState = (data: {
      imageUrl: string;
      secretPrompt: string;
      category: string;
      phase: string;
      strikes: number;
      guessHistory: GuessEntry[];
      showWinner: boolean;
      winnerName: string | null;
    }) => {
      console.log('📡 PUSHER RECEIVED: client-sync-state', { phase: data.phase, imageUrl: data.imageUrl?.slice(0, 60) });
      setImageUrl(data.imageUrl);
      setSecretPrompt(data.secretPrompt);
      setCategory(data.category as GameCategory);
      setPhase(data.phase as 'playing' | 'solved' | 'winner');
      setStrikes(data.strikes);
      setGuessHistory(data.guessHistory);
      setShowWinner(data.showWinner);
      setWinnerName(data.winnerName);
      setLoading(false);
      setRoundStartTime(Date.now());
      setCountdownActive(false);
      setCountdownSeconds(5);
    };

    const handleCountdownStart = (data: { seconds: number; winnerName?: string; secret?: string; isWin: boolean }) => {
      console.log('📡 PUSHER RECEIVED: client-countdown-start', data);
      setCountdownActive(true);
      setCountdownSeconds(data.seconds);
      setCountdownShake(false);
      setShowWinner(true);
      setIsWinner(data.isWin);
      if (data.winnerName) {
        setWinnerName(data.winnerName);
      }
      if (data.secret) {
        const currentT = TRANSLATIONS[language] || TRANSLATIONS['en'];
        setLastHint(`${currentT.outOfGuesses} התשובה הייתה: ${data.secret}`);
      }
      if (data.isWin && data.winnerName === localNameRef.current) {
        // playSound('victory')
        triggerConfetti();
      }
    };

    const handleCountdownEnd = () => {
      console.log('📡 PUSHER RECEIVED: client-countdown-end');
      setCountdownActive(false);
      setShowWinner(false);
      setIsWinner(false);
      setWinnerName(null);
      setLastHint(null);
      setLoading(true); // show spinner until game-started arrives
    };

    channel.bind('game-started', handleGameStarted);
    channel.bind('round-solved', handleRoundSolved);   // server-authoritative victory event
    channel.bind('game-solved', handleRoundSolved);    // legacy alias
    channel.bind('game-reset', handleGameReset);
    channel.bind('guess-made', handleGuessMade);
    channel.bind('client-request-sync', handleRequestSync);
    channel.bind('client-sync-state', handleSyncState);
    channel.bind('client-countdown-start', handleCountdownStart);
    channel.bind('client-countdown-end', handleCountdownEnd);
    channel.bind('client-score-updated', handleScoreUpdated);
    channel.bind('client-reaction', (data: { emoji: string; player: string }) => {
      console.log('📡 PUSHER RECEIVED: client-reaction', data);
      const id = reactionIdRef.current++;
      setReactions(prev => [...prev, { id, emoji: data.emoji, x: Math.random() * 80 + 10, y: Math.random() * 60 + 20 }]);
      setTimeout(() => {
        setReactions(prev => prev.filter(r => r.id !== id));
      }, 2500);
    });

    // ── intelligence-update: strategy engine broadcast ───────────────────────
    channel.bind('intelligence-update', (data: { event: IntelligenceEvent; prunedConcepts: string[] }) => {
      console.log('📡 [PUSHER] intelligence-update ▶', data.event.agentName, data.event.isCorrect ? '✓' : '✗');
      setIntelligenceEvents(prev => [...prev, data.event].slice(-300)); // keep last 300 events

      // PRD v5.0 — Refresh strategy profiles on round-completion events so the
      // AGENTS tab shows up-to-date style evolution. Fire-and-forget fetch.
      if (data.event.isCorrect) {
        fetch('/api/game/strategy-profiles')
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d?.profiles) setStrategyProfiles(d.profiles); })
          .catch(() => {});
      }
    });

    // ── bot-typing: an AI agent is about to submit a guess ─────────────────
    channel.bind('bot-typing', (data: { agentName: string; agentId: string; attemptNumber?: number }) => {
      const label = data.attemptNumber && data.attemptNumber > 1
        ? `${data.agentName} (retry #${data.attemptNumber})`
        : data.agentName;
      console.log('📡 [PUSHER] bot-typing ▶', label);
      setBotTypingNames(prev => prev.includes(data.agentName) ? prev : [...prev, data.agentName]);
      // Auto-clear after 3 s (slightly longer than the 2 s lead time + network)
      setTimeout(() => {
        setBotTypingNames(prev => prev.filter(n => n !== data.agentName));
      }, 3000);
    });

    // ── hint-revealed: deadlock-break hint from the orchestrator ─────────────
    // Fires when all bots have failed attempt 1 and the system auto-reveals a hint.
    // Populate revealedHint so it appears in the hint card, and show it as a lastHint
    // banner so human players also benefit.
    channel.bind('hint-revealed', (data: { hint: string; roundId: string; source: string; message: string }) => {
      console.log('📡 [PUSHER] hint-revealed ▶', data.hint, '(source:', data.source, ')');
      // Only apply if this hint is for the current round
      setRevealedHint(data.hint);
      setLastHint(data.message || `💡 ${data.hint}`);
      setTimeout(() => setLastHint(null), 5000);
    });

    // ── round-error: Fal.ai generation failed ───────────────────────────────
    // Server reset phase to 'idle' and broadcast this event.
    // Show a transient hint and let the poll wakeup or lobby retry handle the restart.
    channel.bind('round-error', (data: { message: string; retryIn: number }) => {
      console.warn('📡 [PUSHER] round-error ▶', data.message);
      setLoading(false);
      isGeneratingRef.current = false;
      setLastHint('⚠️ Image generation failed — retrying...');
      // Auto-retry after the server's suggested delay
      setTimeout(() => {
        setLastHint(null);
        setLoading(true);
        pollIdleCountRef.current = POLL_IDLE_THRESHOLD; // force wakeup on next poll tick
      }, (data.retryIn ?? 3) * 1000);
    });

    return () => {
      // Keep Pusher instance alive (singleton) - only unsubscribe from channel
      channel.unbind_all();
      pusher.unsubscribe(channelName);
      subscribedChannelRef.current = ''; // clear dedup guard so re-subscription is allowed
      // Do NOT disconnect - reuse the singleton instance
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]); // Only re-run if roomId changes - handlers use refs for latest values

  const handleGetHint = async () => {
    if (!secretPrompt || hintUsed) return;

    try {
      const response = await fetch('/api/game/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get-hint', secretPrompt, language }),
      });
      const result = await response.json();
      
      if (result.hint) {
        setRevealedHint(result.hint);
        setHintUsed(true);
      }
    } catch (error) {
      console.error('Hint error:', error);
    }
  };

  const handleSubmitGuess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guessText.trim() || !secretPrompt || strikes <= 0 || showWinner) return;

    const submittedGuess = guessText.trim();
    const guessTime = roundStartTime ? Date.now() - roundStartTime : 0;
    const isFast = guessTime < 10000;

    // Optimistic guess entry (isCorrect resolved after server responds)
    setGuessHistory(prev => [...prev, { player: localName, text: submittedGuess, timestamp: Date.now() }]);
    setGuessText('');

    // ── OPTIMISTIC VICTORY ────────────────────────────────────────────────────
    // quickLocalMatch is synchronous — if it matches, show the win screen NOW
    // before the server even receives the request. The server will confirm and
    // broadcast round-solved to all other clients in parallel.
    const optimisticWin = secretPrompt ? quickLocalMatch(submittedGuess, secretPrompt) : false;
    if (optimisticWin) {
      const timeTaken = roundStartTime ? (Date.now() - roundStartTime) / 1000 : 0;
      setResponseTime(Math.round(timeTaken * 100) / 100);
      setShowWinner(true);
      setWinnerName(localName);
      setIsWinner(true);
      setPhase('winner');
      setCountdownActive(true);
      setCountdownSeconds(5);
      triggerConfetti();
      setLastHint(t.youWon);
      const newStreak = streak + 1;
      setStreak(newStreak);
    }

    try {
      const response = await fetch('/api/game/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guess: submittedGuess,
          secretPrompt,
          roomId,
          playerName: localName,
          language,
          hintUsed,
          isFast,
        }),
      });
      const result = await response.json();

      // Update guess history entry with confirmed isCorrect
      setGuessHistory(prev => prev.map(g =>
        g.player === localName && g.text === submittedGuess && g.isCorrect === undefined
          ? { ...g, isCorrect: result.isCorrect }
          : g
      ));

      // Broadcast intelligence event for analytics (human guess — fire-and-forget)
      if (roundId) {
        fetch('/api/game/broadcast-intelligence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId,
            roundId,
            agentName:   localName,
            guess:       submittedGuess,
            isCorrect:   !!result.isCorrect,
            solveTimeMs: guessTime,
            riskProfile: null,
          }),
        }).catch(() => {});
      }

      if (result.isCorrect) {
        // Server confirmed win — the round-solved Pusher event will sync scoreboard
        // for all clients. Local score will be updated when handleRoundSolved fires.
        if (!optimisticWin) {
          // Groq found it correct but local check missed it — show win now
          const timeTaken = roundStartTime ? (Date.now() - roundStartTime) / 1000 : 0;
          setResponseTime(Math.round(timeTaken * 100) / 100);
          setShowWinner(true);
          setWinnerName(localName);
          setIsWinner(true);
          setPhase('winner');
          setCountdownActive(true);
          setCountdownSeconds(5);
          triggerConfetti();
          setLastHint(t.youWon);
          setStreak(prev => prev + 1);
        }
      } else {
        // Wrong guess — undo optimistic win if we jumped the gun (shouldn't happen
        // since quickLocalMatch has no false positives, but be safe)
        if (optimisticWin) {
          setShowWinner(false);
          setIsWinner(false);
          setCountdownActive(false);
          setPhase('playing');
        }
        setStreak(0);
        setStrikes(prev => {
          const newStrikes = prev - 1;
          if (newStrikes <= 0) startCountdown(false, secretPrompt);
          return newStrikes;
        });
        if (result.close) {
          setLastHint(t.close);
          setTimeout(() => setLastHint(null), 2000);
        } else {
          setLastHint(result.hint || 'Not quite!');
        }
      }
    } catch (error) {
      setLastHint('Error validating guess');
    }
  };

  // Client-side local countdown display only (no next-round trigger — server handles that)
  const startCountdown = (isWin: boolean, lostSecret?: string) => {
    setCountdownActive(true);
    setCountdownSeconds(5);
    setCountdownShake(false);
    setShowWinner(true);
    setIsWinner(isWin);
    if (isWin) setWinnerName(localName);
    if (lostSecret) {
      setLastHint(`${t.outOfGuesses} התשובה הייתה: ${lostSecret}`);
      setStreak(0);
    }
    if (isWin) triggerConfetti();

    const interval = setInterval(() => {
      setCountdownSeconds(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          // Just reset UI — server will send game-started when next round is ready
          setCountdownActive(false);
          setShowWinner(false);
          setIsWinner(false);
          setWinnerName(null);
          setLastHint(null);
          setLoading(true); // show spinner while waiting for server game-started
          return 0;
        }
        if (prev - 1 === 2) {
          setCountdownShake(true);
          setTimeout(() => setCountdownShake(false), 500);
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Legacy: called by client-countdown-end Pusher event — server now drives next round
  const endCountdown = useCallback(() => {
    setCountdownActive(false);
    setCountdownSeconds(5);
    setShowWinner(false);
    setIsWinner(false);
    setWinnerName(null);
    setLastHint(null);
    setLoading(true); // show spinner until server sends game-started
  }, []);

  const skipCountdown = () => {
    endCountdown();
  };

  const toggleLanguage = () => {
    setLanguage(prev => prev === 'en' ? 'he' : 'en');
  };

  // Audio disabled - uncomment when sound files exist
  // const playSound = useCallback((type: 'victory' | 'tick' | 'wrong') => {
  //   if (isMuted) return;
  //   const audioRef = type === 'victory' ? audioVictoryRef : type === 'tick' ? audioTickRef : audioWrongRef;
  //   if (audioRef.current) {
  //     audioRef.current.currentTime = 0;
  //     audioRef.current.play().catch(() => {});
  //   }
  // }, [isMuted]);

  const playSound = useCallback((type: 'victory' | 'tick' | 'wrong') => {
    // Audio disabled - no-op
  }, []);

  const triggerConfetti = useCallback(() => {
    const duration = 2000;
    const end = Date.now() + duration;
    
    const frame = () => {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: ['#fbbf24', '#f97316', '#ef4444', '#22c55e', '#3b82f6'],
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: ['#fbbf24', '#f97316', '#ef4444', '#22c55e', '#3b82f6'],
      });
      
      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    };
    frame();
  }, []);

  const handleShare = async () => {
    if (!secretPrompt || responseTime === null) return;
    
    const wittyComment = currentExplanation 
      ? `The AI thought it was "${currentExplanation.slice(0, 50)}..." but I knew it was "${secretPrompt}"!`
      : `I knew the answer was "${secretPrompt}"!`;
    
    const shareText = `I cracked '${secretPrompt}' in ${responseTime}s! ⚡🔥\nCurrent Streak: ${streak} wins!\n\n${wittyComment}\n\nCan you beat me in AI Vision?\n${typeof window !== 'undefined' ? window.location.href : ''}`;
    
    if (navigator.share && navigator.canShare?.({ text: shareText })) {
      try {
        await navigator.share({ text: shareText });
      } catch (e) {
        await navigator.clipboard.writeText(shareText);
      }
    } else {
      try {
        await navigator.clipboard.writeText(shareText);
        setCopyLinkSuccess(true);
        setTimeout(() => setCopyLinkSuccess(false), 2000);
      } catch (e) {
        console.error('Failed to copy:', e);
      }
    }
  };

  const handleCopyInvite = async () => {
    const inviteLink = typeof window !== 'undefined' ? window.location.href : `https://ai-vision-game.vercel.app/game/${roomId}`;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy invite link:', e);
    }
  };

  const sendReaction = (emoji: string) => {
    fetch('/api/game/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId,
        action: 'client-reaction',
        data: { emoji, player: localName },
      }),
    }).catch(console.error);
    const id = reactionIdRef.current++;
    setReactions(prev => [...prev, { id, emoji, x: Math.random() * 80 + 10, y: Math.random() * 60 + 20 }]);
    setTimeout(() => {
      setReactions(prev => prev.filter(r => r.id !== id));
    }, 2500);
  };

  useEffect(() => {
    if (phase === 'playing' && !countdownActive) {
      // PRD v4.0: Use exponential decay R_i(t) = P_max · e^(−λt) instead of linear decay.
      // Sync starting value with how long the round has already been running so
      // a player joining mid-round sees the correct decayed value immediately.
      const now = Date.now();
      const initialPoints = roundStartTime
        ? computeDecayedReward(now - roundStartTime)
        : computeDecayedReward(0);
      setCurrentPotentialPoints(initialPoints);
      setShowStreak(streak >= 3);

      if (scoreIntervalRef.current) clearInterval(scoreIntervalRef.current);

      // Tick every 500ms for smoother display; compute from source-of-truth roundStartTime
      scoreIntervalRef.current = setInterval(() => {
        if (roundStartTime) {
          setCurrentPotentialPoints(computeDecayedReward(Date.now() - roundStartTime));
        } else {
          // Fallback: tick without reference time (less accurate)
          setCurrentPotentialPoints(prev => computeDecayedReward(
            // back-calculate approximate elapsed from current reward
            Math.max(0, prev - 1)
          ));
        }
      }, 500);
    } else {
      if (scoreIntervalRef.current) {
        clearInterval(scoreIntervalRef.current);
        scoreIntervalRef.current = null;
      }
    }

    return () => {
      if (scoreIntervalRef.current) clearInterval(scoreIntervalRef.current);
    };
  }, [phase, countdownActive, streak, roundStartTime]);

  // ── Post-victory countdown tick ─────────────────────────────────────────────
  // When countdownActive=true, decrement countdownSeconds every second.
  // At 0: immediately clear the overlay (setPhase/loading) for instant visual
  // feedback. The server's game-started Pusher event arriving ~5s after round-solved
  // does the authoritative full reset — this just keeps the UI responsive.
  useEffect(() => {
    if (!countdownActive) return;

    const initialSeconds = countdownSeconds; // capture at activation time
    const tick = setInterval(() => {
      setCountdownSeconds(prev => {
        const next = prev - 1;
        if (next <= 1) setCountdownShake(true);
        if (next <= 0) {
          clearInterval(tick);
          // Immediate visual reset while we wait for game-started Pusher
          setCountdownActive(false);
          setShowWinner(false);
          setPhase('drawing' as any);
          setLoading(true);
          setImageUrl(null);
          setCountdownShake(false);
          return 0;
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(tick);
  // Only re-run when countdown activates — NOT on every seconds change,
  // that would reset the interval and freeze the timer.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdownActive]);

  // Heartbeat removed — clients never push phase to the server.
  // Recovery covered by: polling fallback + double Pusher broadcast + state fetch on join.

  // nextRoundData useEffect removed

  useEffect(() => {
    if (!hasSeenTutorial && isMounted) {
      setShowTutorial(true);
      setHasSeenTutorial(true);
      localStorage.setItem('hasSeenTutorial', 'true');
      setTimeout(() => setShowTutorial(false), 3000);
    }
  }, [hasSeenTutorial, isMounted]);

  useEffect(() => {
    const savedTutorial = localStorage.getItem('hasSeenTutorial');
    if (savedTutorial === 'true') {
      setHasSeenTutorial(true);
    }
  }, []);

  // ── Polling fallback ─────────────────────────────────────────────────────────
  // If a client is loading (waiting for Pusher) but has no imageUrl after 2 s,
  // poll /api/game/state every 2 s until the server has the image.
  // This handles:
  //   • Pusher delivery failures
  //   • Browser B that got {inProgress:true, imageUrl:null} and is stuck waiting
  //   • Refresh mid-round before Pusher resubscribes
  //   • Server stuck in 'idle'/'winner' after a Fal.ai failure (wakeup via needsNewRound)
  useEffect(() => {
    if (!loading || imageUrl) return; // Only run when genuinely stuck

    pollIdleCountRef.current = 0; // reset counter each time polling activates
    console.log('[POLL] 🔄 Starting 2s polling — loading with no image');

    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/game/state?roomId=${roomId}`);
        const state = await res.json();
        // Skip 'winner' phase — that's the old round's state still in the store.
        // Applying it would restore the ghost image that was just cleared at countdown=0.
        if (state.imageUrl && state.phase && state.phase !== 'idle' && state.phase !== 'winner') {
          console.log('[POLL] ✅ Image found via polling:', state.imageUrl.slice(0, 60));
          clearInterval(poll);
          pollIdleCountRef.current = 0;
          isGeneratingRef.current = false;
          setImageUrl(state.imageUrl);
          setSecretPrompt(state.secretPrompt);
          setCurrentExplanation(state.explanation || '');
          setCategory(state.category || 'idiom');
          setPhase('playing');
          setLoading(false);
          setLobbyActive(false);
          setShowWinner(false);
          setCountdownActive(false);
          setLastHint(null);
          setGuessHistory([]);
          setStrikes(3);
          setRoundStartTime(state.roundStartTime || Date.now());
          setTimeout(() => inputRef.current?.focus(), 300);
        } else {
          pollIdleCountRef.current += 1;
          console.log('[POLL] ⏳ Server not ready (phase:', state.phase, ', needsNewRound:', state.needsNewRound, ', count:', pollIdleCountRef.current, ')');

          // ── Force wakeup ─────────────────────────────────────────────────────
          // After POLL_IDLE_THRESHOLD consecutive non-image responses (or when the
          // state route signals needsNewRound), the client self-heals by calling
          // start-round directly.  This covers:
          //   • Fal.ai failure (phase reset to 'idle', needsNewRound=true)
          //   • Stale 'winner' phase where prefetch silently failed (needsNewRound=true after 20 s)
          //   • Any other scenario where no round ever starts
          if (state.needsNewRound || pollIdleCountRef.current >= POLL_IDLE_THRESHOLD) {
            console.log('[POLL] 🚨 Force wakeup — calling start-round (needsNewRound:', state.needsNewRound, ')');
            pollIdleCountRef.current = 0;
            isGeneratingRef.current = false;
            triggerServerRoundRef.current();
          }
        }
      } catch (e) {
        console.warn('[POLL] Fetch failed:', e);
      }
    }, 2000);

    return () => {
      console.log('[POLL] Stopping poll (loading/imageUrl changed)');
      clearInterval(poll);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, imageUrl, roomId]);

  useEffect(() => {
    // Fallback: if Pusher fails to connect, activate lobby after 3s so the game still starts
    if (!connected) {
      const fallbackTimer = setTimeout(() => {
        if (phaseRef.current === 'idle') {
          setLobbyActive(true);
        }
      }, 3000);
      return () => clearTimeout(fallbackTimer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  useEffect(() => {
    if (!lobbyActive) return;

    console.log('[LOBBY] Starting countdown timer');
    const EMERGENCY_TIMEOUT_MS = process.env.NODE_ENV === 'development' ? 3000 : 5000;

    const interval = setInterval(() => {
      setLobbyCountdown(prev => {
        const next = prev - 1;
        if (next <= 0) {
          clearInterval(interval);
          setLobbyActive(false);
          console.log('[LOBBY] ⏱ Countdown done. Triggering server round...');

          // RULE: Every client calls the API. Server /start-round returns
          // existing state if a round is already in progress, so this is safe.
          console.log('[LOBBY] 🚀 Calling /api/game/start-round...');
          triggerServerRoundRef.current();

          // Emergency fallback: if no image after timeout, fetch state directly.
          // Uses !imageUrlRef.current (not phase check) because phase may already
          // be 'playing' on one browser while this one is still loading.
          setTimeout(() => {
            if (!imageUrlRef.current) {
              console.log('[LOBBY] ⚠️ No image after emergency timeout — force fetching state');
              // Reset the generating lock so triggerServerRound can re-run if needed
              isGeneratingRef.current = false;
              fetch(`/api/game/state?roomId=${roomId}`)
                .then(res => res.json())
                .then(state => {
                  if (state.imageUrl) {
                    console.log('[LOBBY] 🖼️ Emergency state applied:', state.imageUrl.slice(0, 60));
                    setImageUrl(state.imageUrl);
                    setSecretPrompt(state.secretPrompt);
                    setCurrentExplanation(state.explanation || '');
                    setCategory(state.category || 'idiom');
                    setPhase('playing');
                    setLoading(false);
                    setLobbyActive(false);
                    setRoundStartTime(state.roundStartTime || Date.now());
                  } else {
                    // Server also has nothing — trigger generation (lock is now released)
                    console.log('[LOBBY] 🔁 Server has no state yet, retrying start-round...');
                    triggerServerRoundRef.current();
                  }
                })
                .catch(() => {
                  isGeneratingRef.current = false;
                  triggerServerRoundRef.current();
                });
            }
          }, EMERGENCY_TIMEOUT_MS);

          return 0;
        }
        return next;
      });
    }, 1000);

    return () => {
      console.log('[LOBBY] Clearing countdown interval');
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lobbyActive, roomId]);

  useEffect(() => {
    if (lobbyActive && playerCount <= 1 && phase === 'idle') {
      console.log('[LOBBY] Scheduling AI agents from AGENT_REGISTRY...');
      botTimeoutRef.current = setTimeout(() => {
        const newBots = AGENT_REGISTRY.map(agent => ({
          name: agent.name,
          joinedAt: Date.now(),
          ready: false,
        }));
        setBots(newBots);
        setLeaderboard(prev => {
          const withBots = [...prev];
          for (const b of newBots) {
            if (!withBots.find(e => e.player === b.name)) {
              withBots.push({ player: b.name, score: 0, streak: 0 });
            }
          }
          return withBots;
        });
        setPlayerCount(prev => prev + newBots.length);
        console.log('[LOBBY] AI agents joined:', newBots.map(b => b.name).join(', '));
        // Mark agents ready with staggered delays for realistic feel
        newBots.forEach((bot, i) => {
          setTimeout(() => {
            setBots(prev => prev.map(b => b.name === bot.name ? { ...b, ready: true } : b));
          }, 2000 + i * 800);
        });
      }, 4000);
      return () => {
        if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
      };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lobbyActive, playerCount]);

  useEffect(() => {
    const interval = setInterval(() => {
      setGlobalPlayersOnline(prev => prev + Math.floor(Math.random() * 5) - 2);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  if (!isMounted) {
    return (
      <div className="flex flex-1 h-screen bg-[#050510] items-center justify-center" suppressHydrationWarning>
        <div className="flex flex-col items-center gap-3" suppressHydrationWarning>
          <div className="relative w-10 h-10">
            <div className="absolute inset-0 rounded-full" style={{ border: '2px solid rgba(6,182,212,0.25)', borderTopColor: '#06b6d4', animation: 'spin 1s linear infinite' }} />
          </div>
          <span className="text-cyan-400/70 text-sm tracking-widest uppercase font-medium">Loading Arena...</span>
        </div>
      </div>
    );
  }

  return (
    // suppressHydrationWarning on the fragment root silences browser-extension
    // attribute injections (e.g. bis_skin_checked) that cause harmless React warnings
    <div suppressHydrationWarning>
      <style suppressHydrationWarning>{shakeKeyframes}</style>
      {/* Deep obsidian arena */}
      <div className="flex flex-1 h-screen bg-[#050510] overflow-hidden" dir={isRTL ? 'rtl' : 'ltr'} suppressHydrationWarning>

        {/* Arena grid overlay */}
        <div className="fixed inset-0 arena-grid pointer-events-none" />

        {/* Ambient glow orbs */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-[-25%] left-[5%] w-[600px] h-[600px] rounded-full opacity-[0.055]"
            style={{ background: 'radial-gradient(circle, #06b6d4 0%, transparent 65%)' }} />
          <div className="absolute bottom-[-25%] right-[5%] w-[700px] h-[700px] rounded-full opacity-[0.045]"
            style={{ background: 'radial-gradient(circle, #a855f7 0%, transparent 65%)' }} />
        </div>

        {/* Stars */}
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="particle"
            style={{
              width: `${1 + (i % 3)}px`,
              height: `${1 + (i % 3)}px`,
              left: `${(i * 37 + 11) % 100}%`,
              top: `${(i * 53 + 7) % 100}%`,
              animationDelay: `${(i * 0.4) % 3}s`,
              animationDuration: `${2.5 + (i % 4) * 0.8}s`,
            }}
          />
        ))}

      <AnimatePresence>
        {showTutorial && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: 'rgba(5,5,16,0.88)', backdropFilter: 'blur(10px)' }}
          >
            <motion.div
              initial={{ scale: 0.78, y: 30, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 280, damping: 22 }}
              className="rounded-2xl p-8 text-center max-w-sm mx-4"
              style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(30px)', border: '1px solid rgba(6,182,212,0.22)', boxShadow: '0 0 50px rgba(6,182,212,0.12), inset 0 0 40px rgba(6,182,212,0.02)' }}
            >
              <motion.div className="text-5xl mb-4"
                animate={{ rotate: [0, -10, 10, -5, 5, 0] }}
                transition={{ duration: 0.8, delay: 0.3 }}
              >🎯</motion.div>
              <h2 className="text-2xl font-bold text-white mb-4 tracking-tight">How to Play</h2>
              <div className="space-y-3 text-sm text-gray-300">
                <p className="flex items-center justify-center gap-2"><span className="text-cyan-400">🔍</span><strong className="text-white">Reveal</strong> the idiom before your rivals</p>
                <p className="flex items-center justify-center gap-2"><span className="text-yellow-400">⚡</span><strong className="text-white">Faster</strong> answers = More points</p>
                <p className="flex items-center justify-center gap-2"><span className="text-purple-400">🏆</span><strong className="text-white">Compete</strong> and climb the leaderboard!</p>
              </div>
              <div className="mt-5 px-3 py-1.5 rounded-full inline-block text-xs font-bold tracking-wide"
                style={{ background: 'rgba(6,182,212,0.12)', border: '1px solid rgba(6,182,212,0.3)', color: '#67e8f9' }}>
                Hebrew Idioms Edition 🇮🇱
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* ── Non-countdown winner flash ── */}
      <AnimatePresence>
        {showWinner && !countdownActive && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: isWinner ? 'rgba(5,18,12,0.92)' : 'rgba(10,5,20,0.92)', backdropFilter: 'blur(10px)' }}
          >
            <motion.div
              initial={{ scale: 0.65, y: 40, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20 }}
              className="text-center max-w-sm mx-4 p-8 rounded-2xl"
              style={{
                background: isWinner ? 'rgba(16,185,129,0.07)' : 'rgba(139,92,246,0.07)',
                border: isWinner ? '1px solid rgba(16,185,129,0.28)' : '1px solid rgba(139,92,246,0.28)',
                boxShadow: isWinner ? '0 0 60px rgba(16,185,129,0.18)' : '0 0 60px rgba(139,92,246,0.18)',
                backdropFilter: 'blur(20px)',
              }}
              dir="rtl"
            >
              <motion.p className="text-6xl mb-4"
                animate={{ scale: [1, 1.25, 1], rotate: [0, 12, -12, 0] }}
                transition={{ duration: 0.7, delay: 0.15 }}
              >{isWinner ? '🎉' : '🎊'}</motion.p>
              <h2 className="text-4xl font-bold text-white mb-6 tracking-tight">
                {isWinner ? t.youWon : `${winnerName} ${t.someoneWon}`}
              </h2>
              <motion.button
                onClick={handleRestart}
                className="px-8 py-3 font-bold rounded-xl text-white"
                style={{ background: isWinner ? 'linear-gradient(135deg,#10b981,#059669)' : 'linear-gradient(135deg,#8b5cf6,#7c3aed)', boxShadow: isWinner ? '0 4px 20px rgba(16,185,129,0.4)' : '0 4px 20px rgba(139,92,246,0.4)' }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                {t.nextRound}
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Victory border flash (bot win) ── */}
      {countdownActive && victoryBotColor && (
        <div
          className="fixed inset-0 z-[51] rounded-none victory-border-flash pointer-events-none"
          style={{ '--vbf-color': victoryBotColor } as React.CSSProperties}
        />
      )}

      {/* ── Victory countdown (Arena Reveal) ── */}
      {countdownActive && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(5,5,16,0.94)', backdropFilter: 'blur(14px)' }}
        >
          <div className="text-center px-4 max-w-lg w-full" dir="rtl">
            {/* Icon with spring bounce */}
            <motion.p className="text-6xl mb-3"
              initial={{ scale: 0, rotate: -30 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 14, delay: 0.1 }}
            >{roundTimedOut ? '⏰' : isWinner ? '🏆' : '🎊'}</motion.p>

            {/* Headline */}
            <motion.h2 className="text-3xl font-bold mb-1 tracking-tight"
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
              style={{ color: roundTimedOut ? '#fb923c' : 'white' }}
            >
              {roundTimedOut
                ? "Time's Up!"
                : isWinner ? t.countdownTitleWin : `${winnerName || ''} ${t.someoneWon}`}
            </motion.h2>
            {roundTimedOut && (
              <motion.p className="text-sm text-gray-500 mb-3"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
              >
                No one guessed the idiom — here's what it was:
              </motion.p>
            )}

            {/* Answer card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: roundTimedOut ? 0.35 : 0.3 }}
              className="rounded-xl p-4 mb-4 text-right"
              style={{
                background: roundTimedOut ? 'rgba(251,146,60,0.06)' : 'rgba(255,255,255,0.04)',
                border: roundTimedOut ? '1px solid rgba(251,146,60,0.25)' : '1px solid rgba(255,255,255,0.09)',
                backdropFilter: 'blur(20px)',
              }}
            >
              {roundTimedOut && (
                <p className="text-[10px] text-orange-500 font-bold tracking-widest uppercase mb-2">📖 The Answer</p>
              )}
              <p className="font-bold text-yellow-300 mb-2"
                style={{
                  fontSize: roundTimedOut ? '2.5rem' : '1.875rem',
                  textShadow: roundTimedOut ? '0 0 30px rgba(251,191,36,0.6)' : '0 0 20px rgba(251,191,36,0.4)',
                }}
              >{secretPrompt}</p>
              {currentExplanation && (
                <div className="mt-2">
                  <span className="text-xs px-2 py-1 rounded-full font-bold"
                    style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.35)', color: '#93c5fd' }}>
                    🤖 {t.aiInsight}
                  </span>
                  <p className="text-sm text-gray-300 mt-2 leading-relaxed">{currentExplanation}</p>
                </div>
              )}
            </motion.div>

            {/* Solve time */}
            {isWinner && responseTime && (
              <motion.p className="text-lg font-bold mb-2"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
                style={{ color: '#06b6d4', textShadow: '0 0 12px rgba(6,182,212,0.5)' }}
              >⚡ {t.solvedIn} {responseTime}{t.seconds}</motion.p>
            )}

            {/* Share */}
            {isWinner && (
              <motion.button onClick={handleShare}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
                className="mb-4 px-5 py-2 font-bold rounded-xl flex items-center gap-2 mx-auto text-sm"
                style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.35)', color: '#93c5fd' }}
                whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
              >
                <span>📤</span>
                {copyLinkSuccess ? t.copied : t.shareResult}
              </motion.button>
            )}

            {/* Countdown label */}
            <p className="text-sm text-gray-500 mb-2 tracking-widest uppercase">{t.countdownSubtitle}</p>

            {/* Big digit */}
            <motion.div
              key={countdownSeconds}
              className={`text-9xl font-bold text-white mb-4 select-none ${countdownShake ? 'animate-shake' : ''}`}
              initial={{ scale: 1.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.22, type: 'spring', stiffness: 450, damping: 18 }}
              style={{ textShadow: countdownSeconds <= 2 ? '0 0 40px rgba(239,68,68,0.7)' : '0 0 30px rgba(255,255,255,0.35)' }}
            >
              {countdownSeconds}
            </motion.div>

            {/* Progress bar */}
            <div className="w-56 h-1 rounded-full overflow-hidden mx-auto" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <motion.div className="h-full rounded-full"
                style={{ background: 'linear-gradient(90deg,#06b6d4,#a855f7)', boxShadow: '0 0 8px #06b6d4', originX: 0 }}
                animate={{ scaleX: countdownSeconds / 5 }}
                transition={{ duration: 0.9, ease: 'linear' }}
              />
            </div>
          </div>
        </motion.div>
      )}

      <div className="flex flex-col w-full relative z-10">
        {/* ── Header (glassmorphism) ── */}
        <header className="flex flex-wrap items-center justify-between px-4 py-3 gap-2 sm:px-6 sm:py-3.5"
          style={{ background: 'rgba(5,5,16,0.82)', backdropFilter: 'blur(24px)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>

          {/* Room + player info */}
          <div className="flex items-center gap-2 text-xs sm:text-sm">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
              style={{ background: 'rgba(6,182,212,0.07)', border: '1px solid rgba(6,182,212,0.2)' }}>
              <span className="text-gray-500 text-[11px]">{t.room}</span>
              <span className="text-cyan-400 font-mono font-bold tracking-wider">{roomId}</span>
            </div>
            <span className="text-gray-700 hidden sm:inline">·</span>
            <span
              className="flex items-center gap-1 cursor-pointer group transition-all"
              onClick={() => {
                const newName = prompt('Enter your nickname:', localName);
                if (newName && newName.trim()) {
                  setLocalName(newName.trim());
                  localStorage.setItem('playerName', newName.trim());
                }
              }}
            >
              <span className="text-gray-500 hidden sm:inline text-[11px]">{t.playingAs}:</span>
              <span className="text-white font-semibold group-hover:text-cyan-300 transition-colors">{localName}</span>
              <span className="text-gray-600 text-[10px] group-hover:text-gray-400 transition-colors">✏️</span>
            </span>
          </div>

          {/* Score */}
          <div className="flex items-center gap-1.5">
            <span className="text-gray-600 text-xs">{t.myScore}:</span>
            <motion.span
              key={score}
              className="text-xl font-bold text-yellow-400"
              initial={{ scale: 1.55 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 15 }}
              style={{ textShadow: '0 0 12px rgba(251,191,36,0.4)' }}
            >{score}</motion.span>
            <span className="text-gray-600 text-xs">{t.points}</span>
          </div>

          {/* Decaying points + streak — PRD v4.0: R_i label */}
          {phase === 'playing' && !countdownActive && (
            <div className="flex items-center gap-2 text-xs sm:text-sm">
              <div className="flex flex-col items-end leading-tight">
                <motion.span
                  className="font-bold text-lg"
                  style={{ color: '#06b6d4', fontFamily: 'monospace' }}
                  animate={{ textShadow: ['0 0 8px rgba(6,182,212,0.3)','0 0 22px rgba(6,182,212,0.8)','0 0 8px rgba(6,182,212,0.3)'] }}
                  transition={{ repeat: Infinity, duration: 1.6 }}
                >+{currentPotentialPoints}</motion.span>
                <span className="text-[9px] text-gray-600 tracking-widest" style={{ fontFamily: 'monospace' }}>
                  R<sub>i</sub>
                </span>
              </div>
              {showStreak && (
                <motion.span
                  className="text-orange-400 font-bold flex items-center gap-1"
                  animate={{ scale: [1, 1.12, 1] }}
                  transition={{ repeat: Infinity, duration: 0.9 }}
                >🔥 x{streak >= 5 ? '2' : '1.5'}</motion.span>
              )}
            </div>
          )}

          {/* Right controls */}
          <div className="flex items-center gap-2">
            {/* Live dot */}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <span
                className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400 status-dot-live' : 'bg-yellow-400 animate-pulse'}`}
                style={connected ? { boxShadow: '0 0 6px #10b981' } : {}}
              />
              <span className="text-xs" style={{ color: connected ? '#6ee7b7' : '#fbbf24' }}>
                {connected ? 'Live' : '...'}
              </span>
            </div>

            {/* Mute */}
            <motion.button
              onClick={() => { setIsMuted(!isMuted); localStorage.setItem('isMuted', String(!isMuted)); }}
              className="p-1.5 rounded-lg transition-all"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
              whileHover={{ scale: 1.1, background: 'rgba(255,255,255,0.1)' }}
              whileTap={{ scale: 0.9 }}
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
              )}
            </motion.button>

            {/* Language */}
            <motion.button
              onClick={toggleLanguage}
              className="px-3 py-1.5 font-bold rounded-lg text-xs"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: '#9ca3af' }}
              whileHover={{ scale: 1.05, background: 'rgba(255,255,255,0.1)', color: '#e5e7eb' }}
              whileTap={{ scale: 0.95 }}
            >
              {language === 'en' ? 'עברית' : 'English'}
            </motion.button>

            {/* Leaderboard */}
            <motion.button
              onClick={() => { setShowLeaderboard(!showLeaderboard); setShowAnalytics(false); }}
              className="px-3 py-1.5 font-bold rounded-lg text-xs flex items-center gap-1.5"
              style={{ background: 'linear-gradient(135deg,rgba(245,158,11,0.12),rgba(234,88,12,0.12))', border: '1px solid rgba(245,158,11,0.28)', color: '#fbbf24' }}
              whileHover={{ scale: 1.05, boxShadow: '0 0 14px rgba(245,158,11,0.25)' }}
              whileTap={{ scale: 0.95 }}
            >
              <span>🏆</span>
              <span className="hidden sm:inline">Leaderboard</span>
            </motion.button>

            {/* Analytics Terminal */}
            <motion.button
              onClick={() => { setShowAnalytics(!showAnalytics); setShowLeaderboard(false); }}
              className="px-3 py-1.5 font-bold rounded-lg text-xs flex items-center gap-1.5"
              style={{
                background: showAnalytics
                  ? 'rgba(6,182,212,0.18)'
                  : 'linear-gradient(135deg,rgba(6,182,212,0.09),rgba(168,85,247,0.09))',
                border: showAnalytics ? '1px solid rgba(6,182,212,0.5)' : '1px solid rgba(6,182,212,0.22)',
                color: showAnalytics ? '#22d3ee' : '#67e8f9',
              }}
              whileHover={{ scale: 1.05, boxShadow: '0 0 14px rgba(6,182,212,0.25)' }}
              whileTap={{ scale: 0.95 }}
            >
              <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>⬡</span>
              <span className="hidden sm:inline">Intel</span>
              {intelligenceEvents.length > 0 && (
                <span className="text-[9px] px-1 rounded-full font-bold"
                  style={{ background: 'rgba(6,182,212,0.2)', color: '#22d3ee' }}>
                  {intelligenceEvents.length}
                </span>
              )}
            </motion.button>
          </div>
        </header>

        {/* ── Leaderboard slide-in (glass) ── */}
        <AnimatePresence>
          {showLeaderboard && (
            <motion.div
              initial={{ opacity: 0, x: 300 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 300 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="fixed right-0 top-0 h-full w-72 z-40 p-4 pt-20 overflow-y-auto"
              style={{ background: 'rgba(5,5,18,0.96)', backdropFilter: 'blur(32px)', borderLeft: '1px solid rgba(255,255,255,0.07)' }}
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-sm font-bold flex items-center gap-2 tracking-widest uppercase">
                  <span>🏆</span>
                  <span className="text-transparent bg-clip-text"
                    style={{ backgroundImage: 'linear-gradient(135deg,#fbbf24,#f97316)' }}>
                    Leaderboard
                  </span>
                </h3>
                <button
                  onClick={() => setShowLeaderboard(false)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-300 transition-colors"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                  aria-label="Close leaderboard"
                >
                  ✕
                </button>
              </div>
              {leaderboard.length === 0 ? (
                <p className="text-gray-700 text-sm">No players yet</p>
              ) : (
                <div className="space-y-2">
                  {leaderboard.slice(0, 5).map((entry, i) => (
                    <motion.div
                      key={entry.player}
                      initial={{ opacity: 0, x: 28 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.06, type: 'spring', stiffness: 300 }}
                      className="flex items-center justify-between p-3 rounded-xl"
                      style={{
                        background: entry.player === localName
                          ? 'rgba(6,182,212,0.08)'
                          : i === 0 ? 'rgba(251,191,36,0.07)' : 'rgba(255,255,255,0.025)',
                        border: entry.player === localName
                          ? '1px solid rgba(6,182,212,0.28)'
                          : i === 0 ? '1px solid rgba(251,191,36,0.22)' : '1px solid rgba(255,255,255,0.06)',
                      }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-base font-bold w-6 text-center flex-shrink-0"
                          style={{ color: i === 0 ? '#fbbf24' : i === 1 ? '#d1d5db' : i === 2 ? '#fb923c' : '#4b5563' }}>
                          {i === 0 ? '👑' : `#${i+1}`}
                        </span>
                        {(() => {
                          const agentCfg = getAgentByName(entry.player);
                          return agentCfg ? (
                            <span className="flex items-center gap-1 min-w-0">
                              <span className="text-sm flex-shrink-0" title={agentCfg.description}
                                style={{ filter: `drop-shadow(0 0 4px ${agentCfg.accentColor})` }}>
                                {agentCfg.icon}
                              </span>
                              <span className="text-sm font-bold truncate"
                                style={{ fontFamily: 'monospace', color: agentCfg.accentColor, textShadow: `0 0 8px ${agentCfg.accentColor}55` }}>
                                {entry.player}
                              </span>
                            </span>
                          ) : (
                            <span className="text-white text-sm font-medium truncate">{entry.player}</span>
                          );
                        })()}
                        {entry.streak >= 3 && <span className="text-orange-400 text-xs flex-shrink-0">🔥</span>}
                      </div>
                      <div className="text-right flex-shrink-0 ml-2">
                        <motion.span
                          key={entry.score}
                          className="text-yellow-400 font-bold text-sm"
                          initial={{ scale: 1.5 }}
                          animate={{ scale: 1 }}
                          transition={{ type: 'spring', stiffness: 450, damping: 15 }}
                        >{entry.score}</motion.span>
                        <span className="text-gray-700 text-xs ml-1">{t.points}</span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}

              {isHost && (
                <motion.button onClick={handleRestart}
                  className="mt-4 w-full py-2.5 font-bold rounded-xl text-sm flex items-center justify-center gap-2"
                  style={{ background: 'rgba(239,68,68,0.09)', border: '1px solid rgba(239,68,68,0.28)', color: '#f87171' }}
                  whileHover={{ scale: 1.02, background: 'rgba(239,68,68,0.16)' }}
                  whileTap={{ scale: 0.98 }}
                ><span>🔄</span> New Game</motion.button>
              )}

              <motion.button onClick={handleCopyInvite}
                className="mt-2 w-full py-2.5 font-bold rounded-xl text-sm flex items-center justify-center gap-2"
                style={{ background: 'rgba(16,185,129,0.09)', border: '1px solid rgba(16,185,129,0.28)', color: '#6ee7b7' }}
                whileHover={{ scale: 1.02, background: 'rgba(16,185,129,0.16)' }}
                whileTap={{ scale: 0.98 }}
              ><span>🔗</span>{inviteCopied ? 'Copied! 🚀' : 'Invite Friends'}</motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Analytics Terminal ── */}
        <AnalyticsTerminal
          isOpen={showAnalytics}
          onClose={() => setShowAnalytics(false)}
          events={intelligenceEvents}
          localName={localName}
          leaderboard={leaderboard}
          strategyProfiles={strategyProfiles}
        />

        {/* ── Live Agent Status — fixed sidebars (xl+ screens only) ── */}
        <div
          className="hidden xl:flex fixed left-0 top-[58px] bottom-0 w-60 z-20 overflow-hidden flex-col"
          style={{ background: 'rgba(5,5,16,0.75)', backdropFilter: 'blur(24px)', borderRight: '1px solid rgba(255,255,255,0.04)' }}
        >
          <AgentStatusCard
            agent={AGENT_REGISTRY[0]}
            events={intelligenceEvents}
            isTyping={botTypingNames.includes(AGENT_REGISTRY[0].name)}
            strategyProfile={strategyProfiles.find(p => p.agentName === AGENT_REGISTRY[0].name)}
            currentRoundId={roundId}
          />
        </div>
        <div
          className="hidden xl:flex fixed right-0 top-[58px] bottom-0 w-60 z-20 overflow-hidden flex-col"
          style={{ background: 'rgba(5,5,16,0.75)', backdropFilter: 'blur(24px)', borderLeft: '1px solid rgba(255,255,255,0.04)' }}
        >
          <AgentStatusCard
            agent={AGENT_REGISTRY[1]}
            events={intelligenceEvents}
            isTyping={botTypingNames.includes(AGENT_REGISTRY[1].name)}
            strategyProfile={strategyProfiles.find(p => p.agentName === AGENT_REGISTRY[1].name)}
            currentRoundId={roundId}
          />
        </div>

        {/* ── Main arena content ── */}
        <div className="flex-1 flex flex-col items-center justify-start p-3 sm:p-5 overflow-auto">

          {/* R_i reward countdown — high-contrast focal point during active rounds */}
          {phase === 'playing' && !countdownActive && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mt-2 mb-4"
            >
              <RewardCountdown points={currentPotentialPoints} />
            </motion.div>
          )}

          <div className="w-full max-w-xl px-2 sm:px-0">

            {/* Hearts */}
            <motion.div className="flex justify-center gap-2 mb-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {[...Array(3)].map((_, i) => (
                <motion.span
                  key={i}
                  className="text-xl select-none"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: i * 0.08, type: 'spring', stiffness: 450 }}
                  style={{
                    color: i < strikes ? '#ef4444' : '#1f2937',
                    filter: i < strikes ? 'drop-shadow(0 0 6px rgba(239,68,68,0.55))' : 'none',
                  }}
                >♥</motion.span>
              ))}
            </motion.div>

            {/* ── Lobby panel ── */}
            {lobbyActive && phase === 'idle' && (
              <motion.div
                initial={{ opacity: 0, scale: 0.93 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mb-5 p-5 rounded-2xl text-center"
                style={{ background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 0 50px rgba(168,85,247,0.08)' }}
              >
                <div className="flex items-center justify-center gap-2 mb-3">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" style={{ boxShadow: '0 0 8px #10b981' }} />
                  <span className="text-emerald-400 font-bold text-sm">🌍 {globalPlayersOnline}+ Online</span>
                </div>
                <motion.div className="text-4xl mb-2"
                  animate={{ rotate: [0,-5,5,0] }} transition={{ repeat: Infinity, duration: 3 }}>🎮</motion.div>
                <h3 className="text-xl font-bold text-white mb-1 tracking-tight">Live Arena</h3>
                <p className="text-gray-500 text-xs mb-4 tracking-wide">NEXT MATCH STARTS IN</p>
                <div className="text-5xl font-bold mb-4" style={{ color: '#fbbf24', textShadow: '0 0 20px rgba(251,191,36,0.45)' }}>
                  {lobbyCountdown > 0 ? lobbyCountdown : (
                    <div className="flex flex-col items-center">
                      <div className="w-10 h-10 rounded-full border-2 border-t-cyan-400 border-white/15 animate-spin mb-2" />
                      <span className="text-sm font-normal text-cyan-400 tracking-widest">GENERATING...</span>
                    </div>
                  )}
                </div>
                <div className="mb-4">
                  <p className="text-gray-600 text-xs mb-2 tracking-widest uppercase">Players in Room</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <motion.div
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold"
                      style={{ background: 'rgba(6,182,212,0.09)', border: '1px solid rgba(6,182,212,0.28)', color: '#67e8f9' }}
                      animate={{ boxShadow: ['0 0 8px rgba(6,182,212,0.15)','0 0 20px rgba(6,182,212,0.45)','0 0 8px rgba(6,182,212,0.15)'] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    >
                      <span>👤</span><span>{localName}</span>
                    </motion.div>
                    {bots.map((bot, i) => {
                      const agentCfg = getAgentByName(bot.name);
                      const accentColor = agentCfg?.accentColor ?? '#10b981';
                      const icon = agentCfg?.icon ?? '🤖';
                      return (
                        <motion.div key={bot.name}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold"
                          style={{
                            background: bot.ready ? `${accentColor}14` : 'rgba(239,68,68,0.09)',
                            border: bot.ready ? `1px solid ${accentColor}44` : '1px solid rgba(239,68,68,0.3)',
                            color: bot.ready ? accentColor : '#f87171',
                            fontFamily: 'monospace',
                          }}
                          initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: i * 0.2, type: 'spring' }}
                        >
                          <span style={{ filter: bot.ready ? `drop-shadow(0 0 4px ${accentColor})` : 'none' }}>{icon}</span>
                          <span>{bot.name}</span>
                          {bot.ready && <span className="text-[10px] opacity-70">✓</span>}
                          {!bot.ready && <span className="text-[10px] opacity-50">connecting...</span>}
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
                <p className="text-xs text-gray-700">Category: Hebrew Idioms 🇮🇱</p>
                <p className="text-xs text-gray-800 mt-1">Host: {isHostRef.current ? '👑 You' : '👥 Other player'}</p>
                {forceStartVisible && (
                  <motion.button
                    onClick={() => {
                      isHostRef.current = true;
                      setIsHost(true);
                      triggerServerRoundRef.current();
                    }}
                    className="mt-3 px-4 py-2 text-xs font-bold rounded-lg"
                    style={{ background: 'rgba(127,29,29,0.55)', border: '1px solid rgba(239,68,68,0.38)', color: '#f87171' }}
                    whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  >🔧 DEV: Force Start Round</motion.button>
                )}
              </motion.div>
            )}

            {/* Hint banner */}
            {lastHint && !showWinner && (
              <motion.div
                initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                className="mb-4 p-3 rounded-xl text-center text-sm font-medium"
                style={{
                  background: lastHint.includes('🔥') ? 'rgba(249,115,22,0.1)' : 'rgba(251,191,36,0.07)',
                  border: lastHint.includes('🔥') ? '1px solid rgba(249,115,22,0.32)' : '1px solid rgba(251,191,36,0.22)',
                  color: lastHint.includes('🔥') ? '#fb923c' : '#fde68a',
                }}
              >{lastHint}</motion.div>
            )}

            {/* ── Image / Loading area ──────────────────────────────────────────
                 Priority: imageUrl always renders. loading spinner = no URL yet.
                 AnimatePresence mode="wait" — spinner exits before image enters. */}
            <AnimatePresence mode="wait">
              {imageUrl ? (
                <motion.div
                  key={imageUrl}
                  initial={{ opacity: 0, scale: 0.9, y: 12 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.18, type: 'spring', stiffness: 380, damping: 28 }}
                  className="mb-5 rounded-xl overflow-hidden relative glow-pulse-cyan"
                  style={{ border: '1px solid rgba(6,182,212,0.3)', background: 'rgba(6,182,212,0.015)' }}
                >
                  <img
                    key={roundId || imageUrl || 'img'}
                    src={imageUrl}
                    alt="AI Generated"
                    className="max-h-64 sm:max-h-80 xl:max-h-[30rem] w-auto h-auto max-w-full mx-auto block object-contain cursor-pointer"
                    onError={(e) => {
                      console.warn('[IMG] Failed to load:', imageUrl?.slice(0, 80));
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                    onClick={() => {
                      const now = Date.now();
                      const isRapid = now - lastClickTime < 600;
                      const nextCount = isRapid ? imageClickCount + 1 : 1;
                      setImageClickCount(nextCount);
                      setLastClickTime(now);
                      if (nextCount >= 3) {
                        setImageClickCount(0);
                        if (process.env.NODE_ENV === 'development') {
                          console.log('dev-cheat:', secretPrompt);
                          setShowSecretCheat(true);
                          setTimeout(() => setShowSecretCheat(false), 5000);
                        }
                      }
                    }}
                  />
                </motion.div>
              ) : loading ? (
                /* ── AI Thinking state ── */
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="mb-5 flex flex-col items-center"
                >
                  <div className="relative w-64 h-64 rounded-xl overflow-hidden"
                    style={{ border: '1px solid rgba(6,182,212,0.22)', background: 'rgba(6,182,212,0.025)' }}>
                    {/* Pulsing radial glow */}
                    <motion.div className="absolute inset-0"
                      style={{ background: 'radial-gradient(ellipse at 50% 50%, rgba(6,182,212,0.12) 0%, rgba(168,85,247,0.08) 50%, transparent 70%)' }}
                      animate={{ scale: [1, 1.18, 1], opacity: [0.5, 1, 0.5] }}
                      transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
                    />
                    {/* Scan line */}
                    <div className="scan-line" />
                    {/* Dual counter-rotating rings */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="relative w-14 h-14">
                        <motion.div className="absolute inset-0 rounded-full"
                          style={{ border: '2px solid rgba(6,182,212,0.25)', borderTopColor: '#06b6d4' }}
                          animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                        />
                        <motion.div className="absolute inset-2 rounded-full"
                          style={{ border: '2px solid rgba(168,85,247,0.22)', borderTopColor: '#a855f7' }}
                          animate={{ rotate: -360 }} transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
                        />
                      </div>
                    </div>
                  </div>
                  {/* AI Thinking pill */}
                  <div className="mt-3 flex items-center gap-2 px-3 py-1.5 rounded-full"
                    style={{ background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.2)' }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" style={{ boxShadow: '0 0 6px #06b6d4' }} />
                    <span className="text-cyan-400 text-xs font-bold tracking-widest">AI THINKING</span>
                    <span className="flex gap-0.5 items-center">
                      {[0,1,2].map(j => <span key={j} className="typing-dot w-1 h-1 rounded-full bg-cyan-400/70 inline-block" />)}
                    </span>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            {/* Debug cheat overlay */}
            {showSecretCheat && secretPrompt && (
              <div className="mb-4 p-3 rounded-xl font-mono text-xs"
                style={{ background: 'rgba(127,29,29,0.5)', border: '1px solid rgba(239,68,68,0.38)' }}>
                <p className="text-red-300 text-center font-bold mb-2">🔐 DEBUG MODE</p>
                <p className="text-yellow-300">Secret: {secretPrompt}</p>
                <p className="text-blue-300">Explanation: {currentExplanation}</p>
                <p className="text-green-300">Category: {category}</p>
                <p className="text-purple-300">Points: {score} | Streak: {streak}</p>
              </div>
            )}

            {/* Revealed hint card */}
            {revealedHint && !showWinner && (
              <motion.div
                initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                className="mb-4 p-3 rounded-xl text-center text-sm"
                style={{ background: 'rgba(168,85,247,0.07)', border: '1px solid rgba(168,85,247,0.22)', color: '#c4b5fd' }}
              >💡 {revealedHint}</motion.div>
            )}

            {/* ── Guess input + controls ── */}
            {!showWinner && (
              <div className="flex gap-2">
                <form onSubmit={handleSubmitGuess} className="flex-1 flex gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    value={guessText}
                    onChange={(e) => setGuessText(e.target.value)}
                    className="flex-1 px-4 py-3 rounded-xl text-white placeholder-gray-600 outline-none transition-all"
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: guessText.length > 0 ? '1px solid rgba(6,182,212,0.45)' : '1px solid rgba(255,255,255,0.09)',
                      boxShadow: guessText.length > 0 ? '0 0 14px rgba(6,182,212,0.12)' : 'none',
                    }}
                    placeholder={t.guess}
                    disabled={strikes <= 0 || !imageUrl}
                    dir={isRTL ? 'rtl' : 'ltr'}
                  />
                  <motion.button
                    type="submit"
                    disabled={!guessText.trim() || strikes <= 0 || !imageUrl}
                    className="px-5 py-3 font-bold rounded-xl text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed text-sm sm:text-base min-w-[72px]"
                    style={{ background: 'linear-gradient(135deg,#059669,#10b981)', boxShadow: '0 4px 15px rgba(16,185,129,0.28)' }}
                    whileHover={{ scale: 1.04, boxShadow: '0 4px 24px rgba(16,185,129,0.48)' }}
                    whileTap={{ scale: 0.95 }}
                  >{t.submitGuess}</motion.button>
                </form>
                <motion.button
                  onClick={handleGetHint}
                  disabled={hintUsed || !secretPrompt || showWinner || !imageUrl}
                  className="px-3 py-3 font-bold rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.26)', color: '#c4b5fd' }}
                  whileHover={{ scale: 1.05, background: 'rgba(168,85,247,0.2)' }}
                  whileTap={{ scale: 0.95 }}
                >💡</motion.button>
              </div>
            )}

            {/* Bot typing indicators — mobile only (agent cards handle desktop) */}
            {botTypingNames.length > 0 && (
              <div className="flex items-center gap-2 mt-2 flex-wrap xl:hidden">
                {botTypingNames.map(agentName => {
                  const cfg = getAgentByName(agentName);
                  const color = cfg?.accentColor ?? '#D946EF';
                  const icon = cfg?.icon ?? '🤖';
                  return (
                    <div key={agentName} className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px]"
                      style={{
                        background: `${color}12`,
                        border: `1px solid ${color}38`,
                        color,
                        fontFamily: 'monospace',
                      }}>
                      <span className="flex gap-0.5 items-center">
                        {[0,1,2].map(j => <span key={j} className="typing-dot w-1 h-1 rounded-full inline-block" style={{ background: color }} />)}
                      </span>
                      {icon} {agentName}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Next round button visible during winner state */}
            {showWinner && (
              <motion.button
                onClick={handleRestart}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="w-full mt-4 px-6 py-3 font-bold rounded-xl text-sm sm:text-base"
                style={{ background: 'rgba(249,115,22,0.1)', border: '1px solid rgba(249,115,22,0.35)', color: '#fb923c' }}
                whileHover={{ scale: 1.02, background: 'rgba(249,115,22,0.18)' }}
                whileTap={{ scale: 0.98 }}
              >{t.nextRound}</motion.button>
            )}

            {/* ── Guess history ── */}
            <motion.div className="mt-5" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
              <h3 className="text-gray-600 text-[10px] mb-2 text-center tracking-widest uppercase">{t.guessHistory}</h3>
              <div className="rounded-xl p-3 max-h-32 overflow-y-auto"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.055)' }}>
                {guessHistory.length === 0 ? (
                  <p className="text-gray-700 text-xs text-center">{t.noGuesses}</p>
                ) : (
                  guessHistory.slice(-10).reverse().map((entry, i) => (
                    <motion.div
                      key={`${entry.timestamp}-${i}`}
                      className="flex items-center justify-between py-1.5 border-b last:border-0"
                      style={{ borderColor: 'rgba(255,255,255,0.05)' }}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.03 }}
                    >
                      <span className="text-xs truncate max-w-[58%]">
                        <span className="text-cyan-500 font-semibold">{entry.player}:</span>{' '}
                        <span className="text-gray-300">{entry.text}</span>
                      </span>
                      <span className="text-xs font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                        style={{
                          background: entry.isCorrect === true ? 'rgba(16,185,129,0.12)' : entry.isCorrect === false ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.04)',
                          border: entry.isCorrect === true ? '1px solid rgba(16,185,129,0.28)' : entry.isCorrect === false ? '1px solid rgba(239,68,68,0.28)' : '1px solid rgba(255,255,255,0.06)',
                          color: entry.isCorrect === true ? '#6ee7b7' : entry.isCorrect === false ? '#f87171' : '#6b7280',
                        }}
                      >
                        {entry.isCorrect === true ? '✓' : entry.isCorrect === false ? '✗' : '…'}
                      </span>
                    </motion.div>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        </div>
      </div>

      {/* DEV: persistent debug buttons */}
      {process.env.NODE_ENV === 'development' && (
        <div className="fixed bottom-16 left-4 z-50 flex flex-col gap-2">
          <button
            onClick={() => {
              console.log('🚀 [DEV] START GAME NOW clicked');
              triggerServerRoundRef.current();
            }}
            className="px-3 py-2 text-xs font-bold rounded-lg shadow-lg"
            style={{ background: 'rgba(127,29,29,0.85)', border: '1px solid rgba(239,68,68,0.45)', color: '#fca5a5' }}
          >
            🚀 START GAME NOW
          </button>
          <button
            onClick={() => {
              console.log('🔄 [DEV] FORCE SYNC clicked');
              fetch(`/api/game/state?roomId=${roomId}`)
                .then(r => r.json())
                .then(state => {
                  console.log('🔄 [DEV] Server state:', state);
                  if (state.imageUrl && state.phase && state.phase !== 'idle') {
                    setImageUrl(state.imageUrl);
                    setSecretPrompt(state.secretPrompt);
                    setCurrentExplanation(state.explanation || '');
                    setCategory(state.category || 'idiom');
                    setPhase('playing');
                    setLoading(false);
                    setLobbyActive(false);
                    setShowWinner(false);
                    setCountdownActive(false);
                    setLastHint(null);
                    setGuessHistory([]);
                    setStrikes(3);
                    isGeneratingRef.current = false;
                    setRoundStartTime(state.roundStartTime || Date.now());
                    console.log('🔄 [DEV] Force sync applied');
                  } else {
                    console.log('🔄 [DEV] No active round on server');
                  }
                })
                .catch(e => console.error('🔄 [DEV] Sync failed:', e));
            }}
            className="px-3 py-2 text-xs font-bold rounded-lg shadow-lg"
            style={{ background: 'rgba(30,58,138,0.85)', border: '1px solid rgba(59,130,246,0.45)', color: '#93c5fd' }}
          >
            🔄 FORCE SYNC
          </button>
        </div>
      )}

      {/* Reaction buttons (glass) */}
      <div className="fixed bottom-4 right-4 flex gap-2 z-30">
        {['😂', '🔥', '😮', '🤡'].map((emoji) => (
          <motion.button
            key={emoji}
            onClick={() => sendReaction(emoji)}
            className="w-10 h-10 rounded-full text-xl flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.1)' }}
            whileHover={{ scale: 1.22, background: 'rgba(255,255,255,0.12)' }}
            whileTap={{ scale: 0.8 }}
          >
            {emoji}
          </motion.button>
        ))}
      </div>

      <div className="fixed inset-0 pointer-events-none z-20 overflow-hidden">
        <AnimatePresence>
          {reactions.map((reaction) => (
            <motion.div
              key={reaction.id}
              initial={{ opacity: 1, y: 0, scale: 0.5 }}
              animate={{ opacity: 0, y: -150, scale: 1.5 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 2.5, ease: 'easeOut' }}
              className="absolute text-4xl"
              style={{ left: `${reaction.x}%`, top: `${reaction.y}%` }}
            >
              {reaction.emoji}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
    </div>
  );
}
