import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await query(
    `SELECT pq.id,
            pq.project_id,
            pq.vendor_id,
            v.name  AS vendor_name,
            v.trade AS vendor_trade,
            pq.quoted_cost,
            pq.final_cost,
            pq.is_selected,
            pq.notes,
            pq.created_at
     FROM project_quotes pq
     JOIN vendors v ON v.id = pq.vendor_id
     WHERE pq.project_id = $1
     ORDER BY pq.is_selected DESC, pq.created_at`,
    [id]
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { vendor_id, quoted_cost, final_cost, notes } = body;

  if (!vendor_id) return NextResponse.json({ error: 'vendor_id required' }, { status: 400 });

  const rows = await query(
    `INSERT INTO project_quotes (project_id, vendor_id, quoted_cost, final_cost, notes)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (project_id, vendor_id) DO UPDATE
       SET quoted_cost = EXCLUDED.quoted_cost,
           final_cost  = EXCLUDED.final_cost,
           notes       = EXCLUDED.notes
     RETURNING *`,
    [id, vendor_id, quoted_cost ?? null, final_cost ?? null, notes ?? null]
  );
  return NextResponse.json(rows[0], { status: 201 });
}
