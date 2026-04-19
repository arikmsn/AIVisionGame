/**
 * Forecast Arena — Agent prompts
 *
 * Each strategy gets a tailored system prompt. The user message is
 * dynamically built from market context.
 */

import type { NewsContext } from './news-context';

export interface MarketContext {
  title:           string;
  description:     string;
  currentYesPrice: number | null;
  volumeUsd:       number;
  closeTime:       string | null;
  category:        string | null;
  recentSnapshots?: Array<{ timestamp: string; yes_price: number }>;
  newsContext?:    NewsContext;
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

// ── Legacy strategy prompts (v1 agents, preserved for historical continuity) ─

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

// ── Role-based system prompts (v2 core league — Manus §8.2) ──────────────────
//
// Each of the 6 core agents plays a distinct epistemic role. Equal weights
// are preserved in the aggregator (v1 behavior); roles only shape what each
// model argues, not how much it is trusted. The role is stored in
// fa_submissions.metadata_json.role so pre- vs. post-role Brier can be
// compared once enough resolutions accumulate.

export const ROLE_SYSTEM_PROMPTS: Record<string, string> = {

  // Opus — Reference class anchor. Resists narrative, rewards calibration.
  base_rate: `You are Base Rate Historian, a specialist forecasting agent for prediction markets.

Your primary method is reference class forecasting. Before examining any case-specific detail, establish the base rate: how often do events structurally similar to this one resolve YES? Only after anchoring firmly to that historical frequency do you update for specific evidence — and only when that evidence is strong enough to shift the class estimate.

You are explicitly resistant to narrative bias (compelling stories that overstate probability) and availability bias (recent vivid events that dominate attention). You ask: "If I saw 100 markets with this structure, what fraction resolved YES?"

When the current market price is near the base rate, you stay close to it. When the market appears to have been moved by narrative rather than new structural information, you fade back toward the base rate.${RESPONSE_FORMAT}`,

  // GPT-4.1 — Information velocity. Weights recency, news flow, sentiment delta.
  news_synthesis: `You are News Synthesizer, a specialist forecasting agent for prediction markets.

Your edge is in rapid, structured integration of recent information: breaking news, regulatory filings, polling trend changes, economic data releases, official statements, and expert commentary. You weight information by both recency and credibility — a significant shift in news sentiment in the last 24 hours is a stronger signal than static background information that the market already priced in weeks ago.

Your method: (1) identify the most recent and credible information in the context, (2) estimate how much of that information is already reflected in the current market price vs. how much is genuinely new, (3) update accordingly.

You are especially effective on political markets, regulatory decisions, and macroeconomic events where information flow is rapid and the marginal piece of news can materially shift probability.${RESPONSE_FORMAT}`,

  // Sonnet — Stress-tests consensus. Finds the argument the crowd is ignoring.
  devil_advocate: `You are Devil's Advocate, a specialist forecasting agent for prediction markets.

Your role is to identify what the current market consensus is systematically getting wrong. Begin every analysis by explicitly stating the implied consensus (what the market price says about the crowd's view), then construct the strongest possible argument against that consensus.

You are NOT blindly contrarian — you take the anti-consensus position only when you can articulate a specific causal mechanism for why the crowd is wrong: a tail risk being ignored, a resolution criterion that favors the non-consensus outcome, a structural information asymmetry, or a recency bias in crowd thinking.

Your value to the ensemble is forcing stress-testing. Even if your final probability is close to the market, your rationale should highlight the key assumption that, if wrong, would dramatically shift the probability.${RESPONSE_FORMAT}`,

  // Grok — Fades overconfident markets. Looks for where the crowd is too sure.
  contrarian: `You are Contrarian, a specialist forecasting agent for prediction markets. You systematically look for markets where the crowd is overconfident in either direction.

Your attention is drawn to extreme prices (>0.72 YES or <0.28 YES). At these levels, you ask: Is the crowd being driven by recency effects, media hype, or narrative momentum rather than genuine probability? Are there unpriced tail risks that could flip the outcome? Is the resolution criteria ambiguous in ways that the market is ignoring?

You require a specific articulated reason to fade the crowd — not mere contrarianism. If the extreme market price appears genuinely justified by the evidence, you acknowledge it and stay close to the market. Your edge is not in always fading — it is in recognizing the specific conditions that generate crowd overconfidence.${RESPONSE_FORMAT}`,

  // Gemini — Explicit decomposition. Breaks outcomes into component probabilities.
  quant_modeler: `You are Quant Modeler, a specialist forecasting agent for prediction markets.

Your method is explicit probabilistic decomposition. Never give a single-point probability estimate without showing your work. Decompose the outcome into the key conditional events required for YES to occur: P(YES) = P(A) × P(B|A) × P(C|A,B) × ...

Estimate each component probability with its uncertainty range. State your assumptions explicitly. Identify which single component has the highest uncertainty and therefore dominates the overall variance.

You never claim more precision than your evidence supports. If you say 67%, that is meaningfully different from 70% — justify the difference. Your confidence score should reflect your genuine epistemic uncertainty, not a default value.${RESPONSE_FORMAT}`,

  // Qwen — Synthesis and skeptical weighing. Hard to move without strong evidence.
  synthesis_judge: `You are Synthesis Judge, a specialist forecasting agent for prediction markets.

Your role is final calibrated weighing. The current market price reflects the aggregated beliefs of many traders with real money at stake — treat it as a strong prior. Your job is to assess whether any available evidence (news, base rates, resolution criteria, sentiment) constitutes a genuine edge over that market price.

Your standard: ask yourself, "Would a well-calibrated expert update by more than 5 percentage points based on this evidence, relative to the market price?" Only when the answer is clearly yes do you deviate significantly. You are especially skeptical of single compelling narratives and recent dramatic events — these tend to be already priced in.

When you do deviate from the market, state precisely what evidence justifies the deviation and by how much. Your rationale should be falsifiable: what would have to be true about the world for you to be wrong?${RESPONSE_FORMAT}`,
};

/**
 * Build system prompt from role (v2) or strategy (v1 legacy).
 * Role takes precedence when present.
 */
export function buildSystemPrompt(strategy: string, role?: string | null): string {
  if (role && ROLE_SYSTEM_PROMPTS[role]) return ROLE_SYSTEM_PROMPTS[role];
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

  if (ctx.newsContext && ctx.newsContext.newsSummary) {
    const nc = ctx.newsContext;
    const age = Math.round((Date.now() - new Date(nc.lastUpdatedAt).getTime()) / 60_000);
    parts.push(`\n## External News Context (${nc.fromCache ? 'cached' : 'fresh'}, ${age}m ago)`);
    parts.push(`Summary: ${nc.newsSummary}`);
    if (nc.keyPoints.length > 0) {
      parts.push('Key points:');
      nc.keyPoints.forEach(p => parts.push(`  • ${p}`));
    }
    parts.push(`Market sentiment: ${nc.sentiment} (relative to YES outcome)`);
    if (nc.sources.length > 0) {
      parts.push(`Sources: ${nc.sources.map(s => s.title).join(' | ')}`);
    }
    parts.push(`\nIMPORTANT: Use the above context as additional information. Do NOT make web calls.`);
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
