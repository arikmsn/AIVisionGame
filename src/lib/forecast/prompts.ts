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

/**
 * Walk a JSON string from startIdx, respecting string escaping.
 * Returns the substring from startIdx to the matching closing brace,
 * or null if no matching brace is found.
 */
function extractJsonObject(s: string, startIdx: number): string | null {
  let depth    = 0;
  let inString = false;
  let escape   = false;

  for (let i = startIdx; i < s.length; i++) {
    const c = s[i];
    if (escape)              { escape = false; continue; }
    if (c === '\\' && inString) { escape = true;  continue; }
    if (c === '"')           { inString = !inString; continue; }
    if (inString)            { continue; }
    if      (c === '{')      { depth++; }
    else if (c === '}')      { depth--; if (depth === 0) return s.slice(startIdx, i + 1); }
  }
  return null;
}

/**
 * Escape literal control characters (newlines, tabs, carriage returns) that
 * appear inside JSON string values. LLMs sometimes emit these verbatim inside
 * quoted values, making JSON.parse throw a SyntaxError even when the overall
 * structure is valid. This walks the string character-by-character, tracking
 * whether we're inside a JSON string, and escapes any bare control chars found
 * there.
 */
function normalizeJsonControlChars(s: string): string {
  const out: string[] = [];
  let inString = false;
  let escape   = false;

  for (let i = 0; i < s.length; i++) {
    const c  = s[i];
    const cc = s.charCodeAt(i);

    if (escape) {
      out.push(c);
      escape = false;
      continue;
    }
    if (c === '\\' && inString) {
      out.push(c);
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      out.push(c);
      continue;
    }
    // Escape literal control characters only while inside a string value
    if (inString && cc < 0x20) {
      if      (cc === 0x0a) { out.push('\\n');  continue; }  // LF
      else if (cc === 0x0d) { out.push('\\r');  continue; }  // CR
      else if (cc === 0x09) { out.push('\\t');  continue; }  // TAB
      else                  { out.push(`\\u${cc.toString(16).padStart(4, '0')}`); continue; }
    }
    out.push(c);
  }
  return out.join('');
}

/**
 * Field-by-field regex extraction — last resort when JSON is too malformed to
 * parse even after normalization. Extracts each scalar field independently.
 */
function extractFieldsRegex(s: string): ForecastOutput | null {
  const probMatch  = s.match(/"probability_yes"\s*:\s*([0-9.]+)/);
  if (!probMatch) return null;
  const prob = Number(probMatch[1]);
  if (isNaN(prob) || prob < 0 || prob > 1) return null;

  const confMatch  = s.match(/"confidence"\s*:\s*([0-9.]+)/);
  const actMatch   = s.match(/"action"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
  const shortMatch = s.match(/"rationale_short"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);

  // rationale_full can be long — grab everything between its opening quote and
  // the next unescaped quote followed by a comma or closing brace.
  let rationaleFull = '';
  const rfIdx = s.indexOf('"rationale_full"');
  if (rfIdx >= 0) {
    const valStart = s.indexOf('"', rfIdx + '"rationale_full"'.length + 1);
    if (valStart >= 0) {
      let end = valStart + 1;
      let esc = false;
      while (end < s.length) {
        if (esc)        { esc = false; }
        else if (s[end] === '\\') { esc = true; }
        else if (s[end] === '"') { break; }
        end++;
      }
      rationaleFull = s.slice(valStart + 1, end)
        .replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\t/g, '\t');
    }
  }

  return {
    probability_yes: Math.max(0.01, Math.min(0.99, prob)),
    confidence:      Math.max(0, Math.min(1, Number(confMatch?.[1]) || 0.5)),
    action:          String(actMatch?.[1] || 'hold'),
    rationale_short: String(shortMatch?.[1] || '').slice(0, 500),
    rationale_full:  rationaleFull.slice(0, 5000),
  };
}

/** Parse model output into structured forecast, with fallbacks */
export function parseForecastOutput(raw: string): ForecastOutput | null {
  const buildResult = (parsed: any): ForecastOutput | null => {
    const prob = Number(parsed.probability_yes);
    if (isNaN(prob) || prob < 0 || prob > 1) return null;
    return {
      probability_yes: Math.max(0.01, Math.min(0.99, prob)),
      confidence:      Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
      action:          String(parsed.action || 'hold'),
      rationale_short: String(parsed.rationale_short || '').slice(0, 500),
      rationale_full:  String(parsed.rationale_full || '').slice(0, 5000),
    };
  };

  const s = raw.trim();

  // Try 1: direct parse (clean JSON response)
  try { return buildResult(JSON.parse(s)); } catch { /* continue */ }

  // Try 2: anchor on "probability_yes" in original text, using string-escape-aware
  // brace scanner. Works even when thinking prose contains { } or rationale has
  // backtick sequences that would fool a fence-strip regex.
  const probIdx = s.lastIndexOf('"probability_yes"');
  if (probIdx >= 0) {
    const openBrace = s.lastIndexOf('{', probIdx);
    if (openBrace >= 0) {
      const candidate = extractJsonObject(s, openBrace);
      if (candidate) {
        // Try 2a: direct parse
        try { return buildResult(JSON.parse(candidate)); } catch { /* continue */ }
        // Try 2b: normalize literal control chars then parse
        try { return buildResult(JSON.parse(normalizeJsonControlChars(candidate))); } catch { /* continue */ }
      }
    }
  }

  // Try 3: strip markdown code fences (handles ` ```json ... ``` ` output)
  // Use greedy inner match so inner backtick sequences in rationale_full don't
  // truncate the capture prematurely — then parse or re-anchor inside.
  const fenceMatch = s.match(/```(?:json)?[\s\S]*?({[\s\S]*})[\s\S]*?```/);
  if (fenceMatch?.[1]) {
    try { return buildResult(JSON.parse(fenceMatch[1])); } catch { /* continue */ }
    try { return buildResult(JSON.parse(normalizeJsonControlChars(fenceMatch[1]))); } catch { /* continue */ }
  }

  // Try 4: greedy brace match + normalize
  const braceMatch = s.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return buildResult(JSON.parse(braceMatch[0])); } catch { /* continue */ }
    try { return buildResult(JSON.parse(normalizeJsonControlChars(braceMatch[0]))); } catch { /* continue */ }
  }

  // Try 5: field-by-field regex extraction — handles deeply malformed JSON
  return extractFieldsRegex(s);
}
