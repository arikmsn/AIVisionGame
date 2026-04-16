-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 009: Security hardening
--
-- Fixes two Supabase Security Advisor warnings:
--   • rls_disabled_in_public  — guesses + agent_performance had no RLS
--   • sensitive_columns_exposed — same tables exposed session_id / rationale
--                                 columns to the anon role
--
-- All server-side queries use SUPABASE_SERVICE_ROLE_KEY (bypasses RLS by
-- design). The anon key must never reach real data directly.
--
-- Apply to project: aciqrjgcnrxhmywlkkqb
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Enable RLS on tables that were missing it ──────────────────────────────

ALTER TABLE public.guesses            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_performance  ENABLE ROW LEVEL SECURITY;

-- ── 2. Revoke direct anon/authenticated SELECT on views ───────────────────────
-- Views run as security DEFINER (Postgres default) so they bypass the RLS on
-- their underlying tables.  Revoking SELECT from anon/authenticated closes that
-- gap.  service_role keeps full access via its BYPASSRLS privilege.

REVOKE SELECT ON public.v_model_career_stats   FROM anon, authenticated;
REVOKE SELECT ON public.v_late_game_aggression FROM anon, authenticated;
REVOKE SELECT ON public.v_run_cost_summary     FROM anon, authenticated;

-- ── 3. Verify final state (run separately as a sanity check) ──────────────────
-- SELECT tablename, rowsecurity
-- FROM   pg_tables
-- WHERE  schemaname = 'public'
-- ORDER  BY tablename;
--
-- SELECT schemaname, viewname, has_table_privilege('anon', schemaname||'.'||viewname, 'SELECT') AS anon_can_read
-- FROM   information_schema.views
-- WHERE  schemaname = 'public';
