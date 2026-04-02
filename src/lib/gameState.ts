// In-memory game state store (for Vercel serverless, use Redis in production)
interface GameState {
  roomId: string;
  imageUrl: string | null;
  secret: string;
  explanation: string;
  category: string;
  phase: 'idle' | 'playing' | 'solved';
  roundStartTime: number | null;
  countdownActive: boolean;
  countdownSeconds: number;
  winner: string | null;
  lastUpdated: number;
}

const gameStates = new Map<string, GameState>();

export function getGameState(roomId: string): GameState | null {
  return gameStates.get(roomId) || null;
}

export function setGameState(roomId: string, state: Partial<GameState>): GameState {
  const existing = gameStates.get(roomId) || {
    roomId,
    imageUrl: null,
    secret: '',
    explanation: '',
    category: 'idiom',
    phase: 'idle',
    roundStartTime: null,
    countdownActive: false,
    countdownSeconds: 5,
    winner: null,
    lastUpdated: Date.now(),
  };
  
  const updated = { ...existing, ...state, lastUpdated: Date.now() };
  gameStates.set(roomId, updated);
  return updated;
}

export function clearGameState(roomId: string): void {
  gameStates.delete(roomId);
}

export function getAllRooms(): string[] {
  return Array.from(gameStates.keys());
}
