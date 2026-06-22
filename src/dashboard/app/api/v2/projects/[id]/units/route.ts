import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

async function listUnits(projectId: string) {
  return query(
    `SELECT pu.unit_id, u.unit_label, pu.cost_share
     FROM project_units pu
     JOIN units u ON u.id = pu.unit_id
     WHERE pu.project_id = $1
     ORDER BY u.unit_label`,
    [projectId]
  );
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json(await listUnits(id));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const units: Array<{ unit_id?: number; cost_share?: number | null }> = Array.isArray(body.units) ? body.units : [];

  await query(`DELETE FROM project_units WHERE project_id = $1`, [id]);

  for (const u of units) {
    if (u.unit_id == null) continue;
    await query(
      `INSERT INTO project_units (project_id, unit_id, cost_share) VALUES ($1,$2,$3)`,
      [id, u.unit_id, u.cost_share ?? null]
    );
  }

  return NextResponse.json(await listUnits(id));
}
