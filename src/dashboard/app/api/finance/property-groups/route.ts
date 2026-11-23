import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface Row {
  id: number;
  address: string;
  units: string[] | null;
  categories: string[] | null;
}

// GET /api/finance/property-groups — each owned property with the categories
// mapped to it in property_category_map ("1207 Rent" → 1205-1207 NE 117th St),
// so the finance UI rolls those categories up per property, exactly as the
// Overview's cash flow does. Replaces the old page's hardcoded PROPERTIES map.
// → { properties: [{ id, name, units, categories }] }
export async function GET() {
  try {
    const rows = await query<Row>(
      `SELECT op.id, op.address,
              array_agg(DISTINCT u.unit_label) FILTER (WHERE u.id IS NOT NULL) AS units,
              (SELECT array_agg(m.category ORDER BY m.category)
                 FROM property_category_map m WHERE m.property_id = op.id) AS categories
         FROM owned_properties op
         LEFT JOIN units u ON u.property_id = op.id
        GROUP BY op.id
        ORDER BY op.id`,
    );
    return NextResponse.json({
      properties: rows.map((r) => ({ id: r.id, name: r.address, units: r.units ?? [], categories: r.categories ?? [] })),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load properties' },
      { status: 500 },
    );
  }
}
