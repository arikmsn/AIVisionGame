/**
 * Static public room definitions.
 * These rooms are always discoverable via GET /api/game/rooms.
 */

export interface PublicRoom {
  id: string;
  name: string;
  description: string;
}

export const PUBLIC_ROOMS: PublicRoom[] = [
  { id: 'LOBBY_01',     name: 'Public Lobby',  description: 'Open to all — join anytime' },
  { id: 'ARENA_ALPHA',  name: 'Alpha Arena',   description: 'Competitive play' },
];
