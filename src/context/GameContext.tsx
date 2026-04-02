'use client';

import React, { createContext, useContext, useReducer, useState, useCallback } from 'react';

export type GamePhase = 'idle' | 'drawing' | 'solved' | 'winner';

export interface Guess {
  id: string;
  playerName: string;
  text: string;
  timestamp: number;
  isCorrect?: boolean;
  hint?: string;
}

export interface GameState {
  roomId: string | null;
  phase: GamePhase;
  currentImageUrl: string | null;
  guesses: Guess[];
  isConnected: boolean;
  isLoading: boolean;
  secretPrompt: string | null;
  error: string | null;
}

type GameAction =
  | { type: 'SET_ROOM'; roomId: string }
  | { type: 'SET_CONNECTED'; isConnected: boolean }
  | { type: 'ON_GUESS'; guess: Guess }
  | { type: 'ON_IMAGE_UPDATE'; imageUrl: string }
  | { type: 'ON_PHASE_CHANGE'; phase: GamePhase }
  | { type: 'CLEAR_GUESSES' }
  | { type: 'SET_LOADING'; isLoading: boolean }
  | { type: 'SET_SECRET_PROMPT'; prompt: string }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'RESET_GAME' };

const initialState: GameState = {
  roomId: null,
  phase: 'idle',
  currentImageUrl: null,
  guesses: [],
  isConnected: false,
  isLoading: false,
  secretPrompt: null,
  error: null,
};

function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'SET_ROOM':
      return { ...state, roomId: action.roomId };
    case 'SET_CONNECTED':
      return { ...state, isConnected: action.isConnected };
    case 'ON_GUESS':
      return { ...state, guesses: [action.guess, ...state.guesses] };
    case 'ON_IMAGE_UPDATE':
      return { ...state, currentImageUrl: action.imageUrl };
    case 'ON_PHASE_CHANGE':
      return { ...state, phase: action.phase };
    case 'CLEAR_GUESSES':
      return { ...state, guesses: [] };
    case 'SET_LOADING':
      return { ...state, isLoading: action.isLoading };
    case 'SET_SECRET_PROMPT':
      return { ...state, secretPrompt: action.prompt };
    case 'SET_ERROR':
      return { ...state, error: action.error };
    case 'RESET_GAME':
      return { ...initialState };
    default:
      return state;
  }
}

interface GameContextType {
  state: GameState;
  joinRoom: (roomId: string) => void;
  leaveRoom: () => void;
  submitGuess: (playerName: string, text: string) => Promise<{ isCorrect: boolean; hint?: string }>;
  startGame: () => Promise<void>;
  forceRestart: () => void;
}

const GameContext = createContext<GameContextType | undefined>(undefined);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(gameReducer, initialState);
  const [gameStarted, setGameStarted] = useState(false);

  const joinRoom = useCallback((roomId: string) => {
    dispatch({ type: 'SET_ROOM', roomId });
    dispatch({ type: 'SET_CONNECTED', isConnected: true });
  }, []);

  const leaveRoom = useCallback(() => {
    dispatch({ type: 'RESET_GAME' });
    setGameStarted(false);
  }, []);

  const startGame = useCallback(async () => {
    if (gameStarted) return;

    setGameStarted(true);
    dispatch({ type: 'SET_LOADING', isLoading: true });
    dispatch({ type: 'SET_ERROR', error: null });

    try {
      const promptRes = await fetch('/api/game/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get-prompt' }),
      });

      const promptData = await promptRes.json();

      if (promptData.error) {
        throw new Error(promptData.message || promptData.error);
      }

      const secretPrompt = promptData.prompt;
      dispatch({ type: 'SET_SECRET_PROMPT', prompt: secretPrompt });
      dispatch({ type: 'ON_PHASE_CHANGE', phase: 'drawing' });

      const imageRes = await fetch('/api/game/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: secretPrompt, roomId: state.roomId }),
      });

      const imageData = await imageRes.json();

      if (imageData.error) {
        throw new Error(imageData.message || imageData.error);
      }

      dispatch({ type: 'ON_IMAGE_UPDATE', imageUrl: imageData.imageUrl });
      dispatch({ type: 'SET_LOADING', isLoading: false });

    } catch (error: any) {
      console.error('[CONTEXT] Game start error:', error);
      dispatch({ type: 'SET_ERROR', error: error.message });
      dispatch({ type: 'SET_LOADING', isLoading: false });
      setGameStarted(false);
    }
  }, [state.roomId, gameStarted]);

  const submitGuess = useCallback(async (playerName: string, text: string): Promise<{ isCorrect: boolean; hint?: string }> => {
    const guess: Guess = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      playerName,
      text,
      timestamp: Date.now(),
    };

    dispatch({ type: 'ON_GUESS', guess });

    if (!state.secretPrompt) {
      return { isCorrect: false };
    }

    try {
      const response = await fetch('/api/game/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guess: text,
          secretPrompt: state.secretPrompt,
        }),
      });
      const result = await response.json();
      
      if (result.isCorrect) {
        dispatch({ type: 'ON_PHASE_CHANGE', phase: 'solved' });
      }
      
      return { isCorrect: result.isCorrect || false, hint: result.hint };
    } catch {
      return { isCorrect: false };
    }
  }, [state.roomId, state.secretPrompt]);

  const forceRestart = useCallback(() => {
    dispatch({ type: 'RESET_GAME' });
    setGameStarted(false);
  }, []);

  return (
    <GameContext.Provider value={{ state, joinRoom, leaveRoom, submitGuess, startGame, forceRestart }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGame must be used within a GameProvider');
  }
  return context;
}
