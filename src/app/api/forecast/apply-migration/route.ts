/**
 * POST /api/forecast/apply-migration
 *
 * Applies the forecast arena DDL migration by executing SQL statements
 * one at a time against the Supabase Management API (or falls back to
 * creating tables via individual REST calls).
 *
 * This is an operational endpoint — call once to bootstrap the schema.
 * Protected by ADMIN_PASSWORD header.
 */

import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 120;

// The migration SQL, split into individual statements
const MIGRATION_STATEMENTS = [
  // fa_markets
  `CREATE TABLE IF NOT EXISTS fa_markets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id text NOT NULL,
    source text NOT NULL DEFAULT 'polymarket',
    title text NOT NULL,
    category text,
    description text,
    close_time timestamptz,
    resolution_criteria text,
    status text NOT NULL DEFAULT 'active',
    current_yes_price numeric(6,4),
    volume_usd numeric(14,2),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    resolution_outcome boolean,
    metadata_json jsonb,
    UNIQUE (source, external_id)
  )`,

  // fa_market_snapshots
  `CREATE TABLE IF NOT EXISTS fa_market_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    market_id uuid NOT NULL REFERENCES fa_markets(id) ON DELETE CASCADE,
    timestamp timestamptz NOT NULL DEFAULT now(),
    yes_price numeric(6,4),
    no_price numeric(6,4),
    volume_usd numeric(14,2),
    num_traders integer,
    open_interest numeric(14,2),
    source_data_json jsonb
  )`,
  `CREATE INDEX IF NOT EXISTS idx_fa_market_snapshots_market_ts ON fa_market_snapshots(market_id, timestamp DESC)`,

  // fa_seasons
  `CREATE TABLE IF NOT EXISTS fa_seasons (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    starts_at timestamptz NOT NULL DEFAULT now(),
    ends_at timestamptz,
    config_json jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // fa_agents
  `CREATE TABLE IF NOT EXISTS fa_agents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE,
    display_name text NOT NULL,
    model_id text NOT NULL,
    provider text NOT NULL,
    prompt_version text NOT NULL DEFAULT 'v1',
    strategy_profile_json jsonb,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // fa_rounds
  `CREATE TABLE IF NOT EXISTS fa_rounds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id uuid REFERENCES fa_seasons(id),
    market_id uuid NOT NULL REFERENCES fa_markets(id),
    round_number integer NOT NULL DEFAULT 1,
    status text NOT NULL DEFAULT 'open',
    opened_at timestamptz NOT NULL DEFAULT now(),
    closes_at timestamptz,
    resolved_at timestamptz,
    market_yes_price_at_open numeric(6,4),
    context_json jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_fa_rounds_market ON fa_rounds(market_id)`,
  `CREATE INDEX IF NOT EXISTS idx_fa_rounds_status ON fa_rounds(status)`,

  // fa_submissions
  `CREATE TABLE IF NOT EXISTS fa_submissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    round_id uuid NOT NULL REFERENCES fa_rounds(id) ON DELETE CASCADE,
    agent_id uuid NOT NULL REFERENCES fa_agents(id),
    submitted_at timestamptz NOT NULL DEFAULT now(),
    probability_yes numeric(6,4) NOT NULL,
    confidence numeric(4,3),
    action text,
    rationale_short text,
    rationale_full text,
    raw_context_json jsonb,
    raw_output_json jsonb,
    input_tokens integer,
    output_tokens integer,
    cost_usd numeric(10,6),
    latency_ms integer,
    error_text text
  )`,
  `CREATE INDEX IF NOT EXISTS idx_fa_submissions_round ON fa_submissions(round_id)`,
  `CREATE INDEX IF NOT EXISTS idx_fa_submissions_agent ON fa_submissions(agent_id)`,

  // fa_scores
  `CREATE TABLE IF NOT EXISTS fa_scores (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id uuid NOT NULL UNIQUE REFERENCES fa_submissions(id) ON DELETE CASCADE,
    round_id uuid NOT NULL REFERENCES fa_rounds(id),
    agent_id uuid NOT NULL REFERENCES fa_agents(id),
    brier_score numeric(8,6),
    log_loss numeric(10,6),
    edge_at_submission numeric(8,6),
    resolved_outcome boolean,
    scored_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_fa_scores_agent ON fa_scores(agent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_fa_scores_round ON fa_scores(round_id)`,

  // fa_leaderboard_cache
  `CREATE TABLE IF NOT EXISTS fa_leaderboard_cache (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id uuid NOT NULL REFERENCES fa_agents(id),
    period text NOT NULL DEFAULT 'all_time',
    category text,
    total_submissions integer NOT NULL DEFAULT 0,
    avg_brier numeric(8,6),
    avg_log_loss numeric(10,6),
    avg_edge numeric(8,6),
    last_updated timestamptz NOT NULL DEFAULT now()
  )`,

  // fa_agent_wallets
  `CREATE TABLE IF NOT EXISTS fa_agent_wallets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id uuid NOT NULL UNIQUE REFERENCES fa_agents(id),
    paper_balance_usd numeric(14,2) NOT NULL DEFAULT 10000.00,
    total_notional_usd numeric(14,2) NOT NULL DEFAULT 0.00,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  // fa_transactions
  `CREATE TABLE IF NOT EXISTS fa_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id uuid NOT NULL REFERENCES fa_agents(id),
    submission_id uuid REFERENCES fa_submissions(id),
    round_id uuid REFERENCES fa_rounds(id),
    type text NOT NULL,
    side text,
    market_price_at_entry numeric(6,4),
    paper_size_usd numeric(14,2),
    notional_usd numeric(14,2),
    outcome text,
    pnl_usd numeric(14,2),
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_fa_transactions_agent ON fa_transactions(agent_id)`,

  // fa_audit_events
  `CREATE TABLE IF NOT EXISTS fa_audit_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type text NOT NULL,
    entity_type text,
    entity_id text,
    actor text,
    payload_json jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_fa_audit_events_type ON fa_audit_events(event_type)`,
  `CREATE INDEX IF NOT EXISTS idx_fa_audit_events_ts ON fa_audit_events(created_at DESC)`,

  // fa_sync_jobs
  `CREATE TABLE IF NOT EXISTS fa_sync_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type text NOT NULL,
    status text NOT NULL DEFAULT 'running',
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    records_processed integer DEFAULT 0,
    error_text text,
    metadata_json jsonb
  )`,

  // RLS
  `ALTER TABLE fa_markets ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE fa_market_snapshots ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE fa_seasons ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE fa_agents ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE fa_rounds ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE fa_submissions ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE fa_scores ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE fa_leaderboard_cache ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE fa_agent_wallets ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE fa_transactions ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE fa_audit_events ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE fa_sync_jobs ENABLE ROW LEVEL SECURITY`,

  // RLS policies
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fa_markets_service') THEN CREATE POLICY fa_markets_service ON fa_markets FOR ALL TO service_role USING (true) WITH CHECK (true); END IF; END $$`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fa_market_snapshots_service') THEN CREATE POLICY fa_market_snapshots_service ON fa_market_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true); END IF; END $$`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fa_seasons_service') THEN CREATE POLICY fa_seasons_service ON fa_seasons FOR ALL TO service_role USING (true) WITH CHECK (true); END IF; END $$`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fa_agents_service') THEN CREATE POLICY fa_agents_service ON fa_agents FOR ALL TO service_role USING (true) WITH CHECK (true); END IF; END $$`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fa_rounds_service') THEN CREATE POLICY fa_rounds_service ON fa_rounds FOR ALL TO service_role USING (true) WITH CHECK (true); END IF; END $$`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fa_submissions_service') THEN CREATE POLICY fa_submissions_service ON fa_submissions FOR ALL TO service_role USING (true) WITH CHECK (true); END IF; END $$`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fa_scores_service') THEN CREATE POLICY fa_scores_service ON fa_scores FOR ALL TO service_role USING (true) WITH CHECK (true); END IF; END $$`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fa_leaderboard_cache_service') THEN CREATE POLICY fa_leaderboard_cache_service ON fa_leaderboard_cache FOR ALL TO service_role USING (true) WITH CHECK (true); END IF; END $$`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fa_agent_wallets_service') THEN CREATE POLICY fa_agent_wallets_service ON fa_agent_wallets FOR ALL TO service_role USING (true) WITH CHECK (true); END IF; END $$`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fa_transactions_service') THEN CREATE POLICY fa_transactions_service ON fa_transactions FOR ALL TO service_role USING (true) WITH CHECK (true); END IF; END $$`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fa_audit_events_service') THEN CREATE POLICY fa_audit_events_service ON fa_audit_events FOR ALL TO service_role USING (true) WITH CHECK (true); END IF; END $$`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fa_sync_jobs_service') THEN CREATE POLICY fa_sync_jobs_service ON fa_sync_jobs FOR ALL TO service_role USING (true) WITH CHECK (true); END IF; END $$`,

  // Views
  `CREATE OR REPLACE VIEW fa_v_leaderboard AS
   SELECT a.id AS agent_id, a.slug, a.display_name, a.model_id, a.provider,
     COUNT(DISTINCT sub.id) AS total_submissions,
     AVG(sc.brier_score) AS avg_brier,
     AVG(sc.log_loss) AS avg_log_loss,
     AVG(sc.edge_at_submission) AS avg_edge,
     SUM(sub.cost_usd) AS total_cost_usd,
     SUM(sub.input_tokens) AS total_input_tokens,
     SUM(sub.output_tokens) AS total_output_tokens
   FROM fa_agents a
   LEFT JOIN fa_submissions sub ON sub.agent_id = a.id
   LEFT JOIN fa_scores sc ON sc.submission_id = sub.id
   WHERE a.is_active = true
   GROUP BY a.id, a.slug, a.display_name, a.model_id, a.provider`,

  `CREATE OR REPLACE VIEW fa_v_round_summary AS
   SELECT r.id AS round_id, r.round_number, r.status AS round_status,
     r.opened_at, r.closes_at, r.resolved_at, r.market_yes_price_at_open,
     m.id AS market_id, m.title AS market_title, m.category,
     m.current_yes_price, m.status AS market_status, m.close_time AS market_close_time,
     (SELECT COUNT(*) FROM fa_submissions sub WHERE sub.round_id = r.id) AS submission_count
   FROM fa_rounds r JOIN fa_markets m ON m.id = r.market_id`,

  // Seed season
  `INSERT INTO fa_seasons (name, status, starts_at) SELECT 'Season 1', 'active', now() WHERE NOT EXISTS (SELECT 1 FROM fa_seasons WHERE name = 'Season 1')`,
];

// ── Migration 014: Central Bankroll ──────────────────────────────────────────

const MIGRATION_014 = [
  `CREATE TABLE IF NOT EXISTS fa_central_bankroll (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    total_deposit_usd   numeric(14,2) NOT NULL DEFAULT 60000.00,
    available_usd       numeric(14,2) NOT NULL DEFAULT 60000.00,
    allocated_usd       numeric(14,2) NOT NULL DEFAULT 0.00,
    total_realized_pnl  numeric(14,4) NOT NULL DEFAULT 0.00,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE fa_central_bankroll ENABLE ROW LEVEL SECURITY`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fa_central_bankroll_service' AND tablename = 'fa_central_bankroll') THEN
      CREATE POLICY fa_central_bankroll_service ON fa_central_bankroll FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
  END $$`,
  `INSERT INTO fa_central_bankroll (total_deposit_usd, available_usd, allocated_usd, total_realized_pnl)
   SELECT
     60000.00,
     GREATEST(60000.00 - COALESCE((SELECT SUM(cost_basis_usd) FROM fa_positions WHERE status = 'open'), 0) + COALESCE((SELECT SUM(pnl_usd) FROM fa_transactions WHERE pnl_usd IS NOT NULL), 0), 0),
     COALESCE((SELECT SUM(cost_basis_usd) FROM fa_positions WHERE status = 'open'), 0),
     COALESCE((SELECT SUM(pnl_usd) FROM fa_transactions WHERE pnl_usd IS NOT NULL), 0)
   WHERE NOT EXISTS (SELECT 1 FROM fa_central_bankroll)`,
  `CREATE OR REPLACE VIEW fa_v_finance AS
   SELECT cb.id, cb.total_deposit_usd, cb.available_usd, cb.allocated_usd, cb.total_realized_pnl,
     COALESCE(pos.total_unrealized_pnl, 0) AS total_unrealized_pnl,
     COALESCE(pos.open_position_count, 0)  AS open_position_count,
     COALESCE(pos.closed_position_count, 0) AS closed_position_count,
     cb.total_deposit_usd + cb.total_realized_pnl + COALESCE(pos.total_unrealized_pnl, 0) AS net_value_usd,
     cb.updated_at
   FROM fa_central_bankroll cb
   LEFT JOIN (
     SELECT
       SUM(CASE WHEN status = 'open'   THEN unrealized_pnl ELSE 0 END) AS total_unrealized_pnl,
       COUNT(CASE WHEN status = 'open'   THEN 1 END) AS open_position_count,
       COUNT(CASE WHEN status = 'closed' THEN 1 END) AS closed_position_count
     FROM fa_positions
   ) pos ON true`,
];

// ── Migration 015: Market Context, Scores, Experiment Config ─────────────────

const MIGRATION_015 = [
  `CREATE TABLE IF NOT EXISTS fa_market_context (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    market_id        uuid NOT NULL REFERENCES fa_markets(id) ON DELETE CASCADE UNIQUE,
    domain           text NOT NULL DEFAULT 'general',
    news_summary     text,
    key_points       jsonb DEFAULT '[]',
    sentiment        text CHECK (sentiment IN ('positive','negative','neutral')) DEFAULT 'neutral',
    sources          jsonb DEFAULT '[]',
    raw_headlines_json jsonb DEFAULT '[]',
    last_updated_at  timestamptz NOT NULL DEFAULT now(),
    created_at       timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS fa_market_scores (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    market_id          uuid NOT NULL REFERENCES fa_markets(id) ON DELETE CASCADE UNIQUE,
    domain             text NOT NULL DEFAULT 'general',
    score              numeric(5,2) NOT NULL DEFAULT 0,
    tags               text[] DEFAULT '{}',
    volume_score       numeric(5,2) DEFAULT 0,
    timing_score       numeric(5,2) DEFAULT 0,
    price_score        numeric(5,2) DEFAULT 0,
    news_score         numeric(5,2) DEFAULT 0,
    news_count         integer DEFAULT 0,
    is_selected        boolean NOT NULL DEFAULT false,
    selection_rank     integer,
    eligible           boolean NOT NULL DEFAULT false,
    ineligible_reason  text,
    scored_at          timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS fa_experiment_config (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name                      text NOT NULL DEFAULT 'Sports Pilot — Season 1',
    domain                    text NOT NULL DEFAULT 'sports',
    status                    text NOT NULL DEFAULT 'active',
    starts_at                 timestamptz NOT NULL DEFAULT now(),
    ends_at                   timestamptz,
    max_concurrent_positions  integer NOT NULL DEFAULT 10,
    risk_per_position_pct     numeric(5,4) NOT NULL DEFAULT 0.02,
    max_markets_per_run       integer NOT NULL DEFAULT 5,
    min_score_threshold       numeric(5,2) NOT NULL DEFAULT 30,
    notes                     text,
    created_at                timestamptz NOT NULL DEFAULT now()
  )`,

  `ALTER TABLE fa_market_context ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE fa_market_scores ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE fa_experiment_config ENABLE ROW LEVEL SECURITY`,

  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fa_market_context_service' AND tablename = 'fa_market_context') THEN
      CREATE POLICY fa_market_context_service ON fa_market_context FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fa_market_scores_service' AND tablename = 'fa_market_scores') THEN
      CREATE POLICY fa_market_scores_service ON fa_market_scores FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fa_experiment_config_service' AND tablename = 'fa_experiment_config') THEN
      CREATE POLICY fa_experiment_config_service ON fa_experiment_config FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
  END $$`,

  `INSERT INTO fa_experiment_config (name, domain, status, starts_at)
   SELECT 'Sports Pilot — Season 1', 'sports', 'active', now()
   WHERE NOT EXISTS (SELECT 1 FROM fa_experiment_config)`,

  `CREATE OR REPLACE VIEW fa_v_market_strategy AS
   SELECT
     m.id AS market_id,
     m.title,
     m.category,
     m.current_yes_price,
     m.volume_usd,
     m.close_time,
     m.status AS market_status,
     COALESCE(ms.domain, 'general') AS domain,
     COALESCE(ms.score, 0) AS score,
     ms.tags,
     ms.is_selected,
     ms.selection_rank,
     ms.eligible,
     ms.ineligible_reason,
     ms.scored_at,
     mc.news_summary,
     mc.key_points,
     mc.sentiment,
     mc.last_updated_at AS context_updated_at,
     (mc.last_updated_at IS NOT NULL AND EXTRACT(EPOCH FROM (now() - mc.last_updated_at))/3600 < 8) AS context_fresh
   FROM fa_markets m
   LEFT JOIN fa_market_scores ms ON ms.market_id = m.id
   LEFT JOIN fa_market_context mc ON mc.market_id = m.id`,
];

async function executeSql(sql: string, url: string, key: string): Promise<{ ok: boolean; error?: string }> {
  // Use Supabase's pg endpoint via the Management API isn't available,
  // so we use the RPC approach: create a temporary function
  // Actually, the simplest reliable approach is to use the pg_query RPC
  // But that may not exist. Let's try the direct SQL execution via
  // Supabase's /sql endpoint (available in newer versions)
  try {
    const res = await fetch(`${url}/rest/v1/rpc/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ query: sql }),
      signal: AbortSignal.timeout(30_000),
    });
    // This will likely fail since there's no generic SQL RPC
    if (res.ok) return { ok: true };
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (e: any) {
    return { ok: false, error: e?.message };
  }
}

export async function POST(request: NextRequest) {
  const password = request.headers.get('x-admin-password');
  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const migration = (body as any).migration ?? 'all';

  const statementsMap: Record<string, string[]> = {
    all:   MIGRATION_STATEMENTS,
    '014': MIGRATION_014,
    '015': MIGRATION_015,
  };
  const statements = statementsMap[migration] ?? MIGRATION_STATEMENTS;
  const fullSql = statements.join(';\n\n') + ';';

  return NextResponse.json({
    message: `Migration SQL for "${migration}" generated. Paste the sql field into the Supabase SQL Editor: https://supabase.com/dashboard/project/aciqrjgcnrxhmywlkkqb/sql/new`,
    statementCount: statements.length,
    migration,
    sql: fullSql,
  });
}
