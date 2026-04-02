/**
 * Pure idiom-matching utilities shared between:
 *   - src/app/api/game/validate/route.ts  (human player guesses)
 *   - src/lib/agents/orchestrator.ts       (bot guesses — direct call, no HTTP)
 */

// ── Text normalisation ────────────────────────────────────────────────────────
// Strips Hebrew niqqud / cantillation, English punctuation, and folds case.
export function normalizeText(text: string): string {
  return text
    .replace(/[\u0591-\u05C7]/g, '')
    .replace(/[\u05F3\u05F4]/g, '')
    .replace(/['''""".,!?;:()\-–—\/\\[\]{}@#$%^&*+=<>]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

// ── Dual-language idiom matching ──────────────────────────────────────────────
// Checks guess against BOTH the Hebrew (he) and English (en) versions.
// Priority:
//   1. Exact normalised match against he OR en  → CORRECT
//   2. All content words of he match             → CORRECT
//   3. All content words of en match             → CORRECT
//   4. ≥ half of he words match                  → CLOSE
//   5. Guess is a long substring of he           → CLOSE
//   6. Otherwise                                 → WRONG
export function strictIdiomMatch(
  guess:    string,
  secretHe: string,
  secretEn: string | null,
): { isCorrect: boolean; hint: string; close: boolean } {
  const guessNorm = normalizeText(guess);
  const heNorm    = normalizeText(secretHe);
  const enNorm    = secretEn ? normalizeText(secretEn) : null;
  const isHebrew  = /[\u0590-\u05FF]/.test(guess);

  if (guessNorm === heNorm || (enNorm && guessNorm === enNorm)) {
    return { isCorrect: true, hint: 'נכון!', close: false };
  }

  const guessWords = guessNorm.split(/\s+/).filter(w => w.length > 1);
  const heWords    = heNorm.split(/\s+/).filter(w => w.length > 1);
  const heMatches  = heWords.filter(hw =>
    guessWords.some(gw => gw === hw || hw.includes(gw) || gw.includes(hw)),
  );

  if (heMatches.length === heWords.length && heWords.length > 0) {
    return { isCorrect: true, hint: 'נכון!', close: false };
  }

  if (enNorm) {
    const enWords   = enNorm.split(/\s+/).filter(w => w.length > 1);
    const enMatches = enWords.filter(ew =>
      guessWords.some(gw => gw === ew || ew.includes(gw) || gw.includes(ew)),
    );
    if (enMatches.length === enWords.length && enWords.length > 0) {
      return { isCorrect: true, hint: 'נכון!', close: false };
    }
  }

  if (heMatches.length >= Math.ceil(heWords.length / 2) && heWords.length > 1) {
    const hint = isHebrew ? 'קרוב, אבל מה הביטוי המלא?' : "Close — but what's the full expression?";
    return { isCorrect: false, hint, close: true };
  }

  if (heNorm.includes(guessNorm) && guessNorm.length > heNorm.length * 0.5) {
    const hint = isHebrew ? 'קרוב, אבל מה הביטוי המלא?' : 'Close — try the full phrase';
    return { isCorrect: false, hint, close: true };
  }

  const hint = isHebrew ? 'נסה שוב!' : 'Try again!';
  return { isCorrect: false, hint, close: false };
}
