/**
 * Forecast Arena — Agent prompts
 *
 * Each strategy gets a tailored system prompt. The user message is
 * dynamically built from market context.
 */

export interface MarketContext {
  title:           string;
  description:     string;
  currentYesPrice: number | null;
  volumeUsd:       number;
  closeTime:       string | null;
  category:        string | null;
  recentSnapshots?: Array<{ timestamp: string; yes_price: number }>;
}

const RESPONSE_FORMAT = `
Respond ONLY with valid JSON in this exact format (no markdown, no text before/after):
{
  "probability_yes": <number between 0.01 and 0.99>,
  "confidence": <number between 0.0 and 1.0>,
  "action": "<one of: hold|lean_yes|lean_no|strong_yes|strong_no>",
  "rationale_short": "<one sentence summary>",
  "rationale_full": "<2-3 paragraphs of analysis>"
}`;

const SYSTEM_PROMPTS: Record<string, string> = {
  speed_first: `You are Fast Reactor, a forecasting agent that makes quick, intuitive assessments of prediction markets. You prioritize speed and gut-feel over deep analysis. You look for the most obvious signal and bet accordingly. You are calibrated — your probability estimates should match your actual accuracy over many predictions.

When the market price seems clearly wrong based on a quick read, you take a strong position. When uncertain, you stay close to the market price.${RESPONSE_FORMAT}`,

  text_heavy: `You are Text Analyst, a forecasting agent that performs deep textual reasoning on prediction markets. You carefully analyze the question wording, description, resolution criteria, and any nuances that other agents might miss. You think step by step through the logic.

You are especially good at spotting conditional probabilities, identifying key uncertainties, and accounting for base rates. Your forecasts tend to be well-calibrated because you explicitly consider both sides of the argument.${RESPONSE_FORMAT}`,

  contrarian: `You are Contrarian, a forecasting agent that systematically fades market consensus. You believe prediction markets are often biased by recency, media hype, and herd behavior. When the market price is strongly in one direction (>0.75 or <0.25), you look for reasons the consensus might be wrong.

Your edge comes from identifying situations where the crowd is overconfident. You are NOT blindly contrarian — you only take the other side when you can articulate a specific reason the market is wrong. If the market seems fairly priced, you stay close to it.${RESPONSE_FORMAT}`,

  anchored: `You are Consensus Guard, a forecasting agent that anchors heavily to the current market price. You believe prediction markets are usually efficient and hard to beat. Your forecasts rarely deviate more than 10 percentage points from the market price.

Your value comes from stability and calibration. You make small adjustments based on obvious factors but avoid large bets. You explicitly track how far your estimate is from the market and only deviate significantly with very strong evidence.${RESPONSE_FORMAT}`,
};

export function buildSystemPrompt(strategy: string): string {
  return SYSTEM_PROMPTS[strategy] ?? SYSTEM_PROMPTS.speed_first;
}

export function buildUserMessage(ctx: MarketContext): string {
  const parts: string[] = [];

  parts.push(`## Market Question\n${ctx.title}`);

  if (ctx.description) {
    // Truncate description to avoid token waste
    const desc = ctx.description.length > 1500
      ? ctx.description.slice(0, 1500) + '...'
      : ctx.description;
    parts.push(`## Description\n${desc}`);
  }

  parts.push(`## Current Market Data`);
  if (ctx.currentYesPrice != null) {
    parts.push(`- Current YES price: ${(ctx.currentYesPrice * 100).toFixed(1)}% ($${ctx.currentYesPrice.toFixed(4)})`);
    parts.push(`- Current NO price: ${((1 - ctx.currentYesPrice) * 100).toFixed(1)}%`);
  } else {
    parts.push(`- Current YES price: unknown`);
  }
  parts.push(`- Volume: $${ctx.volumeUsd.toLocaleString()}`);

  if (ctx.closeTime) {
    const close = new Date(ctx.closeTime);
    const now = new Date();
    const daysLeft = Math.max(0, Math.round((close.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    parts.push(`- Closes: ${close.toISOString().split('T')[0]} (${daysLeft} days from now)`);
  }

  if (ctx.category) {
    parts.push(`- Category: ${ctx.category}`);
  }

  if (ctx.recentSnapshots && ctx.recentSnapshots.length > 0) {
    parts.push(`\n## Recent Price History (last ${ctx.recentSnapshots.length} snapshots)`);
    for (const snap of ctx.recentSnapshots.slice(-5)) {
      parts.push(`- ${snap.timestamp}: ${(snap.yes_price * 100).toFixed(1)}%`);
    }
  }

  parts.push(`\nMake your forecast now. Remember to return ONLY valid JSON.`);

  return parts.join('\n');
}

export interface ForecastOutput {
  probability_yes:  number;
  confidence:       number;
  action:           string;
  rationale_short:  string;
  rationale_full:   string;
}

/** Parse model output into structured forecast, with fallbacks */
export function parseForecastOutput(raw: string): ForecastOutput | null {
  try {
    // Try to find JSON in the response
    let jsonStr = raw.trim();

    // Strip markdown code fences if present
    const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    // Try to find a JSON object
    const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (braceMatch) jsonStr = braceMatch[0];

    const parsed = JSON.parse(jsonStr);

    const prob = Number(parsed.probability_yes);
    if (isNaN(prob) || prob < 0 || prob > 1) return null;

    return {
      probability_yes: Math.max(0.01, Math.min(0.99, prob)),
      confidence:      Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
      action:          String(parsed.action || 'hold'),
      rationale_short: String(parsed.rationale_short || '').slice(0, 500),
      rationale_full:  String(parsed.rationale_full || '').slice(0, 5000),
    };
  } catch {
    return null;
  }
}
