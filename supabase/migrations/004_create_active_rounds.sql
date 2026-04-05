-- Migration 004: active_rounds table
-- Persists the current round state for each room so that all Vercel
-- serverless instances can read it even if they didn't handle start-round.
--
-- Run: supabase db push  (or paste into the Supabase SQL editor)

CREATE TABLE IF NOT EXISTS active_rounds (
  room_id          text         PRIMARY KEY,
  round_id         text         NOT NULL,
  phase            text         NOT NULL DEFAULT 'idle',
  image_url        text,
  round_start_time bigint,
  updated_at       timestamptz  DEFAULT now()
);

-- Enable Row Level Security (no public reads — service role only)
ALTER TABLE active_rounds ENABLE ROW LEVEL SECURITY;
