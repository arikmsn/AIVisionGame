import { NextRequest, NextResponse } from 'next/server';
import Pusher from 'pusher';
import { updateGameState, addGuess } from '@/lib/gameStore';

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID || '',
  key: process.env.PUSHER_KEY || '',
  secret: process.env.PUSHER_SECRET || '',
  cluster: process.env.PUSHER_CLUSTER || 'eu',
  useTLS: true,
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { roomId, action, data } = body;

    if (!roomId || !action) {
      return NextResponse.json(
        { error: 'MISSING_PARAMS', message: 'roomId and action are required' },
        { status: 400 }
      );
    }

    console.log('[SYNC] Received:', { roomId, action, data });

    // Only the server (start-round, validate) may write phase to the store.
    // Clients use the sync route purely as a Pusher relay for UI-only events.
    switch (action) {
      case 'on-guess':
        addGuess(roomId, data);
        break;
      case 'on-image-update':
        // imageUrl writes still allowed (legacy path — start-round owns this now)
        updateGameState(roomId, { imageUrl: data.imageUrl });
        break;
      // 'on-phase-change' intentionally removed: clients NEVER write phase
    }

    if (process.env.PUSHER_KEY && process.env.PUSHER_SECRET) {
      const channel = `presence-${roomId}`;
      await pusher.trigger(channel, action, data);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[SYNC] Error:', error);
    return NextResponse.json(
      { error: 'SYNC_FAILED', message: error.message || 'Failed to sync' },
      { status: 500 }
    );
  }
}
