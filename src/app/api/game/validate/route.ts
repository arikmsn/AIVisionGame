import { NextRequest, NextResponse } from 'next/server';
import { Groq } from 'groq-sdk';
import Pusher from 'pusher';
import { updateGameState, updateScore, addGuess, getGameState } from '@/lib/gameStore';
import { IDIOMS, findIdiomByHe } from '@/lib/idioms-data';
import { extractBearerToken, resolveAgentKey } from '@/lib/agents/api-keys';
import { upsertActiveRound } from '@/lib/db/rounds';

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

const pusherServer = new Pusher({
  appId: process.env.PUSHER_APP_ID || '',
  key: process.env.PUSHER_KEY || '',
  secret: process.env.PUSHER_SECRET || '',
  cluster: process.env.PUSHER_CLUSTER || 'eu',
  useTLS: true,
});

type GameCategory = 'flag' | 'person' | 'animal' | 'object' | 'idiom';

// ── Text normalisation ────────────────────────────────────────────────────────
// Strips Hebrew niqqud / cantillation, English punctuation, and folds case.
// Applied to both the guess AND both language variants of the secret before
// any comparison so typos, apostrophes, and diacritics never block a win.
function normalizeText(text: string): string {
  return text
    .replace(/[\u0591-\u05C7]/g, '')               // Hebrew diacritics (niqqud + cantillation)
    .replace(/[\u05F3\u05F4]/g, '')                // Hebrew punctuation (geresh / gershayim)
    .replace(/['''""".,!?;:()\-–—\/\\[\]{}@#$%^&*+=<>]/g, '') // English/general punctuation
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

// ── Dual-language idiom matching ──────────────────────────────────────────────
// Checks the guess against BOTH the Hebrew (he) and English (en) versions.
// Priority order:
//   1. Exact normalised match against he OR en  → CORRECT
//   2. All content words of he match             → CORRECT
//   3. All content words of en match             → CORRECT
//   4. ≥ half of he words match                  → CLOSE
//   5. Guess is a long substring of he           → CLOSE
//   6. Otherwise                                 → WRONG
function strictIdiomMatch(
  guess: string,
  secretHe: string,
  secretEn: string | null,
): { isCorrect: boolean; hint: string; close: boolean } {
  const guessNorm  = normalizeText(guess);
  const heNorm     = normalizeText(secretHe);
  const enNorm     = secretEn ? normalizeText(secretEn) : null;
  const isHebrew   = /[\u0590-\u05FF]/.test(guess);

  // 1. Exact match — Hebrew OR English
  if (guessNorm === heNorm || (enNorm && guessNorm === enNorm)) {
    return { isCorrect: true, hint: 'נכון!', close: false };
  }

  const guessWords = guessNorm.split(/\s+/).filter(w => w.length > 1);

  // 2. Full word-overlap match — Hebrew
  const heWords   = heNorm.split(/\s+/).filter(w => w.length > 1);
  const heMatches = heWords.filter(hw => guessWords.some(gw => gw === hw || hw.includes(gw) || gw.includes(hw)));
  if (heMatches.length === heWords.length && heWords.length > 0) {
    return { isCorrect: true, hint: 'נכון!', close: false };
  }

  // 3. Full word-overlap match — English
  if (enNorm) {
    const enWords   = enNorm.split(/\s+/).filter(w => w.length > 1);
    const enMatches = enWords.filter(ew => guessWords.some(gw => gw === ew || ew.includes(gw) || gw.includes(ew)));
    if (enMatches.length === enWords.length && enWords.length > 0) {
      return { isCorrect: true, hint: 'נכון!', close: false };
    }
  }

  // 4. "Close" — more than half the Hebrew content words matched
  if (heMatches.length >= Math.ceil(heWords.length / 2) && heWords.length > 1) {
    const hint = isHebrew ? 'קרוב, אבל מה הביטוי המלא?' : 'Close — but what\'s the full expression?';
    return { isCorrect: false, hint, close: true };
  }

  // 5. "Close" — guess is a substantial substring of the Hebrew
  if (heNorm.includes(guessNorm) && guessNorm.length > heNorm.length * 0.5) {
    const hint = isHebrew ? 'קרוב, אבל מה הביטוי המלא?' : 'Close — try the full phrase';
    return { isCorrect: false, hint, close: true };
  }

  const hint = isHebrew ? 'נסה שוב!' : 'Try again!';
  return { isCorrect: false, hint, close: false };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    let { guess, action, secretPrompt, roomId, playerName, language, hintUsed, isFast } = body;

    // External agents authenticate with a Bearer token.
    // When present: resolve identity and fill in secretPrompt from current round state.
    const token = extractBearerToken(request.headers.get('Authorization'));
    if (token) {
      const identity = resolveAgentKey(token);
      if (!identity) {
        return NextResponse.json({ error: 'INVALID_API_KEY', message: 'Unrecognised API key' }, { status: 401 });
      }
      playerName   = identity.agentName;
      // Agent doesn't send secretPrompt — resolve it from current round state
      if (!secretPrompt && roomId) {
        secretPrompt = getGameState(roomId)?.secretPrompt ?? undefined;
      }
    }

    const isHebrew = language === 'he';

    if (action === 'get-prompt') {
      if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === 'your_groq_api_key_here') {
        return NextResponse.json({ error: 'GROQ_KEY_MISSING', message: 'Groq API key not configured' }, { status: 503 });
      }

      const entry = IDIOMS[Math.floor(Math.random() * IDIOMS.length)];
      return NextResponse.json({ success: true, prompt: entry.visualPrompt, secret: entry.he, category: 'idiom' });
    }

    if (action === 'get-hint') {
      if (!secretPrompt) {
        return NextResponse.json({ error: 'NO_SECRET', message: 'No secret prompt' }, { status: 400 });
      }

      let hint = '';
      
      if (groq) {
        try {
          const langInstruction = isHebrew 
            ? 'Respond in Hebrew. Keep it short (max 8 words).' 
            : 'Keep it short (max 8 words).';
          
          const completion = await groq.chat.completions.create({
            messages: [
              {
                role: 'system',
                content: `You are a hint generator for an idiom guessing game.
The secret idiom is: "${secretPrompt}"
${langInstruction}
Give a helpful hint that guides without revealing. Focus on the meaning of the idiom.`,
              },
              { role: 'user', content: 'Give me a hint.' },
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.8,
            max_tokens: 64,
          });

          hint = completion.choices[0]?.message?.content?.trim() || '';
        } catch (e) {
          console.error('Hint generation error:', e);
        }
      }

      return NextResponse.json({ success: true, hint: hint || 'Think about common expressions!' });
    }

    if (!guess) {
      return NextResponse.json({ error: 'MISSING_GUESS', message: 'Guess is required' }, { status: 400 });
    }

    if (!secretPrompt) {
      return NextResponse.json({ error: 'NO_ACTIVE_GAME', message: 'No active game' }, { status: 400 });
    }

    const hasPusher = !!(process.env.PUSHER_KEY && process.env.PUSHER_SECRET);
    const channelName = `presence-${roomId}`;

    // Look up the English equivalent from the curated DB so we can match against
    // both he and en in the synchronous fast path (no Groq needed for English guesses).
    const idiomEntry = findIdiomByHe(secretPrompt);
    const secretEn   = idiomEntry?.en ?? null;

    // ── STEP 1: Synchronous local check (zero latency) ────────────────────────
    // strictIdiomMatch never produces false positives, so a local correct = definitely correct.
    // This lets us fire round-solved BEFORE the Groq call even starts.
    const localResult = strictIdiomMatch(guess, secretPrompt, secretEn);

    // ── STEP 2: Fire guess-made immediately (non-blocking) ────────────────────
    if (roomId && playerName && hasPusher) {
      pusherServer.trigger(channelName, 'guess-made', {
        player: playerName,
        guess,
        isCorrect: localResult.isCorrect,
      }).catch(() => {});
    }

    // Track guess in gameStore so bots see all player activity this round
    if (roomId && playerName) {
      addGuess(roomId, {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2),
        playerName,
        text: guess,
        timestamp: Date.now(),
      });
    }

    // ── STEP 3: FAST PATH — local match confirmed correct ────────────────────
    // Fire round-solved NOW, before any Groq/DB work. Speed is king.
    if (localResult.isCorrect && roomId) {
      return await broadcastVictory({
        roomId, winner: playerName || 'Unknown', secretPrompt, hasPusher,
        channelName, hintUsed, isFast, pusherServer,
      });
    }

    // ── STEP 4: SLOW PATH — Groq for close/wrong cases ───────────────────────
    // Only reached when local check says wrong. Groq may be more lenient.
    let result: { isCorrect: boolean; hint: string; close: boolean } = localResult;

    if (groq) {
      try {
        const secretBothLangs = secretEn
          ? `Hebrew: "${secretPrompt}" | English equivalent: "${secretEn}"`
          : `"${secretPrompt}"`;

        const systemInstruction = isHebrew
          ? `You are a STRICT BUT FAIR judge for a bilingual idiom guessing game.
The secret idiom is — ${secretBothLangs}
The user guessed: "${guess}"

RULES:
1. Accept EITHER the Hebrew OR the English equivalent as correct.
2. Accept minor variations: "חתול בשק" and "החתול בשק" are both correct.
3. If the guess contains all the main keywords, mark it correct.
4. If the guess contains more than half the keywords, it is close (close: true).
5. If too generic (e.g., just "חתול" when the answer is "חתול בשק"), say: "קרוב, אבל מה הביטוי המלא?"

${langInstructions(isHebrew)}
Respond with JSON: { isCorrect: boolean, hint: string, close: boolean }`
          : `You are a STRICT BUT FAIR judge for a bilingual idiom guessing game.
The secret idiom is — ${secretBothLangs}
The user guessed: "${guess}"

RULES:
1. Accept EITHER the Hebrew OR the English equivalent as correct.
2. Accept minor variations: "A piece of cake" and "piece of cake" are both correct.
3. If the guess contains all the main keywords, mark it correct.
4. If the guess contains more than half the keywords, it is close (close: true).
5. If too generic, ask for the full expression.

Respond with JSON: { isCorrect: boolean, hint: string, close: boolean }`;

        const completion = await groq.chat.completions.create({
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: `Guess: "${guess}". Is it correct?` },
          ],
          model: 'llama-3.3-70b-versatile',
          temperature: 0.3,
          max_tokens: 256,
          response_format: { type: 'json_object' },
        });

        const responseText = completion.choices[0]?.message?.content || '{}';
        try {
          result = JSON.parse(responseText);
        } catch {
          result = localResult;
        }
      } catch {
        result = localResult;
      }
    }

    // Groq found it correct when local check didn't (lenient match)
    if (result.isCorrect && roomId) {
      // Re-broadcast guess-made with the correct flag now that we know
      if (roomId && playerName && hasPusher) {
        pusherServer.trigger(channelName, 'guess-made', {
          player: playerName, guess, isCorrect: true,
        }).catch(() => {});
      }
      return await broadcastVictory({
        roomId, winner: playerName || 'Unknown', secretPrompt, hasPusher,
        channelName, hintUsed, isFast, pusherServer,
      });
    }

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ error: 'VALIDATION_FAILED', message: error.message, hint: 'Try again!', close: false }, { status: 500 });
  }
}

function langInstructions(isHebrew: boolean): string {
  return isHebrew
    ? 'Respond in Hebrew. Make hints fun and helpful.'
    : 'Make hints fun and helpful.';
}

// ── Victory broadcast helper ─────────────────────────────────────────────────
// Called as early as possible — fires round-solved BEFORE any async work.
// Sequence: (1) update server scoreboard → (2) fire Pusher → (3) update phase →
// (4) schedule next round. The Pusher call is the first await so it resolves fast.
async function broadcastVictory({
  roomId, winner, secretPrompt, hasPusher, channelName, hintUsed, isFast, pusherServer,
}: {
  roomId: string;
  winner: string;
  secretPrompt: string;
  hasPusher: boolean;
  channelName: string;
  hintUsed: boolean;
  isFast: boolean;
  pusherServer: Pusher;
}): Promise<Response> {
  const points = (hintUsed ? 50 : 100) + (isFast ? 25 : 0);

  // 1. Update server-side scoreboard (synchronous in-memory — zero latency)
  const scoreboard = updateScore(roomId, winner, points, 1);

  if (hasPusher) {
    try {
      // 2. Fire round-solved FIRST — this is the event that stops all client timers
      await pusherServer.trigger(channelName, 'round-solved', {
        winner,
        secret: secretPrompt,
        points,
        nextRoundIn: 5,
        scoreboard,  // authoritative leaderboard for all clients
      });
      console.log(`[VALIDATE] ✅ round-solved → ${channelName} | winner: ${winner} | pts: ${points}`);
      // Global activity ticker — cross-room live broadcast
      pusherServer.trigger('global-activity', 'arena-win', {
        roomId, winner, secret: secretPrompt, points, timestamp: Date.now(),
      }).catch(() => {});
    } catch (pusherError: any) {
      console.error('[VALIDATE] Pusher error:', pusherError.message);
    }
  }

  // 3. Set phase to 'winner' in store + persist cross-instance so sync sees it
  updateGameState(roomId, { phase: 'winner', winner });
  upsertActiveRound({ roomId, roundId: '', phase: 'winner', imageUrl: null, roundStartTime: null }).catch(() => {});

  // 4. Kick off image generation NOW (during the 5-second victory window) so the
  //    next image is ready — or close to ready — when the countdown hits 0.
  //    'delayBroadcastMs:5000' tells start-round to hold the game-started broadcast
  //    until at least 5 s have elapsed from this call, so clients don't flip out of
  //    the winner overlay before the countdown ends.
  (async () => {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const res = await fetch(`${baseUrl}/api/game/start-round`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, delayBroadcastMs: 5000 }),
      });
      const data = await res.json();
      console.log('[VALIDATE] Next round prefetch:', data.success ? '✅ image ready' : '❌', data.error || '');
    } catch (e) {
      console.error('[VALIDATE] Failed to prefetch next round:', e);
    }
  })();

  return NextResponse.json({ success: true, isCorrect: true, hint: 'נכון!', close: false, points });
}
