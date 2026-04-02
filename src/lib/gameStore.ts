import { GamePhase } from '@/context/GameContext';

interface StoredGuess {
  id: string;
  playerName: string;
  text: string;
  timestamp: number;
}

export interface PlayerScore {
  score: number;
  streak: number;
}

interface RoomState {
  phase: GamePhase;
  imageUrl: string | null;
  secretPrompt: string | null;
  explanation: string | null;
  category: string;
  guesses: StoredGuess[];
  lastUpdate: number;
  countdownActive: boolean;
  countdownSeconds: number;
  winner: string | null;
  roundStartTime: number | null;
  roundNumber: number;
  scoreboard: Record<string, PlayerScore>;
  /** Shuffled deck of idiom indices. Shift one per round; refill when empty. */
  idiomDeck: number[];
  /** Unique opaque ID for the current round — clients use it to bust image cache. */
  roundId: string;
}

interface GameStore {
  [roomId: string]: RoomState;
}

// ── Turbopack-safe singleton ──────────────────────────────────────────────────
// Next.js 16+ with Turbopack re-evaluates route-handler modules per request in
// development mode, resetting module-level constants to their initialiser values.
// Anchoring to globalThis survives re-evaluations within the same Node.js process.
declare global { var __gameStore: GameStore | undefined; }
if (!globalThis.__gameStore) globalThis.__gameStore = {};
const gameStore: GameStore = globalThis.__gameStore;

function defaultRoom(): RoomState {
  return {
    phase: 'idle',
    imageUrl: null,
    secretPrompt: null,
    explanation: null,
    category: 'idiom',
    guesses: [],
    lastUpdate: Date.now(),
    countdownActive: false,
    countdownSeconds: 5,
    winner: null,
    roundStartTime: null,
    roundNumber: 0,
    scoreboard: {},
    idiomDeck: [],
    roundId: '',
  };
}

// ── Shuffle Queue helpers ────────────────────────────────────────────────────

/** Fisher-Yates shuffle — returns a new array. */
function fisherYates(arr: number[]): number[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Returns the next idiom index for `roomId` from its per-room shuffle deck.
 *
 * Guarantees NO repeat until every idiom in the pool has appeared exactly once.
 * When the deck is exhausted it is rebuilt and re-shuffled, ensuring the first
 * item of the new deck is never the same as the last item of the old one
 * (prevents the one edge-case repeat at cycle boundaries).
 *
 * @param roomId     - the room whose deck to advance
 * @param totalIdioms - total size of the idiom pool (IDIOMS.length)
 */
export function pickNextIdiomIndex(roomId: string, totalIdioms: number): number {
  if (!gameStore[roomId]) gameStore[roomId] = defaultRoom();
  const room = gameStore[roomId];

  if (room.idiomDeck.length === 0) {
    const indices = Array.from({ length: totalIdioms }, (_, i) => i);
    let newDeck = fisherYates(indices);

    // Prevent the very first card of the new cycle from matching the last card
    // that was just played (stored as the first element we already shifted out).
    // We track "lastPlayed" via roundNumber heuristic: the last index is simply
    // whatever was just used.  Re-roll once if there's a collision.
    const lastPlayedKey = `__lastIdx_${roomId}`;
    const lastIdx = (gameStore as any)[lastPlayedKey] as number | undefined;
    if (lastIdx !== undefined && newDeck[0] === lastIdx) {
      // Swap position 0 with a random other position to break the repeat
      const swapPos = 1 + Math.floor(Math.random() * (newDeck.length - 1));
      [newDeck[0], newDeck[swapPos]] = [newDeck[swapPos], newDeck[0]];
    }

    room.idiomDeck = newDeck;
    console.log(`[STORE] 🃏 New shuffled deck for room "${roomId}": ${totalIdioms} idioms queued`);
  }

  const index = room.idiomDeck.shift()!;
  // Record the last-played index so we can avoid it at cycle boundary
  (gameStore as any)[`__lastIdx_${roomId}`] = index;
  return index;
}

// ── Phase transition rules (one-way gate) ───────────────────────────────────
// idle  → drawing  (start-round acquires lock)
// drawing → winner (validate broadcasts round-solved)
// winner  → drawing (start-round next cycle)
// Any explicit reset to 'idle' is allowed (admin/clearRoom paths only).
//
// Critically: 'winner' CANNOT transition to anything except 'drawing'.
// This blocks stale client messages from rolling the phase backwards.
export function updateGameState(roomId: string, updates: Partial<RoomState>) {
  if (!gameStore[roomId]) gameStore[roomId] = defaultRoom();

  let safeUpdates = { ...updates };

  const currentPhase = gameStore[roomId].phase;
  if (
    updates.phase !== undefined &&
    currentPhase === 'winner' &&
    updates.phase !== 'drawing' &&
    updates.phase !== 'idle'
  ) {
    console.warn(`[STORE] 🚫 Blocked phase regression: ${currentPhase} → ${updates.phase}`);
    delete safeUpdates.phase;
  }

  gameStore[roomId] = { ...gameStore[roomId], ...safeUpdates, lastUpdate: Date.now() };
}

export function getGameState(roomId: string): RoomState | null {
  return gameStore[roomId] || null;
}

export function getFullGameState(roomId: string): RoomState {
  return gameStore[roomId] || defaultRoom();
}

/**
 * Add points to a player's server-side score for this room.
 * Returns the updated full scoreboard so it can be embedded in Pusher payloads.
 */
export function updateScore(
  roomId: string,
  player: string,
  scoreDelta: number,
  newStreak: number,
): Record<string, PlayerScore> {
  if (!gameStore[roomId]) gameStore[roomId] = defaultRoom();
  const prev = gameStore[roomId].scoreboard[player] ?? { score: 0, streak: 0 };
  gameStore[roomId].scoreboard[player] = {
    score: prev.score + scoreDelta,
    streak: newStreak,
  };
  gameStore[roomId].lastUpdate = Date.now();
  return { ...gameStore[roomId].scoreboard };
}

export function getScoreboard(roomId: string): Record<string, PlayerScore> {
  return gameStore[roomId]?.scoreboard ?? {};
}

export function addGuess(roomId: string, guess: StoredGuess) {
  if (!gameStore[roomId]) updateGameState(roomId, {});
  gameStore[roomId].guesses.unshift(guess);
}

export function clearRoom(roomId: string) {
  delete gameStore[roomId];
}
