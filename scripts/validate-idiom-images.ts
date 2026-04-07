/**
 * Idiom Image Validator — Phase 3 pre-commit check
 *
 * Selects 20 idioms from the generated bank (2 per category, balanced difficulty),
 * generates a fal.ai image for each, then writes an HTML gallery for human review.
 *
 * Usage:
 *   npx tsx --env-file=.env.vercel scripts/validate-idiom-images.ts
 *
 * Output:
 *   scripts/validation-gallery.html   — open in browser to review
 *   scripts/validation-results.json  — machine-readable results
 */

import * as fs   from 'fs';
import * as path from 'path';

// ── Load generated idioms ─────────────────────────────────────────────────────

const RAW_PATH     = path.join(process.cwd(), 'scripts', 'generated-idioms-raw.json');
const GALLERY_PATH = path.join(process.cwd(), 'scripts', 'validation-gallery.html');
const RESULTS_PATH = path.join(process.cwd(), 'scripts', 'validation-results.json');

interface GeneratedIdiom {
  phrase:       string;
  hint:         string;
  difficulty:   'easy' | 'medium' | 'hard';
  category:     string;
  visualPrompt: string;
}

const allIdioms: GeneratedIdiom[] = JSON.parse(fs.readFileSync(RAW_PATH, 'utf-8'));

// ── Sample selection: 2 per category, 1 easy/medium + 1 medium/hard ──────────

const CATEGORIES = ['nature', 'weather', 'animals', 'body', 'sports', 'money', 'social', 'time', 'food', 'tools'];
const EASY_TIERS  = new Set(['easy', 'medium']);
const HARD_TIERS  = new Set(['medium', 'hard']);

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Seed selection deterministically for reproducibility across runs
Math.random = (() => {
  let seed = 42;
  return () => {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return (seed >>> 0) / 0xffffffff;
  };
})();

const selected: GeneratedIdiom[] = [];

for (const cat of CATEGORIES) {
  const catIdioms = allIdioms.filter(i => i.category === cat);
  const easierOnes = catIdioms.filter(i => EASY_TIERS.has(i.difficulty));
  const harderOnes = catIdioms.filter(i => HARD_TIERS.has(i.difficulty));
  if (easierOnes.length > 0) selected.push(pickRandom(easierOnes));
  if (harderOnes.length > 0) selected.push(pickRandom(harderOnes));
}

// Trim to exactly 20 (should be 20 with 10 categories × 2)
const SAMPLE = selected.slice(0, 20);

console.log(`\nSelected ${SAMPLE.length} idioms for validation:`);
for (const [i, idiom] of SAMPLE.entries()) {
  console.log(`  ${String(i + 1).padStart(2)}. [${idiom.difficulty.padEnd(6)}] [${idiom.category.padEnd(8)}] "${idiom.phrase}"`);
}

// ── Generate images via fal.ai ────────────────────────────────────────────────

const FAL_KEY = process.env.FAL_KEY;
if (!FAL_KEY) {
  console.error('\n✗ FAL_KEY not set — cannot generate images');
  process.exit(1);
}

async function generateImage(visualPrompt: string): Promise<string | null> {
  try {
    const res = await fetch('https://fal.run/fal-ai/flux/schnell', {
      method:  'POST',
      headers: { 'Authorization': `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        prompt:     visualPrompt,
        image_size: 'landscape_4_3',
        num_images: 1,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.error(`  fal.ai HTTP ${res.status}`);
      return null;
    }
    const data = await res.json() as { images?: Array<{ url: string }> };
    return data.images?.[0]?.url ?? null;
  } catch (err: any) {
    console.error(`  fal.ai error: ${err?.message}`);
    return null;
  }
}

console.log('\nGenerating images (5 at a time)...\n');

interface ValidationResult {
  index:        number;
  phrase:       string;
  hint:         string;
  difficulty:   string;
  category:     string;
  visualPrompt: string;
  imageUrl:     string | null;
  status:       'ok' | 'failed';
}

async function runValidation(): Promise<void> {
const results: ValidationResult[] = [];

// Generate in batches of 5 to avoid rate limits
const BATCH = 5;
for (let b = 0; b < SAMPLE.length; b += BATCH) {
  const batch = SAMPLE.slice(b, b + BATCH);
  const batchResults = await Promise.all(
    batch.map(async (idiom, localIdx) => {
      const globalIdx = b + localIdx + 1;
      console.log(`  [${globalIdx}/${SAMPLE.length}] Generating: "${idiom.phrase}"...`);
      const url = await generateImage(idiom.visualPrompt);
      if (url) {
        console.log(`  [${globalIdx}/${SAMPLE.length}] ✓ ${url.slice(0, 70)}...`);
      } else {
        console.log(`  [${globalIdx}/${SAMPLE.length}] ✗ Failed`);
      }
      return {
        index:        globalIdx,
        phrase:       idiom.phrase,
        hint:         idiom.hint,
        difficulty:   idiom.difficulty,
        category:     idiom.category,
        visualPrompt: idiom.visualPrompt,
        imageUrl:     url,
        status:       url ? 'ok' as const : 'failed' as const,
      };
    }),
  );
  results.push(...batchResults);
  if (b + BATCH < SAMPLE.length) await new Promise(r => setTimeout(r, 1000));
}

// ── Write results JSON ────────────────────────────────────────────────────────

fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
console.log(`\n✓ Results saved to ${RESULTS_PATH}`);

// ── Write HTML gallery ────────────────────────────────────────────────────────

const DIFF_COLOR: Record<string, string> = {
  easy:   '#16a34a',
  medium: '#d97706',
  hard:   '#dc2626',
};

const cards = results.map(r => `
  <div class="card">
    <div class="card-header">
      <span class="idx">#${r.index}</span>
      <span class="diff" style="color:${DIFF_COLOR[r.difficulty] ?? '#666'}">${r.difficulty.toUpperCase()}</span>
      <span class="cat">${r.category}</span>
      <span class="status ${r.status === 'ok' ? 'ok' : 'fail'}">${r.status === 'ok' ? '✓' : '✗'}</span>
    </div>
    <div class="phrase">${r.phrase}</div>
    <div class="hint">${r.hint}</div>
    ${r.imageUrl
      ? `<img src="${r.imageUrl}" alt="${r.phrase}" loading="lazy" />`
      : `<div class="no-image">Image generation failed</div>`
    }
    <div class="prompt"><strong>Visual prompt:</strong> ${r.visualPrompt}</div>
  </div>
`).join('\n');

const ok    = results.filter(r => r.status === 'ok').length;
const fail  = results.filter(r => r.status === 'failed').length;
const catBadges = [...new Set(results.map(r => r.category))].join(', ');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Idiom Validation Gallery — Phase 3</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 1400px; margin: 0 auto; padding: 2rem; background: #f8fafc; color: #1e293b; }
  h1   { font-size: 1.5rem; margin-bottom: 0.25rem; }
  .meta { color: #64748b; font-size: 0.85rem; margin-bottom: 2rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 1.5rem; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
  .card-header { display: flex; gap: 0.5rem; align-items: center; padding: 0.75rem 1rem 0; font-size: 0.8rem; }
  .idx   { color: #94a3b8; font-weight: 600; }
  .diff  { font-weight: 700; }
  .cat   { background: #f1f5f9; padding: 2px 8px; border-radius: 12px; color: #475569; }
  .status.ok   { color: #16a34a; font-weight: 700; margin-left: auto; }
  .status.fail { color: #dc2626; font-weight: 700; margin-left: auto; }
  .phrase { font-size: 1.1rem; font-weight: 700; padding: 0.5rem 1rem 0.25rem; }
  .hint   { font-size: 0.8rem; color: #64748b; padding: 0 1rem 0.5rem; font-style: italic; }
  img { width: 100%; height: 220px; object-fit: cover; display: block; }
  .no-image { height: 220px; display: flex; align-items: center; justify-content: center; background: #fef2f2; color: #dc2626; font-weight: 600; }
  .prompt { font-size: 0.72rem; color: #64748b; padding: 0.75rem 1rem; border-top: 1px solid #f1f5f9; line-height: 1.4; }
  .summary { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem 1.5rem; margin-bottom: 2rem; }
  .summary h2 { font-size: 1rem; margin: 0 0 0.5rem; }
  .summary p  { margin: 0.25rem 0; font-size: 0.85rem; color: #475569; }
</style>
</head>
<body>
<h1>Idiom Validation Gallery — Phase 3</h1>
<p class="meta">Generated ${new Date().toLocaleString()} · 20 samples · fal.ai flux/schnell</p>

<div class="summary">
  <h2>Summary</h2>
  <p>Images generated: <strong>${ok}/${results.length}</strong> &nbsp;|&nbsp; Failed: <strong>${fail}</strong></p>
  <p>Categories covered: ${catBadges}</p>
  <p>Difficulty mix: ${results.filter(r => r.difficulty === 'easy').length} easy · ${results.filter(r => r.difficulty === 'medium').length} medium · ${results.filter(r => r.difficulty === 'hard').length} hard</p>
</div>

<div class="grid">
${cards}
</div>
</body>
</html>`;

fs.writeFileSync(GALLERY_PATH, html);
console.log(`✓ Gallery written to ${GALLERY_PATH}`);
console.log(`\nOpen in browser: file://${GALLERY_PATH.replace(/\\/g, '/')}`);
console.log(`\nStats: ${ok} images generated, ${fail} failed`);
} // end runValidation

runValidation().catch(err => { console.error(err); process.exit(1); });
