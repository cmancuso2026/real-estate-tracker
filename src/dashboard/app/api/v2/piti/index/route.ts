/**
 * GET /api/v2/piti?propertyId=1
 * Returns PITI history for a property (for the escrow/mortgage tab)
 */

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get('propertyId');

  if (!propertyId) {
    return NextResponse.json(
      { error: 'propertyId query parameter is required' },
      { status: 400 },
    );
  }

  try {
    const rows = await query(
      `SELECT * FROM piti_history
       WHERE property_id = $1
       ORDER BY statement_year_month DESC`,
      [propertyId],
    );

    return NextResponse.json(rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('PITI fetch error:', msg);
    return NextResponse.json(
      { error: 'Failed to fetch PITI history', details: msg },
      { status: 500 },
    );
  }
}
