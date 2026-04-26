-- Migration 018: fa_v2_ai_usage — per-call AI inference cost tracking
--
-- Stores one row per LLM call made during a v2 cycle.
-- Queried by the ai-costs API and the Live Book cost panel.

CREATE TABLE IF NOT EXISTS fa_v2_ai_usage (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pilot_id      uuid        REFERENCES fa_v2_pilots(id),
  round_id      uuid        REFERENCES fa_rounds(id),
  market_id     uuid        REFERENCES fa_markets(id),
  agent_id      uuid        REFERENCES fa_agents(id),
  model_id      text        NOT NULL,
  role          text,
  domain        text,
  input_tokens  integer     NOT NULL DEFAULT 0,
  output_tokens integer     NOT NULL DEFAULT 0,
  cost_usd      numeric(12, 6) NOT NULL DEFAULT 0,
  latency_ms    integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fa_v2_ai_usage_pilot   ON fa_v2_ai_usage(pilot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fa_v2_ai_usage_model   ON fa_v2_ai_usage(model_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fa_v2_ai_usage_day     ON fa_v2_ai_usage(created_at DESC);
