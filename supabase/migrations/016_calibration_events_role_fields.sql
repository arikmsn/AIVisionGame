-- Migration 016: Add prompt_version + role to fa_calibration_events
--
-- Enables slicing Brier/log-loss by:
--   - prompt_version: 'v1' (balanced monoculture) vs 'v2' (role-based)
--   - role: 'base_rate' | 'news_synthesis' | 'devil_advocate' | etc.
--
-- Both columns default to 'v1' / NULL respectively so existing rows stay
-- valid. New rows populated from fa_submissions.metadata_json at resolve time.

ALTER TABLE fa_calibration_events
  ADD COLUMN IF NOT EXISTS prompt_version text NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS role           text;

CREATE INDEX IF NOT EXISTS idx_fa_calib_events_prompt_version
  ON fa_calibration_events(prompt_version);

CREATE INDEX IF NOT EXISTS idx_fa_calib_events_role
  ON fa_calibration_events(role);

-- Also add prompt_version + role to fa_model_calibration so rollups can be
-- split by version. The primary key already includes (agent_id, domain,
-- time_window); we add these as non-key columns here for aggregate queries.
-- Note: for split analysis, query fa_calibration_events directly and group
-- by (agent_id, domain, prompt_version, role) — fa_model_calibration is a
-- pre-aggregated cache keyed on the existing PK only.
-- No schema change needed on fa_model_calibration for now; the events table
-- is sufficient for the pre/post role comparison analysis.
