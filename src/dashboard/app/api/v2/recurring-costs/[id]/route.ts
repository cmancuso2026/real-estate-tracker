import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { recurringFields } from '@/lib/recurring';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { description, vendor_id, is_active } = body;
  const [cur] = await query<Record<string, unknown>>(`SELECT * FROM recurring_costs WHERE id = $1`, [id]);
  if (!cur) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Amount, frequency and dates are validated together: anything left out
  // keeps its saved value; start_date / end_date null clears them.
  const touchesSchedule = ['frequency', 'amount', 'monthly_amount', 'start_date', 'end_date'].some((k) => k in body);
  let f = null;
  if (touchesSchedule) {
    try {
      f = recurringFields({
        frequency: body.frequency ?? cur.frequency,
        amount: body.amount ?? (body.monthly_amount !== undefined && !('frequency' in body) ? body.monthly_amount : cur.amount ?? cur.monthly_amount),
        start_date: 'start_date' in body ? body.start_date : cur.start_date,
        end_date: 'end_date' in body ? body.end_date : cur.end_date,
      });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  }

  const rows = await query(
    `UPDATE recurring_costs
        SET description    = COALESCE($1, description),
            vendor_id      = COALESCE($2, vendor_id),
            is_active      = COALESCE($3, is_active),
            frequency      = COALESCE($4, frequency),
            amount         = COALESCE($5, amount),
            monthly_amount = COALESCE($6, monthly_amount),
            start_date     = CASE WHEN $7 THEN $8 ELSE start_date END,
            end_date       = CASE WHEN $7 THEN $9 ELSE end_date END
      WHERE id = $10
      RETURNING *`,
    [
      description ?? null, vendor_id ?? null, is_active ?? null,
      f?.frequency ?? null, f?.amount ?? null, f?.monthly_amount ?? null,
      !!f, f?.start_date ?? null, f?.end_date ?? null, id,
    ],
  );
  return NextResponse.json(rows[0]);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await query(`DELETE FROM recurring_costs WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
