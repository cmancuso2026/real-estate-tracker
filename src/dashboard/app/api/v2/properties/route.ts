import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const rows = await query(
    `SELECT p.*,
            COUNT(u.id)::int AS unit_count_actual
     FROM owned_properties p
     LEFT JOIN units u ON u.property_id = p.id
     GROUP BY p.id
     ORDER BY p.address`
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { address, city, state, zip_code, property_type, unit_count, notes } = body;

  if (!address || !city || !state) {
    return NextResponse.json({ error: 'address, city, state are required' }, { status: 400 });
  }

  const rows = await query(
    `INSERT INTO owned_properties (address, city, state, zip_code, property_type, unit_count, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [address, city, state, zip_code ?? null, property_type ?? 'duplex', unit_count ?? 2, notes ?? null]
  );
  return NextResponse.json(rows[0], { status: 201 });
}
