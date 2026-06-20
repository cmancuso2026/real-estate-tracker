import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/v2/tenants?propertyId=1
export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get('propertyId');
  const unitId     = req.nextUrl.searchParams.get('unitId');

  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (propertyId) { conditions.push(`p.id = $${idx++}`);    values.push(propertyId); }
  if (unitId)     { conditions.push(`t.unit_id = $${idx++}`); values.push(unitId); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await query(
    `SELECT t.*, u.unit_label, p.address AS property_address
     FROM tenants t
     JOIN units u            ON u.id = t.unit_id
     JOIN owned_properties p ON p.id = u.property_id
     ${where}
     ORDER BY t.last_name, t.first_name`,
    values
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { unit_id, first_name, last_name, email, phone, payment_method, is_active, notes } = body;

  if (!unit_id || !first_name || !last_name) {
    return NextResponse.json({ error: 'unit_id, first_name, last_name are required' }, { status: 400 });
  }

  const rows = await query(
    `INSERT INTO tenants (unit_id, first_name, last_name, email, phone, payment_method, is_active, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (unit_id, lower(first_name), lower(last_name)) DO UPDATE SET is_active=TRUE
     RETURNING *`,
    [
      unit_id, first_name, last_name,
      email ?? null, phone ?? null,
      payment_method ?? 'zelle',
      is_active ?? true,
      notes ?? null,
    ]
  );
  return NextResponse.json(rows[0], { status: 201 });
}
