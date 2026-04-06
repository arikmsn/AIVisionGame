/**
 * API Cost Pricing — Phase 3
 *
 * Prices are in USD per 1M tokens, sourced from each provider's public pricing
 * page as of 2026-04-06. Update this table when pricing changes.
 *
 * Vision input tokens include the image cost; providers typically charge image
 * tokens at the same rate as text input tokens.
 */

// ── Pricing table ─────────────────────────────────────────────────────────────

interface ModelPricing {
  inputPer1M:  number; // USD per 1M input tokens
  outputPer1M: number; // USD per 1M output tokens
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Google
  'gemini-2.5-pro':                                  { inputPer1M: 1.25,  outputPer1M: 10.00 },
  'gemma-3-27b-it':                                  { inputPer1M: 0.00,  outputPer1M: 0.00  }, // free via AI Studio

  // Anthropic
  'claude-opus-4-6':                                 { inputPer1M: 15.00, outputPer1M: 75.00 },
  'claude-sonnet-4-6':                               { inputPer1M: 3.00,  outputPer1M: 15.00 },

  // OpenAI
  'gpt-4.1':                                         { inputPer1M: 2.00,  outputPer1M: 8.00  },

  // xAI
  'grok-4.20-0309-non-reasoning':                    { inputPer1M: 3.00,  outputPer1M: 15.00 },

  // Groq (Llama 4 Scout)
  'meta-llama/llama-4-scout-17b-16e-instruct':       { inputPer1M: 0.11,  outputPer1M: 0.34  },

  // Mistral
  'mistral-large-latest':                            { inputPer1M: 2.00,  outputPer1M: 6.00  },
  'pixtral-large-latest':                            { inputPer1M: 2.00,  outputPer1M: 6.00  },

  // OpenRouter (Qwen via together)
  'qwen/qwen2.5-vl-72b-instruct':                   { inputPer1M: 0.40,  outputPer1M: 0.40  },

  // Together AI (Kimi K2.5)
  'moonshotai/Kimi-K2.5':                            { inputPer1M: 0.14,  outputPer1M: 0.14  },
};

// ── Cost estimator ────────────────────────────────────────────────────────────

/**
 * Estimate USD cost for a single API call.
 * Returns 0 if the model is not in the pricing table.
 */
export function estimateCostUsd(
  modelId:      string,
  inputTokens:  number,
  outputTokens: number,
): number {
  const pricing = MODEL_PRICING[modelId];
  if (!pricing) return 0;
  return (
    (inputTokens  * pricing.inputPer1M  / 1_000_000) +
    (outputTokens * pricing.outputPer1M / 1_000_000)
  );
}

/**
 * Rough estimate of tokens in a string (~4 chars per token).
 * Used for pre-call budget sanity checks when actual usage isn't yet known.
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimated cost for one full tournament round (all 11 models, 1 attempt each).
 * Useful for pre-flight budget checks before triggering a tournament.
 */
export function estimateRoundCostUsd(contextCharLength = 8000): number {
  return Object.entries(MODEL_PRICING).reduce((sum, [, pricing]) => {
    const inputTokens  = estimateTokenCount(''.padEnd(contextCharLength)); // context
    const outputTokens = 200; // typical arena response
    return sum + estimateCostUsd('', inputTokens, outputTokens) +
      (inputTokens * pricing.inputPer1M / 1_000_000) +
      (outputTokens * pricing.outputPer1M / 1_000_000);
  }, 0);
}
