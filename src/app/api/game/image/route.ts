import { NextRequest, NextResponse } from 'next/server';
import Pusher from 'pusher';
import { updateGameState, getGameState } from '@/lib/gameStore';

const FAL_KEY = process.env.FAL_KEY;
const TIMEOUT_MS = 30000;
const FETCH_TIMEOUT_MS = 10000;
const MAX_RETRIES = 3;

async function fetchWithRetry(url: string, options: RequestInit, attempt = 1): Promise<Response> {
  try {
    return await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err: any) {
    const isNetworkError = err?.cause?.code === 'EAI_AGAIN' || err?.code === 'EAI_AGAIN' || err?.message?.includes('EAI_AGAIN') || err?.message?.includes('fetch failed');
    if (isNetworkError && attempt < MAX_RETRIES) {
      console.warn(`[IMAGE] Network error on attempt ${attempt}, retrying in 1s...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      return fetchWithRetry(url, options, attempt + 1);
    }
    if (isNetworkError) {
      const networkErr: any = new Error('DNS Resolution failed');
      networkErr.code = 'NETWORK_ERROR';
      throw networkErr;
    }
    throw err;
  }
}

const pusherServer = new Pusher({
  appId: process.env.PUSHER_APP_ID || '',
  key: process.env.PUSHER_KEY || '',
  secret: process.env.PUSHER_SECRET || '',
  cluster: process.env.PUSHER_CLUSTER || 'eu',
  useTLS: true,
});
const POLL_INTERVAL_MS = 1000;

export async function GET() {
  console.log('[IMAGE] GET request received - API is reachable!');
  return new Response("API is reachable via GET! Image API ready.");
}

async function waitForFalResult(requestId: string): Promise<string> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < TIMEOUT_MS) {
    const statusRes = await fetchWithRetry(`https://queue.fal.run/fal-ai/fast-lightning-sdxl/requests/${requestId}/status`, {
      headers: {
        'Authorization': `Key ${FAL_KEY}`,
      },
    });
    
    if (!statusRes.ok) {
      throw new Error(`Status check failed: ${statusRes.status}`);
    }
    
    const statusData = await statusRes.json();
    console.log('[IMAGE] Fal.ai status:', statusData.status);
    
    if (statusData.status === 'COMPLETED') {
      const resultRes = await fetchWithRetry(`https://queue.fal.run/fal-ai/fast-lightning-sdxl/requests/${requestId}`, {
        headers: {
          'Authorization': `Key ${FAL_KEY}`,
        },
      });
      
      const result = await resultRes.json();
      
      if (!result.images?.length && !result.image?.url) {
        throw new Error('No images in Fal.ai response');
      }
      
      return result.images?.[0]?.url || result.image?.url;
    }
    
    if (statusData.status === 'FAILED') {
      throw new Error('Fal.ai image generation failed');
    }
    
    // IN_QUEUE or PROCESSING - wait and retry
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  
  throw new Error('Fal.ai request timed out after 30 seconds');
}

export async function POST(request: NextRequest) {
  console.log('!!! HELLO FROM SERVER !!!');
  try {
    console.log('═══════════════════════════════════════');
    console.log('[IMAGE] API HIT - /api/game/image');
    console.log(`[IMAGE] FAL_KEY: ${FAL_KEY ? 'EXISTS' : 'MISSING'}`);
    console.log('═══════════════════════════════════════');
    
    if (!FAL_KEY || FAL_KEY === 'your_fal_key_here') {
      console.error('[IMAGE] FAL_KEY missing');
      return NextResponse.json(
        { error: 'FAL_KEY_MISSING', message: 'Fal.ai API key not configured' },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { prompt, roomId, category, explanation } = body;

    if (!prompt) {
      return NextResponse.json(
        { error: 'MISSING_PROMPT', message: 'Prompt is required' },
        { status: 400 }
      );
    }
    
    console.log('[IMAGE] Explanation:', explanation);

    console.log('[IMAGE] Generating image for prompt:', prompt);

    // Submit to Fal.ai queue
    const submitRes = await fetchWithRetry('https://queue.fal.run/fal-ai/fast-lightning-sdxl', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${FAL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        image_size: { width: 512, height: 512 },
      }),
    });

    if (!submitRes.ok) {
      const errorText = await submitRes.text();
      console.error('[IMAGE] Fal.ai submit error:', submitRes.status, errorText);
      
      if (submitRes.status === 402 || errorText.includes('insufficient')) {
        return NextResponse.json(
          { error: 'INSUFFICIENT_FUNDS', message: 'Fal.ai account has insufficient credits' },
          { status: 402 }
        );
      }
      
      if (submitRes.status === 429) {
        return NextResponse.json(
          { error: 'RATE_LIMITED', message: 'Fal.ai rate limit exceeded' },
          { status: 429 }
        );
      }
      
      return NextResponse.json(
        { error: 'FAL_SUBMIT_ERROR', message: `Fal.ai error: ${submitRes.status}` },
        { status: submitRes.status }
      );
    }

    const submitData = await submitRes.json();
    console.log('[IMAGE] Fal.ai queue response:', submitData);
    
    // Get request ID
    const requestId = submitData.request_id || submitData.id;
    if (!requestId) {
      console.error('[IMAGE] No request_id in response:', submitData);
      return NextResponse.json(
        { error: 'NO_REQUEST_ID', message: 'Fal.ai did not return a request ID' },
        { status: 500 }
      );
    }
    
    console.log('[IMAGE] Waiting for Fal.ai result, request_id:', requestId);
    
    // Wait for result with polling
    const imageUrl = await waitForFalResult(requestId);
    
    console.log('[IMAGE] ✅ Generated image URL:', imageUrl);
    
    // UPDATE SERVER STATE FIRST - this is the source of truth
    if (roomId) {
      updateGameState(roomId, {
        phase: 'drawing' as any,
        imageUrl,
        secretPrompt: prompt,
        explanation: explanation || '',
        category: category || 'idiom',
        roundStartTime: Date.now(),
        countdownActive: false,
        countdownSeconds: 5,
        winner: null,
      });
      console.log('[IMAGE] ✅ Server state updated');
    }
    
    // Broadcast to all clients in the room via Pusher
    if (roomId && process.env.PUSHER_KEY && process.env.PUSHER_SECRET) {
      try {
        const channelName = `presence-${roomId}`;
        console.log('[IMAGE] Broadcasting via Pusher to channel:', channelName);
        await pusherServer.trigger(channelName, 'game-started', {
          imageUrl,
          prompt,
          category: category || 'unknown',
          roomId,
          explanation: explanation || '',
          roundStartTime: Date.now(),
        });
        console.log('[IMAGE] ✅ Pusher broadcast sent');
      } catch (pusherError: any) {
        console.error('[IMAGE] Pusher broadcast error:', pusherError.message);
      }
    } else {
      console.log('[IMAGE] Skipping Pusher - no keys or no roomId');
    }
    
    return NextResponse.json({
      success: true,
      imageUrl,
      requestId,
    });
  } catch (error: any) {
    console.error('[IMAGE] Error:', error);
    if (error.code === 'NETWORK_ERROR') {
      return NextResponse.json(
        { error: 'NETWORK_ERROR', details: 'DNS Resolution failed' },
        { status: 503 }
      );
    }
    return NextResponse.json(
      {
        error: 'IMAGE_GENERATION_FAILED',
        message: error.message || 'Failed to generate image'
      },
      { status: 500 }
    );
  }
}
