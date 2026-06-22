import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { work_order_id, units } = body as {
    work_order_id?: number;
    units?: Array<{ unit_id?: number; cost_share?: number | null }>;
  };

  if (!work_order_id) {
    return NextResponse.json({ error: 'work_order_id is required' }, { status: 400 });
  }

  await query(`DELETE FROM project_units WHERE work_order_id = $1`, [work_order_id]);

  for (const u of units ?? []) {
    if (!u.unit_id) continue;
    await query(
      `INSERT INTO project_units (work_order_id, unit_id, cost_share) VALUES ($1,$2,$3)`,
      [work_order_id, u.unit_id, u.cost_share ?? null]
    );
  }

  const rows = await query(
    `SELECT pu.unit_id, u.unit_label, pu.cost_share
     FROM project_units pu
     JOIN units u ON u.id = pu.unit_id
     WHERE pu.work_order_id = $1
     ORDER BY u.unit_label`,
    [work_order_id]
  );
  return NextResponse.json(rows);
}
