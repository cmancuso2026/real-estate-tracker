import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface Row {
  id: number;
  address: string;
  units: string[] | null;
}

// GET /api/finance/property-groups — each owned property with its unit labels,
// so the finance UI can roll unit categories up to a property ("1207 Rent" →
// the property with unit 1207). Replaces the old page's hardcoded PROPERTIES map.
// → { properties: [{ id, name, units }] }
export async function GET() {
  try {
    const rows = await query<Row>(
      `SELECT op.id, op.address,
              array_agg(u.unit_label ORDER BY u.unit_label) FILTER (WHERE u.id IS NOT NULL) AS units
         FROM owned_properties op
         LEFT JOIN units u ON u.property_id = op.id
        GROUP BY op.id
        ORDER BY op.id`,
    );
    return NextResponse.json({
      properties: rows.map((r) => ({ id: r.id, name: r.address, units: r.units ?? [] })),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load properties' },
      { status: 500 },
    );
  }
}
