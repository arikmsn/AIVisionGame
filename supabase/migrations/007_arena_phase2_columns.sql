-- Migration 007: Phase 2 columns for arena_round_players
--
-- Adds:
--   context_sent_json — first-attempt JSON context payload sent to a model
--                       (for verification: round 10 context should have player_1..N,
--                        not model names)
--   player_id         — anonymised stable player ID for this tournament
--
-- NOTE: This migration must be applied against project aciqrjgcnrxhmywlkkqb.
-- The Supabase MCP in this workspace is linked to a different project.
-- Apply via Supabase dashboard SQL editor or supabase db push with correct project.

ALTER TABLE arena_round_players
  ADD COLUMN IF NOT EXISTS context_sent_json jsonb,
  ADD COLUMN IF NOT EXISTS player_id         text;

CREATE INDEX IF NOT EXISTS idx_arena_round_players_player_id
  ON arena_round_players (player_id);
