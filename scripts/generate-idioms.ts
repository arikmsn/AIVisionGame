#!/usr/bin/env npx tsx
/**
 * Idiom Bank Generator — Phase 3
 *
 * Generates 400 new English idioms using Claude claude-sonnet-4-6, targeting a total
 * bank of 500+ idioms (100 existing + 400 new). Each idiom includes a visual
 * prompt optimized for fal.ai flux/schnell image generation.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=xxx npx tsx scripts/generate-idioms.ts
 *
 * Output:
 *   src/lib/benchmark/idioms.ts — merged idiom list (existing + new)
 *   scripts/generated-idioms-raw.json — raw Claude output for inspection
 *
 * Quality validation:
 *   After running, manually review 20 sample images:
 *     npx tsx scripts/validate-idiom-images.ts
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');

// ── Config ────────────────────────────────────────────────────────────────────

const BATCH_SIZE    = 40;   // idioms per Claude call
const TARGET_NEW    = 400;  // total new idioms to generate
const BATCHES       = Math.ceil(TARGET_NEW / BATCH_SIZE); // = 10
const MODEL         = 'claude-sonnet-4-6';

// ── Existing idiom list ───────────────────────────────────────────────────────

// Read existing idiom phrases to avoid duplicates
const existingIdiomsModule = fs.readFileSync(
  path.join(ROOT, 'src/lib/benchmark/idioms.ts'),
  'utf-8',
);
const existingPhrases: string[] = [];
for (const match of existingIdiomsModule.matchAll(/phrase:\s*"([^"]+)"/g)) {
  existingPhrases.push(match[1].toLowerCase());
}
console.log(`Loaded ${existingPhrases.length} existing idioms.`);

// ── Category sets for diversity ───────────────────────────────────────────────

const CATEGORIES = [
  'nature', 'body', 'sports', 'money', 'time',
  'animals', 'weather', 'food', 'tools', 'social',
];

const ORIGINS = ['american', 'british', 'australian', 'universal'];

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompt(
  batchIndex:      number,
  alreadyGenerated: string[],
): string {
  const avoidList = [...existingPhrases, ...alreadyGenerated]
    .slice(0, 150) // keep prompt manageable
    .map(p => `"${p}"`)
    .join(', ');

  const focusCategory = CATEGORIES[batchIndex % CATEGORIES.length];

  return `Generate exactly ${BATCH_SIZE} unique English idioms for a visual guessing game. Focus this batch on the "${focusCategory}" category, but include variety.

REQUIREMENTS FOR EACH IDIOM:
1. Must be a COMMON English idiom (used in everyday speech, not obscure)
2. Must have a LITERAL visual representation that is unambiguous when depicted
3. The idiom must be visually depictable without using text/words in the image
4. Do NOT repeat any of these existing idioms: ${avoidList}

FOR EACH IDIOM, RETURN:
- phrase: the exact idiom text (e.g. "bite the bullet")
- hint: one sentence explaining what the idiom means
- difficulty: "easy" | "medium" | "hard" (based on how visually recognizable the literal depiction would be to a vision AI)
- visualPrompt: a detailed image generation prompt for fal.ai flux/schnell that depicts the idiom LITERALLY. Must include:
  * Specific concrete objects/actions from the idiom's literal meaning
  * Scene composition (foreground/background)
  * Lighting and style (photorealistic or illustrated)
  * NO abstract concepts, NO text/words in the scene
  * 30-60 words
- category: one of: nature, body, sports, money, time, animals, weather, food, tools, social
- origin: one of: american, british, australian, universal
- ambiguityScore: integer 1-5 (1=very clear, 5=many plausible wrong interpretations for a vision model)

EXAMPLES OF GOOD IDIOMS (for reference style):
- "Break the ice": person shattering a wall of ice at a social gathering
- "Spill the beans": beans exploding out of a jar
- "Hit the nail on the head": hammer striking nail perfectly

Return ONLY a valid JSON array. No markdown, no commentary, no code blocks. Start with [ and end with ].

Each element: { "phrase": "...", "hint": "...", "difficulty": "...", "visualPrompt": "...", "category": "...", "origin": "...", "ambiguityScore": N }`;
}

// ── Main generator ────────────────────────────────────────────────────────────

async function generate(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY not set. Exiting.');
    process.exit(1);
  }

  const client    = new Anthropic({ apiKey });
  const allNew:   any[] = [];
  const seenPhrases = new Set(existingPhrases);

  console.log(`\nGenerating ${TARGET_NEW} new idioms in ${BATCHES} batches of ${BATCH_SIZE}...\n`);

  for (let i = 0; i < BATCHES; i++) {
    const alreadyGenerated = allNew.map(d => d.phrase.toLowerCase());
    const prompt = buildPrompt(i, alreadyGenerated);

    console.log(`Batch ${i + 1}/${BATCHES} (focus: ${CATEGORIES[i % CATEGORIES.length]})...`);

    let batch: any[] = [];
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 8000,
        messages: [{ role: 'user', content: prompt }],
      });

      const raw = response.content.find(b => b.type === 'text')?.text ?? '';
      // Extract JSON array (handle potential leading/trailing whitespace or text)
      const arrayMatch = raw.match(/\[[\s\S]*\]/);
      if (!arrayMatch) throw new Error('No JSON array found in response');

      batch = JSON.parse(arrayMatch[0]);
      console.log(`  → Received ${batch.length} idioms`);

      // Filter: remove duplicates and validate required fields
      let added = 0;
      for (const item of batch) {
        const phraseNorm = item.phrase?.toLowerCase()?.trim();
        if (!phraseNorm || seenPhrases.has(phraseNorm)) continue;
        if (!item.hint || !item.difficulty || !item.visualPrompt) continue;
        if (!['easy', 'medium', 'hard'].includes(item.difficulty)) continue;
        if (!item.visualPrompt || item.visualPrompt.length < 20) continue;

        seenPhrases.add(phraseNorm);
        allNew.push({
          phrase:         item.phrase.trim(),
          hint:           item.hint.trim(),
          difficulty:     item.difficulty,
          visualPrompt:   item.visualPrompt.trim(),
          category:       CATEGORIES.includes(item.category) ? item.category : 'social',
          origin:         ORIGINS.includes(item.origin) ? item.origin : 'universal',
          ambiguityScore: Math.min(5, Math.max(1, Math.round(item.ambiguityScore ?? 3))),
        });
        added++;
      }
      console.log(`  → ${added} unique valid idioms added (total: ${allNew.length})`);

    } catch (err: any) {
      console.error(`  ! Batch ${i + 1} failed: ${err.message}`);
      if (batch.length > 0) console.error('  Raw response snippet:', JSON.stringify(batch).slice(0, 200));
    }

    // Polite delay between API calls
    if (i < BATCHES - 1) await sleep(1500);
  }

  console.log(`\n✓ Generated ${allNew.length} new idioms\n`);

  // ── Save raw output ────────────────────────────────────────────────────────
  const rawPath = path.join(__dirname, 'generated-idioms-raw.json');
  fs.writeFileSync(rawPath, JSON.stringify(allNew, null, 2), 'utf-8');
  console.log(`Raw output saved to: ${rawPath}`);

  // ── Merge with existing idioms and write TS file ───────────────────────────
  const existingModule = fs.readFileSync(
    path.join(ROOT, 'src/lib/benchmark/idioms.ts'),
    'utf-8',
  );

  // Find the last entry ID from existing idioms
  const existingIds = [...existingModule.matchAll(/id:\s*(\d+)/g)].map(m => parseInt(m[1]));
  let nextId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 101;

  // Build new entries TypeScript
  const newEntries = allNew.map((item, _) => {
    const id = nextId++;
    return `  { id: ${id.toString().padStart(3, ' ')}, phrase: ${JSON.stringify(item.phrase)}, hint: ${JSON.stringify(item.hint)}, difficulty: "${item.difficulty}", visualPrompt: ${JSON.stringify(item.visualPrompt)} },`;
  });

  // Inject before the closing `];`
  const injection = newEntries.join('\n');
  const updatedModule = existingModule.replace(
    /(\n\];)/,
    `\n\n  // ── Phase 3 generated idioms (${new Date().toISOString().slice(0, 10)}) ──────────────────────────────────────\n${injection}\n];`,
  );

  fs.writeFileSync(
    path.join(ROOT, 'src/lib/benchmark/idioms.ts'),
    updatedModule,
    'utf-8',
  );

  const totalCount = existingPhrases.length + allNew.length;
  console.log(`✓ Updated src/lib/benchmark/idioms.ts — ${totalCount} total idioms`);
  console.log(`\nNext step: run validate-idiom-images.ts to inspect 20 random samples.`);
}

// ── Image validation helper script info ──────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

generate().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
