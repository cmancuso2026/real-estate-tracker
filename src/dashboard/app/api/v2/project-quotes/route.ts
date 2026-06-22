import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { work_order_id, vendor_id, quoted_cost, notes } = body;

  if (!work_order_id || !vendor_id) {
    return NextResponse.json({ error: 'work_order_id and vendor_id are required' }, { status: 400 });
  }

  const rows = await query(
    `INSERT INTO project_quotes (work_order_id, vendor_id, quoted_cost, notes)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (work_order_id, vendor_id) DO UPDATE
       SET quoted_cost = EXCLUDED.quoted_cost, notes = EXCLUDED.notes
     RETURNING *`,
    [work_order_id, vendor_id, quoted_cost ?? null, notes ?? null]
  );
  return NextResponse.json(rows[0], { status: 201 });
}
