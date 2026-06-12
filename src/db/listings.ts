import { query, queryOne, withTransaction, NOW_UTC } from './index.js';
import type { ListingRecord, UpsertResult } from './types.js';

/**
 * Insert listings, deduplicating on (source, source_id). On conflict we refresh
 * the mutable fields (price, status, days_on_market, ...) and bump last_seen_at,
 * preserving the original first_seen_at. The upsert can't itself report whether
 * each row was new vs. refreshed, so we probe existence first inside the txn
 * (mirroring the original SQLite behavior).
 */
export async function upsertListings(
  records: ListingRecord[],
): Promise<UpsertResult> {
  const sql = `
    INSERT INTO listings (
      source, source_id, address, city, state, zip_code,
      latitude, longitude, price, bedrooms, bathrooms, living_area,
      lot_size, year_built, property_type, days_on_market, status,
      listing_url, raw_json
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11, $12,
      $13, $14, $15, $16, $17,
      $18, $19
    )
    ON CONFLICT (source, source_id) DO UPDATE SET
      address        = excluded.address,
      city           = excluded.city,
      state          = excluded.state,
      zip_code       = excluded.zip_code,
      latitude       = excluded.latitude,
      longitude      = excluded.longitude,
      price          = excluded.price,
      bedrooms       = excluded.bedrooms,
      bathrooms      = excluded.bathrooms,
      living_area    = excluded.living_area,
      lot_size       = excluded.lot_size,
      year_built     = excluded.year_built,
      property_type  = excluded.property_type,
      days_on_market = excluded.days_on_market,
      status         = excluded.status,
      listing_url    = excluded.listing_url,
      raw_json       = excluded.raw_json,
      last_seen_at   = ${NOW_UTC},
      updated_at     = ${NOW_UTC}
  `;

  return withTransaction(async (client) => {
    let inserted = 0;
    let updated = 0;
    for (const row of records) {
      const existing = await client.query(
        'SELECT 1 FROM listings WHERE source = $1 AND source_id = $2',
        [row.source, row.source_id],
      );
      const isUpdate = (existing.rowCount ?? 0) > 0;
      await client.query(sql, [
        row.source,
        row.source_id,
        row.address,
        row.city,
        row.state,
        row.zip_code,
        row.latitude,
        row.longitude,
        row.price,
        row.bedrooms,
        row.bathrooms,
        row.living_area,
        row.lot_size,
        row.year_built,
        row.property_type,
        row.days_on_market,
        row.status,
        row.listing_url,
        row.raw_json,
      ]);
      if (isUpdate) updated++;
      else inserted++;
    }
    return { inserted, updated };
  });
}

/**
 * SQL predicate keeping ONLY the property types we invest in: single-family
 * (SFH) and duplex / triplex / quad (which Zillow reports as MULTI_FAMILY).
 * Everything else — condo, apartment, townhouse, manufactured, lot/land, and
 * any unknown or blank type — is excluded. This is a strict allow-list, applied
 * wherever for-sale inventory is read (grading and price/sqft comps) so only
 * these types ever reach a grade or a comp median. `col` is the (optionally
 * table-qualified) property_type column.
 */
export function investableTypesOnly(col = 'property_type'): string {
  const c = `LOWER(COALESCE(${col}, ''))`;
  return (
    `(${c} LIKE '%single%family%'` +
    ` OR ${c} LIKE '%sfh%'` +
    ` OR ${c} LIKE '%multi%'` +
    ` OR ${c} LIKE '%duplex%'` +
    ` OR ${c} LIKE '%triplex%'` +
    ` OR ${c} LIKE '%quad%'` +
    ` OR ${c} LIKE '%plex%'` +
    ` OR ${c} LIKE '%two%family%'` +
    ` OR ${c} LIKE '%three%family%'` +
    ` OR ${c} LIKE '%four%family%')`
  );
}

export async function countListings(): Promise<number> {
  const row = await queryOne<{ n: string }>(
    'SELECT COUNT(*) AS n FROM listings',
  );
  return Number(row?.n ?? 0);
}

/** A listing row as read back from the DB (subset used by the scorer). */
export interface ListingRow {
  id: number;
  source: string;
  source_id: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  latitude: number | null;
  longitude: number | null;
  price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  living_area: number | null;
  property_type: string | null;
}

const LISTING_COLUMNS = `
  id, source, source_id, address, city, state, zip_code,
  latitude, longitude, price, bedrooms, bathrooms, living_area, property_type
`;

export async function getListingById(id: number): Promise<ListingRow | null> {
  return queryOne<ListingRow>(
    `SELECT ${LISTING_COLUMNS} FROM listings WHERE id = $1`,
    [id],
  );
}

/** All listings (optionally filtered to a zip) — used for batch grading.
 * Only SFH / Duplex / Triplex / Quad are returned; all other types are excluded
 * so they're never graded. */
export async function getListings(zipCode?: string): Promise<ListingRow[]> {
  if (zipCode) {
    return query<ListingRow>(
      `SELECT ${LISTING_COLUMNS} FROM listings
       WHERE zip_code = $1 AND ${investableTypesOnly()}`,
      [zipCode],
    );
  }
  return query<ListingRow>(
    `SELECT ${LISTING_COLUMNS} FROM listings WHERE ${investableTypesOnly()}`,
  );
}

/**
 * Price-per-sqft of every comparable listing in a zip with the same bed and
 * bath count (and a valid price + living area). Used to compute the zip median.
 * When `requireBaths` is false, matches on bedrooms only (fallback for thin data).
 */
export async function comparablePricePerSqft(
  zipCode: string,
  bedrooms: number,
  bathrooms: number,
  requireBaths = true,
): Promise<number[]> {
  const sql = `
    SELECT price, living_area FROM listings
    WHERE zip_code = $1 AND bedrooms = $2
      ${requireBaths ? 'AND bathrooms = $3' : ''}
      AND price IS NOT NULL AND price > 0
      AND living_area IS NOT NULL AND living_area > 0
      AND ${investableTypesOnly()}
  `;
  const params = requireBaths ? [zipCode, bedrooms, bathrooms] : [zipCode, bedrooms];
  const rows = await query<{ price: number; living_area: number }>(sql, params);
  return rows.map((r) => r.price / r.living_area);
}
