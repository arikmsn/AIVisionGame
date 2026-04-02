'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Guess } from '@/context/GameContext';

interface GuessSidebarProps {
  guesses: Guess[];
}

export default function GuessSidebar({ guesses }: GuessSidebarProps) {
  return (
    <div className="w-80 bg-gray-900 border-l border-gray-700 p-4 overflow-hidden flex flex-col h-full">
      <h2 className="text-xl font-bold text-white mb-4">Guesses</h2>
      <div className="flex-1 overflow-y-auto space-y-3">
        <AnimatePresence initial={false}>
          {guesses.length === 0 ? (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              className="text-gray-400 text-center py-8"
            >
              No guesses yet
            </motion.p>
          ) : (
            guesses.map((guess) => (
              <motion.div
                key={guess.id}
                initial={{ x: 100, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -100, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                className="bg-gray-800 rounded-lg p-3 shadow-lg"
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="font-semibold text-blue-400 text-sm">
                    {guess.playerName}
                  </span>
                  <span className="text-xs text-gray-500">
                    {new Date(guess.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <p className="text-white">{guess.text}</p>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
