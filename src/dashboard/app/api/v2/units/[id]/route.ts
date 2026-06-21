import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (body.is_owner_unit !== undefined) { fields.push(`is_owner_unit = $${idx++}`); values.push(body.is_owner_unit); }
  if (body.unit_label !== undefined)    { fields.push(`unit_label = $${idx++}`);    values.push(body.unit_label); }
  if (body.bedrooms !== undefined)      { fields.push(`bedrooms = $${idx++}`);      values.push(body.bedrooms); }
  if (body.bathrooms !== undefined)     { fields.push(`bathrooms = $${idx++}`);     values.push(body.bathrooms); }
  if (body.sqft !== undefined)          { fields.push(`sqft = $${idx++}`);          values.push(body.sqft); }
  if (body.notes !== undefined)         { fields.push(`notes = $${idx++}`);         values.push(body.notes); }

  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

  values.push(id);
  const rows = await query(
    `UPDATE units SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(rows[0]);
}
