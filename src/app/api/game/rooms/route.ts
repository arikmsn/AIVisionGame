import { NextResponse } from 'next/server';
import { PUBLIC_ROOMS } from '@/lib/rooms';
import { getFullGameState, getScoreboard } from '@/lib/gameStore';
import { AGENT_REGISTRY } from '@/lib/agents/config';

/**
 * GET /api/game/rooms
 *
 * Returns live status for all public arenas.
 * Used by the landing page and external agents for room discovery.
 */
export async function GET() {
  const agentNames = new Set(AGENT_REGISTRY.map(a => a.name));

  const rooms = PUBLIC_ROOMS.map((room) => {
    const state     = getFullGameState(room.id);
    const scoreboard = getScoreboard(room.id);
    const allPlayers = Object.keys(scoreboard);
    const humanPlayers = allPlayers.filter(n => !agentNames.has(n));
    const botPlayers   = allPlayers.filter(n => agentNames.has(n));

    return {
      id:             room.id,
      name:           room.name,
      description:    room.description,
      phase:          state.phase,
      roundId:        state.roundId || null,
      imageUrl:       state.imageUrl,
      participantCount: allPlayers.length,
      humanCount:     humanPlayers.length,
      botCount:       botPlayers.length,
      hasActiveBots:  botPlayers.length > 0,
    };
  });

  return NextResponse.json({ rooms });
}
