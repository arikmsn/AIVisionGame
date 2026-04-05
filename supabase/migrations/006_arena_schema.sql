-- Migration 006: Arena tables for tournament-based benchmark
-- Schema from Section 5.3 of AI_Vision_Arena_Spec_v2.md
--
-- All table names prefixed with arena_ to avoid collisions with existing tables.
-- This migration is additive — no existing tables are modified.

-- ── Tournaments ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS arena_tournaments (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at      timestamptz  NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  config_snapshot jsonb        NOT NULL DEFAULT '{}',
  status          text         NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'cancelled')),
  total_rounds    integer      NOT NULL DEFAULT 20
);

-- ── Rounds ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS arena_rounds (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   uuid         REFERENCES arena_tournaments(id) ON DELETE SET NULL,
  round_number    integer      NOT NULL DEFAULT 1,
  idiom_id        integer,
  idiom_phrase    text         NOT NULL,
  image_url       text         NOT NULL DEFAULT '',
  t_start         timestamptz,
  t_end           timestamptz,
  ground_truth    text         NOT NULL DEFAULT '',
  status          text         NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'warmup', 'active', 'scoring', 'completed'))
);

-- ── Round players (per-model participation) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS arena_round_players (
  id                  uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id            uuid     NOT NULL REFERENCES arena_rounds(id) ON DELETE CASCADE,
  model_id            text     NOT NULL,
  attempts_used       integer  NOT NULL DEFAULT 0,
  final_score         integer  NOT NULL DEFAULT 0,
  reasoning_text      text     NOT NULL DEFAULT '',
  rank_at_round_start integer,
  baseline_latency_ms integer,
  warmup_ok           boolean  NOT NULL DEFAULT false,
  UNIQUE(round_id, model_id)
);

-- ── Guesses ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS arena_guesses (
  id                          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                  timestamptz  NOT NULL DEFAULT now(),
  round_id                    uuid         NOT NULL REFERENCES arena_rounds(id) ON DELETE CASCADE,
  model_id                    text         NOT NULL,
  attempt_num                 integer      NOT NULL DEFAULT 1
    CHECK (attempt_num BETWEEN 1 AND 3),
  guess_text                  text         NOT NULL DEFAULT '',
  action                      text         NOT NULL DEFAULT 'guess'
    CHECK (action IN ('guess', 'wait')),
  confidence                  real,
  reasoning                   text         NOT NULL DEFAULT '',
  t_ms_from_start             integer      NOT NULL DEFAULT 0,
  is_correct                  boolean      NOT NULL DEFAULT false,
  points_awarded              integer      NOT NULL DEFAULT 0,
  visible_prior_guesses_count integer      NOT NULL DEFAULT 0,
  wave                        integer      NOT NULL DEFAULT 1
    CHECK (wave BETWEEN 1 AND 3)
);

-- ── Tournament standings snapshots (Phase 2 — created now for schema stability) ─

CREATE TABLE IF NOT EXISTS arena_tournament_standings (
  id              uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   uuid     NOT NULL REFERENCES arena_tournaments(id) ON DELETE CASCADE,
  round_number    integer  NOT NULL,
  model_id        text     NOT NULL,
  score           integer  NOT NULL DEFAULT 0,
  rank            integer  NOT NULL DEFAULT 0,
  rounds_won      integer  NOT NULL DEFAULT 0,
  accuracy_so_far real     NOT NULL DEFAULT 0,
  trend           text     NOT NULL DEFAULT 'stable',
  UNIQUE(tournament_id, round_number, model_id)
);

-- ── Round timeline (for replay UI) ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS arena_round_timeline (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id        uuid         NOT NULL REFERENCES arena_rounds(id) ON DELETE CASCADE,
  event_type      text         NOT NULL,
  event_data      jsonb        NOT NULL DEFAULT '{}',
  t_ms_from_start integer      NOT NULL DEFAULT 0
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_arena_tournaments_status
  ON arena_tournaments (status);

CREATE INDEX IF NOT EXISTS idx_arena_rounds_tournament
  ON arena_rounds (tournament_id);

CREATE INDEX IF NOT EXISTS idx_arena_rounds_status
  ON arena_rounds (status);

CREATE INDEX IF NOT EXISTS idx_arena_guesses_round
  ON arena_guesses (round_id);

CREATE INDEX IF NOT EXISTS idx_arena_guesses_model
  ON arena_guesses (model_id);

CREATE INDEX IF NOT EXISTS idx_arena_guesses_round_model
  ON arena_guesses (round_id, model_id);

CREATE INDEX IF NOT EXISTS idx_arena_round_players_round
  ON arena_round_players (round_id);

CREATE INDEX IF NOT EXISTS idx_arena_standings_tournament
  ON arena_tournament_standings (tournament_id);

CREATE INDEX IF NOT EXISTS idx_arena_standings_lookup
  ON arena_tournament_standings (tournament_id, round_number);

CREATE INDEX IF NOT EXISTS idx_arena_timeline_round
  ON arena_round_timeline (round_id);

CREATE INDEX IF NOT EXISTS idx_arena_timeline_round_type
  ON arena_round_timeline (round_id, event_type);

-- ── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE arena_tournaments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_rounds               ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_round_players        ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_guesses              ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_tournament_standings ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_round_timeline       ENABLE ROW LEVEL SECURITY;

-- ── Realtime publication for live guess broadcast ─────────────────────────────
-- Supabase Realtime listens to postgres changes on published tables.
-- Publishing arena_guesses enables live broadcast of guesses to connected clients.

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE arena_guesses;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE arena_round_timeline;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
