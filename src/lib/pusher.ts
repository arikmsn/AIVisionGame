import Pusher from 'pusher-js';

let pusherInstance: Pusher | null = null;
let pollingInterval: NodeJS.Timeout | null = null;
let currentRoomId: string | null = null;
let onStateUpdate: ((data: any) => void) | null = null;

export function getPusherConfig() {
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || 'eu';
  
  if (!key || key === 'your_key_here') {
    return null;
  }
  
  return { key, cluster };
}

export function initPusher(
  roomId: string,
  onUpdate: (data: any) => void,
  onStatusChange: (status: string) => void
): Pusher | null {
  console.log('[GAME-ENGINE] Initializing Pusher for room:', roomId);
  
  currentRoomId = roomId;
  onStateUpdate = onUpdate;
  
  const config = getPusherConfig();
  
  if (!config) {
    console.warn('[GAME-ENGINE] No Pusher config - using polling fallback');
    onStatusChange('polling');
    startPollingFallback(roomId, onUpdate);
    return null;
  }
  
  try {
    pusherInstance = new Pusher(config.key, {
      cluster: config.cluster,
      forceTLS: true,
    });
    
    pusherInstance.connection.bind('connecting', () => {
      console.log('[GAME-ENGINE] Pusher: connecting...');
      onStatusChange('connecting');
    });
    
    pusherInstance.connection.bind('connected', () => {
      console.log('[GAME-ENGINE] Pusher: CONNECTED!');
      onStatusChange('connected');
      stopPollingFallback();
    });
    
    pusherInstance.connection.bind('failed', (err: any) => {
      console.error('[GAME-ENGINE] Pusher: FAILED', err);
      onStatusChange('failed');
      startPollingFallback(roomId, onUpdate);
    });
    
    pusherInstance.connection.bind('disconnected', () => {
      console.log('[GAME-ENGINE] Pusher: disconnected');
      onStatusChange('disconnected');
      startPollingFallback(roomId, onUpdate);
    });
    
    const channelName = `room-${roomId}`;
    console.log('[GAME-ENGINE] Subscribing to channel:', channelName);
    
    const channel = pusherInstance.subscribe(channelName);
    
    channel.bind('on-guess', (data: any) => {
      console.log('[GAME-ENGINE] Received guess:', data);
      onUpdate({ type: 'guess', data });
    });
    
    channel.bind('on-image-update', (data: any) => {
      console.log('[GAME-ENGINE] Received image update:', data);
      onUpdate({ type: 'image', data });
    });
    
    channel.bind('on-phase-change', (data: any) => {
      console.log('[GAME-ENGINE] Received phase change:', data);
      onUpdate({ type: 'phase', data });
    });
    
    return pusherInstance;
  } catch (error) {
    console.error('[GAME-ENGINE] Pusher init error:', error);
    onStatusChange('failed');
    startPollingFallback(roomId, onUpdate);
    return null;
  }
}

function startPollingFallback(roomId: string, onUpdate: (data: any) => void) {
  if (pollingInterval) return;
  
  console.log('[GAME-ENGINE] Starting polling fallback for room:', roomId);
  
  pollingInterval = setInterval(async () => {
    try {
      const response = await fetch(`/api/game/state?roomId=${roomId}`);
      if (response.ok) {
        const state = await response.json();
        console.log('[GAME-ENGINE] Polling fetched state:', state);
        onUpdate({ type: 'full-state', data: state });
      }
    } catch (error) {
      console.error('[GAME-ENGINE] Polling error:', error);
    }
  }, 2000);
}

function stopPollingFallback() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    console.log('[GAME-ENGINE] Stopped polling fallback');
  }
}

export function disconnectPusher() {
  stopPollingFallback();
  if (pusherInstance) {
    pusherInstance.disconnect();
    pusherInstance = null;
  }
  currentRoomId = null;
  onStateUpdate = null;
}

export function broadcastAction(roomId: string, action: string, data: any) {
  console.log('[GAME-ENGINE] Broadcasting action:', action, data);
  
  fetch('/api/game/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId, action, data }),
  }).catch(err => console.error('[GAME-ENGINE] Broadcast error:', err));
}
