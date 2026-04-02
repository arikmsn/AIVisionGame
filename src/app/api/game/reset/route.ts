import { NextRequest, NextResponse } from 'next/server';
import Pusher from 'pusher';

const pusherServer = new Pusher({
  appId: process.env.PUSHER_APP_ID || '',
  key: process.env.PUSHER_KEY || '',
  secret: process.env.PUSHER_SECRET || '',
  cluster: process.env.PUSHER_CLUSTER || 'eu',
  useTLS: true,
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { roomId, triggeredBy } = body;

    if (!roomId) {
      return NextResponse.json(
        { error: 'MISSING_ROOM', message: 'Room ID is required' },
        { status: 400 }
      );
    }

    if (!process.env.PUSHER_KEY || !process.env.PUSHER_SECRET) {
      return NextResponse.json(
        { error: 'PUSHER_NOT_CONFIGURED', message: 'Pusher not set up' },
        { status: 503 }
      );
    }

    const channelName = `presence-${roomId}`;
    await pusherServer.trigger(channelName, 'game-reset', {
      triggeredBy: triggeredBy || 'Unknown',
    });

    console.log('[RESET] ✅ game-reset broadcast sent to channel:', channelName);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[RESET] Error:', error);
    return NextResponse.json(
      { error: 'RESET_FAILED', message: error.message },
      { status: 500 }
    );
  }
}
