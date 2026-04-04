import { NextRequest, NextResponse } from 'next/server';
import Pusher from 'pusher';
import { extractBearerToken, resolveAgentKey } from '@/lib/agents/api-keys';

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID || '',
  key: process.env.PUSHER_KEY || '',
  secret: process.env.PUSHER_SECRET || '',
  cluster: process.env.PUSHER_CLUSTER || 'eu',
  useTLS: true,
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const params = new URLSearchParams(body);
    const socketId = params.get('socket_id');
    const channelName = params.get('channel_name');

    if (!socketId || !channelName) {
      return NextResponse.json(
        { error: 'Missing socket_id or channel_name' },
        { status: 400 }
      );
    }

    // External agents authenticate with a Bearer token.
    // When valid, use their stable agentId as the Pusher presence user_id
    // so they appear consistently in presence member lists.
    let userId = socketId;
    let userInfo: Record<string, string> = {};

    const token = extractBearerToken(req.headers.get('Authorization'));
    if (token) {
      const identity = resolveAgentKey(token);
      if (identity) {
        userId   = identity.agentId;
        userInfo = { agentName: identity.agentName };
        console.log(`[PUSHER_AUTH] External agent authenticated: ${identity.agentName} (${identity.agentId})`);
      }
    }

    // Presence channels require user_data in the auth response.
    // Without it, pusher:subscription_succeeded never fires and the client
    // receives no events.
    const presenceData = channelName.startsWith('presence-')
      ? { user_id: userId, user_info: userInfo }
      : undefined;

    const auth = pusher.authenticate(socketId, channelName, presenceData as any);
    return NextResponse.json(auth);
  } catch (error) {
    console.error('[PUSHER_AUTH] Error:', error);
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 500 }
    );
  }
}
