import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/v2/vendors?search=plumbing&activeOnly=true
export async function GET(req: NextRequest) {
  const search     = req.nextUrl.searchParams.get('search');
  const activeOnly = req.nextUrl.searchParams.get('activeOnly') !== 'false';

  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (activeOnly) { conditions.push(`v.is_active = TRUE`); }
  if (search)     { conditions.push(`(v.name ILIKE $${idx} OR v.trade ILIKE $${idx++})`); values.push(`%${search}%`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await query(
    `SELECT v.*,
            COUNT(wo.id)::int               AS total_jobs,
            COUNT(wo.id) FILTER (WHERE wo.status = 'complete')::int AS completed_jobs,
            ROUND(AVG(wo.rating) FILTER (WHERE wo.rating IS NOT NULL), 1) AS avg_internal_rating,
            SUM(wo.actual_cost) FILTER (WHERE wo.actual_cost IS NOT NULL)::int AS total_spend
     FROM vendors v
     LEFT JOIN work_orders wo ON wo.vendor_id = v.id
     ${where}
     GROUP BY v.id
     ORDER BY v.name`,
    values
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, trade, phone, email, website, manual_rating, manual_notes } = body;

  if (!name || !trade) {
    return NextResponse.json({ error: 'name and trade are required' }, { status: 400 });
  }

  // Optionally look up Google Places if GOOGLE_PLACES_API_KEY is set
  let google_place_id = null;
  let google_rating = null;
  let google_review_count = null;
  let google_last_refreshed = null;

  const placesKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (placesKey && name) {
    try {
      const searchQuery = encodeURIComponent(`${name} ${trade}`);
      const placesRes = await fetch(
        `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${searchQuery}&inputtype=textquery&fields=place_id,rating,user_ratings_total&key=${placesKey}`
      );
      const placesData = await placesRes.json() as {
        candidates?: Array<{ place_id?: string; rating?: number; user_ratings_total?: number }>;
      };
      const candidate = placesData.candidates?.[0];
      if (candidate?.place_id) {
        google_place_id      = candidate.place_id;
        google_rating        = candidate.rating ?? null;
        google_review_count  = candidate.user_ratings_total ?? null;
        google_last_refreshed = new Date().toISOString().slice(0, 19).replace('T', ' ');
      }
    } catch {
      // Google Places lookup failed — continue without it
    }
  }

  const rows = await query(
    `INSERT INTO vendors
       (name, trade, phone, email, website, google_place_id, google_rating,
        google_review_count, google_last_refreshed, manual_rating, manual_notes, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE)
     RETURNING *`,
    [
      name, trade,
      phone ?? null, email ?? null, website ?? null,
      google_place_id, google_rating, google_review_count, google_last_refreshed,
      manual_rating ?? null, manual_notes ?? null,
    ]
  );
  return NextResponse.json(rows[0], { status: 201 });
}
