/**
 * GET /api/benchmark/list-models
 * Diagnostic: queries each provider for available models + does a quick
 * single-shot vision test to confirm the image format is accepted.
 */
import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

const TEST_IMAGE = 'https://fal.media/files/koala/8_DuHQGpHWpLuR_Bz4TmN.png';
const TEST_PROMPT = 'Reply with JSON only: {"guess":"test","strategy":"checking availability"}';

export async function GET() {
  const results: Record<string, any> = {};

  // ── Anthropic: list models ──────────────────────────────────────────────
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const page = await client.models.list();
    results.anthropic_models = (page.data ?? []).map((m: any) => ({
      id: m.id, name: m.display_name ?? m.id, created_at: m.created_at
    }));
  } catch (e: any) {
    results.anthropic_models_error = e.message;
  }

  // ── Groq: list models ───────────────────────────────────────────────────
  try {
    const groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const list = await groqClient.models.list();
    // Filter to vision-capable models (context_window hint or id contains vision/llava/llama-4)
    results.groq_models = list.data
      .filter((m: any) => /vision|llava|llama-4|scout|maverick|pixtral/i.test(m.id))
      .map((m: any) => ({ id: m.id, owned_by: m.owned_by }));
    results.groq_all_models = list.data.map((m: any) => m.id);
  } catch (e: any) {
    results.groq_models_error = e.message;
  }

  // ── Google: list models ─────────────────────────────────────────────────
  try {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      { signal: AbortSignal.timeout(5_000) },
    );
    const data = await res.json();
    results.google_models = (data.models ?? [])
      .filter((m: any) => /gemini/i.test(m.name) && m.supportedGenerationMethods?.includes('generateContent'))
      .map((m: any) => ({ name: m.name, displayName: m.displayName, description: m.description?.slice(0, 60) }));
    if (data.error) results.google_models_error = data.error;
  } catch (e: any) {
    results.google_models_error = e.message;
  }

  // ── Quick vision test: Anthropic ────────────────────────────────────────
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    // Try the first model that looks like a claude-3 model
    const models: any[] = results.anthropic_models ?? [];
    const candidate = models.find((m: any) => /claude-3|claude-4/i.test(m.id))?.id ?? models[0]?.id;
    if (candidate) {
      const resp = await client.messages.create({
        model: candidate,
        max_tokens: 64,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'url', url: TEST_IMAGE } },
          { type: 'text', text: TEST_PROMPT },
        ]}],
      });
      results.anthropic_vision_test = {
        model: candidate,
        response: resp.content[0]?.type === 'text' ? resp.content[0].text.slice(0, 120) : 'no text'
      };
    }
  } catch (e: any) {
    results.anthropic_vision_test_error = e.message;
  }

  // ── Quick vision test: Groq ─────────────────────────────────────────────
  try {
    const groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const visionModels: any[] = results.groq_models ?? [];
    const candidate = visionModels[0]?.id;
    if (candidate) {
      const resp = await groqClient.chat.completions.create({
        model: candidate,
        max_tokens: 64,
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: TEST_IMAGE } } as any,
          { type: 'text', text: TEST_PROMPT } as any,
        ]}],
      });
      results.groq_vision_test = {
        model: candidate,
        response: resp.choices[0]?.message?.content?.slice(0, 120)
      };
    }
  } catch (e: any) {
    results.groq_vision_test_error = e.message;
  }

  // ── Quick vision test: Gemini (URL-based, no download) ──────────────────
  try {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    const geminiModels: any[] = results.google_models ?? [];
    const candidate = geminiModels.find((m: any) =>
      /gemini-2\.0-flash|gemini-1\.5-flash/i.test(m.name)
    )?.name?.replace('models/', '') ?? 'gemini-2.0-flash';

    const genAI = new GoogleGenerativeAI(apiKey ?? '');
    const model = genAI.getGenerativeModel({ model: candidate });
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [
        { text: TEST_PROMPT },
        { fileData: { mimeType: 'image/jpeg', fileUri: TEST_IMAGE } },
      ]}],
      generationConfig: { maxOutputTokens: 64 },
    });
    results.google_vision_test = {
      model: candidate,
      response: result.response.text().slice(0, 120)
    };
  } catch (e: any) {
    results.google_vision_test_error = e.message;
    // Try fallback with base64
    try {
      const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      const genAI = new GoogleGenerativeAI(apiKey ?? '');
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const imgRes = await fetch(TEST_IMAGE, { signal: AbortSignal.timeout(8_000) });
      const mimeType = imgRes.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
      const data = Buffer.from(await imgRes.arrayBuffer()).toString('base64');
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [
          { text: TEST_PROMPT },
          { inlineData: { mimeType, data } },
        ]}],
        generationConfig: { maxOutputTokens: 64 },
      });
      results.google_vision_test_base64 = { model: 'gemini-2.0-flash', response: result.response.text().slice(0, 120) };
    } catch (e2: any) {
      results.google_vision_test_base64_error = e2.message;
    }
  }

  return NextResponse.json(results, { status: 200 });
}
