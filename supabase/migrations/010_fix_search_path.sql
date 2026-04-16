-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 010: Fix mutable search_path on set_updated_at trigger function
--
-- Fixes Supabase Security Advisor warning:
--   • Function Search Path Mutable — public.set_updated_at
--
-- Adding SET search_path = public pins the function's schema resolution and
-- prevents search_path injection attacks.
--
-- Apply to project: aciqrjgcnrxhmywlkkqb
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
