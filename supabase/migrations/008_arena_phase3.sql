-- Migration 008: Phase 3 — cost monitoring, behavioural metrics, run orchestration
--
-- Apply to project: aciqrjgcnrxhmywlkkqb (Vercel project DB)
-- Apply via: Supabase Dashboard → SQL Editor
--
-- This is additive. No existing data is modified.

-- ── 1. Phase 3 columns on arena_round_players ─────────────────────────────────

ALTER TABLE arena_round_players
  ADD COLUMN IF NOT EXISTS dnf                     boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS first_attempt_action    text     CHECK (first_attempt_action IN ('guess', 'wait')),
  ADD COLUMN IF NOT EXISTS mentions_standing       boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS standing_action_rational boolean,              -- null = undetermined
  ADD COLUMN IF NOT EXISTS api_cost_usd            real     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS input_tokens_total      integer  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_tokens_total     integer  NOT NULL DEFAULT 0;

-- ── 2. Run tracking + budget on arena_tournaments ─────────────────────────────

ALTER TABLE arena_tournaments
  ADD COLUMN IF NOT EXISTS run_id               text,
  ADD COLUMN IF NOT EXISTS budget_cap_usd       real     NOT NULL DEFAULT 5.00,
  ADD COLUMN IF NOT EXISTS accumulated_cost_usd real     NOT NULL DEFAULT 0.00;

CREATE INDEX IF NOT EXISTS idx_arena_tournaments_run_id
  ON arena_tournaments (run_id)
  WHERE run_id IS NOT NULL;

-- ── 3. arena_cost_log — raw API call cost data ────────────────────────────────

CREATE TABLE IF NOT EXISTS arena_cost_log (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz  NOT NULL DEFAULT now(),
  round_id      uuid         NOT NULL REFERENCES arena_rounds(id) ON DELETE CASCADE,
  model_id      text         NOT NULL,
  attempt_num   integer      NOT NULL DEFAULT 1,
  input_tokens  integer      NOT NULL DEFAULT 0,
  output_tokens integer      NOT NULL DEFAULT 0,
  cost_usd      real         NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_arena_cost_log_round ON arena_cost_log (round_id);
CREATE INDEX IF NOT EXISTS idx_arena_cost_log_model ON arena_cost_log (model_id);

ALTER TABLE arena_cost_log ENABLE ROW LEVEL SECURITY;

-- ── 4. Phase 3 dashboard views ────────────────────────────────────────────────

-- v_model_career_stats: per-model aggregate across all tournaments
CREATE OR REPLACE VIEW v_model_career_stats AS
SELECT
  arp.model_id,
  COUNT(DISTINCT ar.tournament_id)                                                              AS tournaments_played,
  COUNT(*)                                                                                      AS total_rounds,
  ROUND(AVG(arp.final_score)::numeric, 1)                                                       AS avg_round_score,
  ROUND(SUM(arp.final_score)::numeric, 0)                                                       AS total_score,
  ROUND((SUM(CASE WHEN arp.final_score > 0 THEN 1 ELSE 0 END)::real
    / NULLIF(COUNT(*), 0) * 100)::numeric, 1)                                                   AS correct_pct,
  ROUND((SUM(CASE WHEN arp.dnf THEN 1 ELSE 0 END)::real
    / NULLIF(COUNT(*), 0) * 100)::numeric, 1)                                                   AS dnf_pct,
  ROUND(SUM(arp.api_cost_usd)::numeric, 4)                                                      AS total_cost_usd,
  ROUND((SUM(arp.final_score)::real
    / NULLIF(SUM(arp.api_cost_usd), 0))::numeric, 1)                                            AS score_per_dollar,
  ROUND((SUM(CASE WHEN arp.mentions_standing THEN 1 ELSE 0 END)::real
    / NULLIF(COUNT(CASE WHEN ar.tournament_id IS NOT NULL THEN 1 END), 0) * 100)::numeric, 1)   AS standing_perception_pct,
  ROUND((SUM(CASE WHEN arp.standing_action_rational = true THEN 1 ELSE 0 END)::real
    / NULLIF(SUM(CASE WHEN arp.standing_action_rational IS NOT NULL THEN 1 ELSE 0 END), 0)
    * 100)::numeric, 1)                                                                         AS rationality_pct
FROM arena_round_players arp
JOIN arena_rounds ar ON ar.id = arp.round_id
GROUP BY arp.model_id;

-- v_late_game_aggression: first-attempt guess rate by standing × game phase
CREATE OR REPLACE VIEW v_late_game_aggression AS
SELECT
  arp.model_id,
  CASE WHEN COALESCE(ats.rank, 6) >= 9 THEN 'bottom3' ELSE 'top8' END        AS standing_segment,
  ar.round_number >= 16                                                        AS is_late_game,
  COUNT(*)                                                                     AS n_rounds,
  ROUND(
    (SUM(CASE WHEN arp.first_attempt_action = 'guess' THEN 1 ELSE 0 END)::real
      / NULLIF(COUNT(*), 0) * 100)::numeric, 1
  )                                                                            AS first_attempt_guess_pct
FROM arena_round_players arp
JOIN arena_rounds ar ON ar.id = arp.round_id
LEFT JOIN arena_tournament_standings ats
  ON  ats.tournament_id = ar.tournament_id
  AND ats.round_number  = ar.round_number - 1
  AND ats.model_id      = arp.model_id
WHERE ar.tournament_id IS NOT NULL
  AND arp.first_attempt_action IS NOT NULL
GROUP BY arp.model_id, standing_segment, is_late_game;

-- v_run_cost_summary: total cost per run for budget monitoring
CREATE OR REPLACE VIEW v_run_cost_summary AS
SELECT
  run_id,
  COUNT(*)                         AS tournaments_in_run,
  SUM(accumulated_cost_usd)        AS run_total_cost_usd,
  MIN(started_at)                  AS run_started_at,
  MAX(COALESCE(ended_at, now()))   AS run_last_activity,
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
  SUM(CASE WHEN status = 'running'   THEN 1 ELSE 0 END) AS running,
  SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
FROM arena_tournaments
WHERE run_id IS NOT NULL
GROUP BY run_id;
