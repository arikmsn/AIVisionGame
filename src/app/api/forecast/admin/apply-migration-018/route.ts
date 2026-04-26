/**
 * POST /api/forecast/admin/apply-migration-018
 *
 * ONE-SHOT route: creates fa_v2_ai_usage table for AI inference cost tracking.
 * DELETE THIS FILE after migration is applied.
 *
 * Body: { supabase_pat: "sbp_..." }  OR  { db_password: "..." }
 */

import { NextRequest, NextResponse } from 'next/server';

function authorizeAdmin(req: NextRequest): boolean {
  return !!process.env.ADMIN_PASSWORD &&
    req.headers.get('x-admin-password') === process.env.ADMIN_PASSWORD;
}

const SQL = `
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
CREATE INDEX IF NOT EXISTS idx_fa_v2_ai_usage_pilot ON fa_v2_ai_usage(pilot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fa_v2_ai_usage_model ON fa_v2_ai_usage(model_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fa_v2_ai_usage_day   ON fa_v2_ai_usage(created_at DESC);
`;

export async function POST(req: NextRequest) {
  if (!authorizeAdmin(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch {}

  const pat        = body.supabase_pat as string | undefined;
  const dbPassword = (body.db_password as string | undefined) ?? process.env.SUPABASE_DB_PASSWORD;

  if (pat) {
    const REF = 'aciqrjgcnrxhmywlkkqb';
    try {
      const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${pat}` },
        body: JSON.stringify({ query: SQL }),
      });
      const text = await res.text();
      if (!res.ok) return NextResponse.json({ ok: false, detail: text.slice(0, 400) }, { status: 400 });
      return NextResponse.json({ ok: true, method: 'management_api' });
    } catch (err: any) {
      return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
    }
  }

  if (dbPassword) {
    const { Client } = await import('pg' as any);
    const client = new Client({
      host: 'db.aciqrjgcnrxhmywlkkqb.supabase.co', port: 5432,
      user: 'postgres', password: dbPassword, database: 'postgres',
      ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000,
    });
    try {
      await client.connect();
      await client.query(SQL);
      await client.end();
      return NextResponse.json({ ok: true, method: 'direct_pg' });
    } catch (err: any) {
      try { await client.end(); } catch {}
      return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    error: 'Provide { supabase_pat: "sbp_..." } or { db_password: "..." } in body.',
    sql: SQL,
  }, { status: 400 });
}
