/**
 * POST /api/forecast/v2/operator
 *
 * Manual operator controls for the v2 Live Book.
 *
 * Body (JSON):
 *   { action: 'close_position',   positionId, reason? }
 *   { action: 'reduce_position',  positionId, amount_usd, reason? }
 *   { action: 'close_all',        reason? }
 *   { action: 'pause_all' }
 *   { action: 'resume_all' }
 *   { action: 'manual_only' }
 *   { action: 'auto_mode' }
 *   { action: 'pause_market',     marketId }
 *   { action: 'resume_market',    marketId }
 *
 * All destructive actions are logged to fa_v2_operator_actions.
 */

import { NextRequest, NextResponse }       from 'next/server';
import { faSelect, faInsert }              from '@/lib/forecast/db';
import { getActivePilot, setPilotStatus }  from '@/lib/forecast/v2/pilot';
import { closePosition, reducePosition, getOpenPosition } from '@/lib/forecast/v2/positions';
import type { V2Position }                 from '@/lib/forecast/v2/types';

function authorizeAdmin(req: NextRequest): boolean {
  return !!process.env.ADMIN_PASSWORD &&
    req.headers.get('x-admin-password') === process.env.ADMIN_PASSWORD;
}

async function logOperatorAction(
  pilotId:     string | null,
  actionType:  string,
  marketId:    string | null,
  positionId:  string | null,
  amountUsd:   number | null,
  reason:      string | null,
  notes:       string | null,
): Promise<void> {
  await faInsert('fa_v2_operator_actions', [{
    pilot_id:     pilotId,
    action_type:  actionType,
    market_id:    marketId,
    position_id:  positionId,
    amount_usd:   amountUsd,
    reason,
    notes,
  }]).catch(() => {});
}

export async function POST(req: NextRequest) {
  if (!authorizeAdmin(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const action     = body.action as string;
  const positionId = body.positionId as string | undefined;
  const marketId   = body.marketId   as string | undefined;
  const amountUsd  = body.amount_usd as number | undefined;
  const reason     = (body.reason    as string | undefined) ?? 'operator';
  const notes      = (body.notes     as string | undefined) ?? null;

  const pilot = await getActivePilot();
  if (!pilot) return NextResponse.json({ error: 'no active pilot' }, { status: 404 });

  try {
    switch (action) {

      // ── Close one position ────────────────────────────────────────────────
      case 'close_position': {
        if (!positionId) return NextResponse.json({ error: 'positionId required' }, { status: 400 });
        const positions = await faSelect<V2Position>(
          'fa_v2_positions', `id=eq.${positionId}&status=in.(open,paused)&select=*`,
        );
        const pos = positions[0];
        if (!pos) return NextResponse.json({ error: 'position not found' }, { status: 404 });

        const mkt = await faSelect<{ current_yes_price: number | null }>(
          'fa_markets', `id=eq.${pos.market_id}&select=current_yes_price`,
        );
        const mp = Number(mkt[0]?.current_yes_price ?? pos.current_price ?? pos.entry_price);

        const result = await closePosition(
          pilot.id, pos, mp, 0, 0, 0, null, reason, 'operator',
        );
        await logOperatorAction(pilot.id, action, pos.market_id, positionId, Number(pos.size_usd), reason, notes);
        return NextResponse.json({ ok: result.ok, reason: result.reason });
      }

      // ── Reduce one position ───────────────────────────────────────────────
      case 'reduce_position': {
        if (!positionId) return NextResponse.json({ error: 'positionId required' }, { status: 400 });
        if (!amountUsd)  return NextResponse.json({ error: 'amount_usd required' }, { status: 400 });

        const positions = await faSelect<V2Position>(
          'fa_v2_positions', `id=eq.${positionId}&status=in.(open,paused)&select=*`,
        );
        const pos = positions[0];
        if (!pos) return NextResponse.json({ error: 'position not found' }, { status: 404 });

        const mkt = await faSelect<{ current_yes_price: number | null }>(
          'fa_markets', `id=eq.${pos.market_id}&select=current_yes_price`,
        );
        const mp = Number(mkt[0]?.current_yes_price ?? pos.current_price ?? pos.entry_price);

        const result = await reducePosition(
          pilot.id, pos, amountUsd, mp, 0, 0, 0, null, reason, 'operator',
        );
        await logOperatorAction(pilot.id, action, pos.market_id, positionId, amountUsd, reason, notes);
        return NextResponse.json({ ok: result.ok, reason: result.reason });
      }

      // ── Close all positions ───────────────────────────────────────────────
      case 'close_all': {
        const positions = await faSelect<V2Position>(
          'fa_v2_positions',
          `pilot_id=eq.${pilot.id}&status=in.(open,paused)&select=*`,
        );

        const mktIds = [...new Set(positions.map(p => p.market_id))];
        const prices: Record<string, number> = {};
        if (mktIds.length > 0) {
          const mkts = await faSelect<{ id: string; current_yes_price: number | null }>(
            'fa_markets', `id=in.(${mktIds.join(',')})&select=id,current_yes_price`,
          );
          for (const m of mkts) prices[m.id] = Number(m.current_yes_price ?? 0.5);
        }

        let closed = 0;
        for (const pos of positions) {
          const mp = prices[pos.market_id] ?? Number(pos.current_price ?? pos.entry_price);
          const r  = await closePosition(pilot.id, pos, mp, 0, 0, 0, null, reason, 'operator');
          if (r.ok) closed++;
        }

        await logOperatorAction(pilot.id, action, null, null, null, reason, `closed ${closed}/${positions.length}`);
        return NextResponse.json({ ok: true, closed, total: positions.length });
      }

      // ── Pilot status controls ─────────────────────────────────────────────
      case 'manual_only':
        await setPilotStatus(pilot.id, 'manual_only');
        await logOperatorAction(pilot.id, action, null, null, null, reason, notes);
        return NextResponse.json({ ok: true, status: 'manual_only' });

      case 'auto_mode':
        await setPilotStatus(pilot.id, 'active');
        await logOperatorAction(pilot.id, action, null, null, null, reason, notes);
        return NextResponse.json({ ok: true, status: 'active' });

      case 'pause_all':
        await setPilotStatus(pilot.id, 'paused');
        await logOperatorAction(pilot.id, action, null, null, null, reason, notes);
        return NextResponse.json({ ok: true, status: 'paused' });

      case 'resume_all':
        await setPilotStatus(pilot.id, 'active');
        await logOperatorAction(pilot.id, action, null, null, null, reason, notes);
        return NextResponse.json({ ok: true, status: 'active' });

      // ── Pause / resume a single market (via position status) ──────────────
      case 'pause_market': {
        if (!marketId) return NextResponse.json({ error: 'marketId required' }, { status: 400 });
        const pos = await getOpenPosition(pilot.id, marketId);
        if (!pos) return NextResponse.json({ error: 'no open position for this market' }, { status: 404 });
        const { faPatch } = await import('@/lib/forecast/db');
        await faPatch('fa_v2_positions', { id: pos.id }, { status: 'paused', updated_at: new Date().toISOString() });
        await logOperatorAction(pilot.id, action, marketId, pos.id, null, reason, notes);
        return NextResponse.json({ ok: true, positionId: pos.id });
      }

      case 'resume_market': {
        if (!marketId) return NextResponse.json({ error: 'marketId required' }, { status: 400 });
        const positions = await faSelect<V2Position>(
          'fa_v2_positions',
          `pilot_id=eq.${pilot.id}&market_id=eq.${marketId}&status=eq.paused&select=*`,
        );
        const pos = positions[0];
        if (!pos) return NextResponse.json({ error: 'no paused position for this market' }, { status: 404 });
        const { faPatch } = await import('@/lib/forecast/db');
        await faPatch('fa_v2_positions', { id: pos.id }, { status: 'open', updated_at: new Date().toISOString() });
        await logOperatorAction(pilot.id, action, marketId, pos.id, null, reason, notes);
        return NextResponse.json({ ok: true, positionId: pos.id });
      }

      default:
        return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
    }
  } catch (err: any) {
    console.error('[V2/OPERATOR] error:', err?.message);
    return NextResponse.json({ error: err?.message ?? 'internal error' }, { status: 500 });
  }
}
