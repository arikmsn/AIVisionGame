-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 011: Daily keepalive cron job
--
-- Keeps the Supabase free-tier project active by running a trivial read-only
-- query once per day via pg_cron. The job is idempotent — cron.schedule()
-- replaces any existing job with the same name.
--
-- Prerequisites:
--   pg_cron extension must be enabled (pg_catalog schema).
--   Enable via: Database → Extensions → pg_cron (toggle on).
--
-- Apply to project: aciqrjgcnrxhmywlkkqb
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Schedule the job (idempotent — upserts by name)
SELECT cron.schedule(
  'daily-db-keepalive',          -- job name
  '0 3 * * *',                   -- every day at 03:00 UTC
  $$ SELECT 1 FROM public.arena_tournaments LIMIT 1; $$
);

-- 2. Verify (informational — comment out before running as pure migration)
-- SELECT jobid, jobname, schedule, command
-- FROM   cron.job
-- WHERE  jobname = 'daily-db-keepalive';
