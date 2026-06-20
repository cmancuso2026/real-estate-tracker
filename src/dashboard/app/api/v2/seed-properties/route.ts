/**
 * GET /api/v2/seed-properties?secret=SEED_SECRET
 * One-time seed for Cole's three duplexes.
 * Idempotent — skips any property that already exists.
 * Protected by SEED_SECRET env var.
 */

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const PROPERTIES = [
  {
    address: '20-22 NW 119th St',
    city: 'Miami', state: 'FL', zip_code: '33168',
    property_type: 'duplex', unit_count: 2,
    units: ['20', '22'],
  },
  {
    address: '1821-1825 NW 74th St',
    city: 'Miami', state: 'FL', zip_code: '33147',
    property_type: 'duplex', unit_count: 2,
    units: ['1821', '1825'],
  },
  {
    address: '1205-1207 NE 117th St',
    city: 'Miami', state: 'FL', zip_code: '33161',
    property_type: 'duplex', unit_count: 2,
    units: ['1205', '1207'],
  },
];

export async function GET(req: NextRequest) {
  const secret = process.env.SEED_SECRET?.trim();
  const provided = req.nextUrl.searchParams.get('secret');

  if (!secret) {
    return NextResponse.json({ error: 'SEED_SECRET env var not set' }, { status: 500 });
  }
  if (provided !== secret) {
    return NextResponse.json({ error: 'Invalid secret' }, { status: 401 });
  }

  const results: Array<{ address: string; status: string; id?: number; units?: string[] }> = [];

  for (const p of PROPERTIES) {
    const existing = await query<{ id: number }>(
      `SELECT id FROM owned_properties WHERE address = $1`, [p.address]
    );

    if (existing.length > 0) {
      results.push({ address: p.address, status: 'already exists', id: existing[0]!.id });
      continue;
    }

    const [prop] = await query<{ id: number }>(
      `INSERT INTO owned_properties (address, city, state, zip_code, property_type, unit_count)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [p.address, p.city, p.state, p.zip_code, p.property_type, p.unit_count]
    );

    for (const label of p.units) {
      await query(
        `INSERT INTO units (property_id, unit_label)
         VALUES ($1,$2) ON CONFLICT (property_id, unit_label) DO NOTHING`,
        [prop!.id, label]
      );
    }

    results.push({ address: p.address, status: 'created', id: prop!.id, units: p.units });
  }

  return NextResponse.json({ ok: true, results });
}
