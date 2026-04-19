/**
 * POST /api/forecast/admin/apply-migration
 *
 * One-shot runtime migration executor. Accepts a Postgres connection URL
 * via body OR reads it from env (POSTGRES_URL / DATABASE_URL / SUPABASE_DB_URL).
 *
 * Body:
 *   {
 *     dbUrl?:    string,        // optional, else reads env
 *     filename?: string,        // migration file in supabase/migrations/ (default: '015_calibration_domains_benchmarks.sql')
 *     sql?:      string,        // literal SQL (overrides filename)
 *   }
 *
 * Protected by x-admin-password. Uses `pg` directly — REST/PostgREST cannot run DDL.
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFileSync }               from 'node:fs';
import { join }                        from 'node:path';
import { Client }                      from 'pg';

export const maxDuration = 60;
export const dynamic    = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (request.headers.get('x-admin-password') !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const {
      dbUrl:    bodyDbUrl,
      filename = '015_calibration_domains_benchmarks.sql',
      sql:      literalSql,
    } = body as { dbUrl?: string; filename?: string; sql?: string };

    const dbUrl =
      bodyDbUrl ??
      process.env.POSTGRES_URL ??
      process.env.DATABASE_URL ??
      process.env.SUPABASE_DB_URL ??
      null;

    if (!dbUrl) {
      return NextResponse.json({
        error: 'No database URL available. Pass { dbUrl } in the body or set POSTGRES_URL / DATABASE_URL / SUPABASE_DB_URL in env.',
      }, { status: 400 });
    }

    let sql = literalSql;
    if (!sql) {
      // Read from disk (works on Vercel since repo files are deployed)
      const path = join(process.cwd(), 'supabase', 'migrations', filename);
      sql = readFileSync(path, 'utf8');
    }

    if (!sql || sql.trim().length === 0) {
      return NextResponse.json({ error: 'Empty SQL' }, { status: 400 });
    }

    const client = new Client({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
    });

    const t0 = Date.now();
    await client.connect();
    try {
      await client.query(sql);
    } finally {
      await client.end().catch(() => {});
    }
    const elapsedMs = Date.now() - t0;

    return NextResponse.json({
      ok: true,
      filename: literalSql ? null : filename,
      bytes:    sql.length,
      elapsed_ms: elapsedMs,
    });
  } catch (err: any) {
    return NextResponse.json({
      error: err?.message ?? String(err),
      code:  err?.code ?? null,
    }, { status: 500 });
  }
}
