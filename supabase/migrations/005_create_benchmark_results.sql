-- Migration 005: benchmark_results table
-- Persists every probe result from /api/benchmark/probe so we can track
-- per-model accuracy, latency, reliability, and per-idiom difficulty over time.
--
-- Run: supabase db push  (or paste into the Supabase SQL editor)

CREATE TABLE IF NOT EXISTS benchmark_results (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz  NOT NULL DEFAULT now(),
  idiom_phrase  text         NOT NULL,
  model_id      text         NOT NULL,
  guess         text         NOT NULL DEFAULT '',
  is_correct    boolean      NOT NULL DEFAULT false,
  latency_ms    integer,
  strategy      text         NOT NULL DEFAULT '',
  image_url     text         NOT NULL DEFAULT '',
  error         text         -- null = clean run; 'key_missing' or message = failed
);

-- Indexes for the analytics queries in /api/benchmark/stats
CREATE INDEX IF NOT EXISTS idx_benchmark_results_model_id
  ON benchmark_results (model_id);

CREATE INDEX IF NOT EXISTS idx_benchmark_results_idiom_phrase
  ON benchmark_results (idiom_phrase);

CREATE INDEX IF NOT EXISTS idx_benchmark_results_created_at
  ON benchmark_results (created_at DESC);

-- Enable Row Level Security (service-role only, same pattern as other tables)
ALTER TABLE benchmark_results ENABLE ROW LEVEL SECURITY;
