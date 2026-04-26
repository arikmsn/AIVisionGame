/**
 * POST /api/forecast/admin/apply-v2-migration
 *
 * ONE-SHOT route: creates the 5 fa_v2_* tables via direct pg connection.
 * Requires SUPABASE_DB_PASSWORD env var OR will prompt for it in the body.
 *
 * Also accepts ?token=<supabase_access_token> to use the Management API.
 *
 * DELETE THIS FILE after migration is applied.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseCreds }            from '@/lib/forecast/db';

function authorizeAdmin(req: NextRequest): boolean {
  return !!process.env.ADMIN_PASSWORD &&
    req.headers.get('x-admin-password') === process.env.ADMIN_PASSWORD;
}

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS fa_v2_pilots (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text        NOT NULL DEFAULT 'Pilot v2',
  initial_bankroll_usd  numeric(14,4) NOT NULL DEFAULT 1000.00,
  current_cash_usd      numeric(14,4) NOT NULL DEFAULT 1000.00,
  invested_usd          numeric(14,4) NOT NULL DEFAULT 0.00,
  realized_pnl_usd      numeric(14,4) NOT NULL DEFAULT 0.00,
  unrealized_pnl_usd    numeric(14,4) NOT NULL DEFAULT 0.00,
  status                text        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','paused','manual_only','archived')),
  started_at            timestamptz NOT NULL DEFAULT now(),
  archived_at           timestamptz,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

INSERT INTO fa_v2_pilots (name, initial_bankroll_usd, current_cash_usd, status)
VALUES ('Phase 1 Pilot', 1000.00, 1000.00, 'active')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS fa_v2_positions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pilot_id              uuid        NOT NULL REFERENCES fa_v2_pilots(id),
  market_id             uuid        NOT NULL REFERENCES fa_markets(id),
  domain                text,
  status                text        NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open','closed','paused')),
  side                  text        NOT NULL CHECK (side IN ('yes','no')),
  size_usd              numeric(14,4) NOT NULL DEFAULT 0,
  desired_size_usd      numeric(14,4),
  cost_basis_usd        numeric(14,4) NOT NULL DEFAULT 0,
  avg_cost              numeric(6,4),
  entry_price           numeric(6,4) NOT NULL,
  current_price         numeric(6,4),
  unrealized_pnl        numeric(14,4) NOT NULL DEFAULT 0,
  realized_pnl          numeric(14,4) NOT NULL DEFAULT 0,
  conviction            numeric(4,3),
  disagreement          numeric(4,3),
  edge_at_open          numeric(5,3),
  last_signal_refresh   timestamptz,
  next_review_at        timestamptz,
  cooldown_until        timestamptz,
  thesis                text,
  management_plan       text,
  exit_trigger          text,
  adjustment_count      integer     NOT NULL DEFAULT 0,
  opening_round_id      uuid        REFERENCES fa_rounds(id),
  opened_at             timestamptz NOT NULL DEFAULT now(),
  closed_at             timestamptz,
  close_reason          text,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS fa_v2_pos_one_open
  ON fa_v2_positions(pilot_id, market_id)
  WHERE status IN ('open','paused');
CREATE INDEX IF NOT EXISTS idx_fa_v2_pos_pilot_status ON fa_v2_positions(pilot_id, status);
CREATE INDEX IF NOT EXISTS idx_fa_v2_pos_market ON fa_v2_positions(market_id);

CREATE TABLE IF NOT EXISTS fa_v2_adjustments (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id           uuid        NOT NULL REFERENCES fa_v2_positions(id),
  pilot_id              uuid        NOT NULL REFERENCES fa_v2_pilots(id),
  market_id             uuid        NOT NULL REFERENCES fa_markets(id),
  action                text        NOT NULL
                          CHECK (action IN ('open','add','reduce','close','reverse','pause','resume')),
  size_before           numeric(14,4) NOT NULL DEFAULT 0,
  size_after            numeric(14,4) NOT NULL DEFAULT 0,
  delta_usd             numeric(14,4) NOT NULL DEFAULT 0,
  market_price          numeric(6,4),
  edge                  numeric(5,3),
  conviction            numeric(4,3),
  disagreement          numeric(4,3),
  spread_cost_usd       numeric(10,4) NOT NULL DEFAULT 0,
  slippage_cost_usd     numeric(10,4) NOT NULL DEFAULT 0,
  net_cost_usd          numeric(14,4) NOT NULL DEFAULT 0,
  realized_pnl_delta    numeric(14,4) NOT NULL DEFAULT 0,
  source                text        NOT NULL DEFAULT 'system'
                          CHECK (source IN ('system','operator','risk_engine','expiry')),
  reason                text,
  operator_note         text,
  round_id              uuid        REFERENCES fa_rounds(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fa_v2_adj_position ON fa_v2_adjustments(position_id, created_at);
CREATE INDEX IF NOT EXISTS idx_fa_v2_adj_pilot    ON fa_v2_adjustments(pilot_id, created_at DESC);

CREATE TABLE IF NOT EXISTS fa_v2_signals (
  market_id             uuid        PRIMARY KEY REFERENCES fa_markets(id),
  pilot_id              uuid        REFERENCES fa_v2_pilots(id),
  domain                text,
  market_price          numeric(6,4),
  aggregated_p          numeric(6,4),
  edge                  numeric(5,3),
  disagreement          numeric(4,3),
  conviction            numeric(4,3),
  n_models              integer,
  last_round_id         uuid        REFERENCES fa_rounds(id),
  last_refresh          timestamptz NOT NULL DEFAULT now(),
  evidence_freshness_h  numeric(6,2),
  tier                  text        NOT NULL DEFAULT 'monitored'
                          CHECK (tier IN ('monitored','hot','tradable','active','cooling')),
  is_stale              boolean     NOT NULL DEFAULT false,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fa_v2_signals_tier ON fa_v2_signals(tier, conviction DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS fa_v2_operator_actions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pilot_id              uuid        REFERENCES fa_v2_pilots(id),
  action_type           text        NOT NULL
                          CHECK (action_type IN (
                            'close_position','reduce_position','add_position',
                            'pause_market','resume_market',
                            'close_all','pause_all','resume_all',
                            'manual_only','auto_mode','reset_pilot'
                          )),
  market_id             uuid        REFERENCES fa_markets(id),
  position_id           uuid        REFERENCES fa_v2_positions(id),
  amount_usd            numeric(14,4),
  reason                text,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fa_v2_op_pilot ON fa_v2_operator_actions(pilot_id, created_at DESC);
`;

export async function POST(req: NextRequest) {
  if (!authorizeAdmin(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Option A: use Supabase Management API with PAT from request body
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch {}
  const pat = body.supabase_pat as string | undefined;

  if (pat) {
    return applyViaPAT(pat);
  }

  // Option B: use direct pg connection with DB password from body or env
  const dbPassword = (body.db_password as string | undefined) ?? process.env.SUPABASE_DB_PASSWORD;
  if (dbPassword) {
    return applyViaPg(dbPassword);
  }

  return NextResponse.json({
    error: 'Provide { supabase_pat: "sbp_..." } or { db_password: "..." } in the request body.',
    hint:  'Get PAT from https://supabase.com/dashboard/account/tokens',
  }, { status: 400 });
}

async function applyViaPAT(pat: string): Promise<NextResponse> {
  const REF = 'aciqrjgcnrxhmywlkkqb';
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${pat}`,
      },
      body: JSON.stringify({ query: MIGRATION_SQL }),
    });
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json({ ok: false, status: res.status, detail: text.slice(0, 400) }, { status: 400 });
    }
    return NextResponse.json({ ok: true, method: 'management_api', detail: text.slice(0, 400) });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}

async function applyViaPg(dbPassword: string): Promise<NextResponse> {
  // Dynamic import so this only loads when pg is needed
  const { Client } = await import('pg' as any);
  const REF = 'aciqrjgcnrxhmywlkkqb';
  const client = new Client({
    host:     `db.${REF}.supabase.co`,
    port:     5432,
    user:     'postgres',
    password: dbPassword,
    database: 'postgres',
    ssl:      { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
  });
  try {
    await client.connect();
    await client.query(MIGRATION_SQL);
    await client.end();
    return NextResponse.json({ ok: true, method: 'direct_pg' });
  } catch (err: any) {
    try { await client.end(); } catch {}
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}
