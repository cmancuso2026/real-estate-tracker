import { getDb } from './index.js';
import type { ListingRecord, UpsertResult } from './types.js';

/**
 * Insert listings, deduplicating on (source, source_id). On conflict we refresh
 * the mutable fields (price, status, days_on_market, ...) and bump last_seen_at,
 * preserving the original first_seen_at. SQLite's `changes` can't distinguish
 * insert vs. update on an upsert, so we probe existence first inside a txn.
 */
export function upsertListings(records: ListingRecord[]): UpsertResult {
  const db = getDb();

  const exists = db.prepare<[string, string]>(
    'SELECT 1 FROM listings WHERE source = ? AND source_id = ?',
  );

  const stmt = db.prepare(`
    INSERT INTO listings (
      source, source_id, address, city, state, zip_code,
      latitude, longitude, price, bedrooms, bathrooms, living_area,
      lot_size, year_built, property_type, days_on_market, status,
      listing_url, raw_json
    ) VALUES (
      @source, @source_id, @address, @city, @state, @zip_code,
      @latitude, @longitude, @price, @bedrooms, @bathrooms, @living_area,
      @lot_size, @year_built, @property_type, @days_on_market, @status,
      @listing_url, @raw_json
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
      last_seen_at   = datetime('now'),
      updated_at     = datetime('now')
  `);

  const run = db.transaction((rows: ListingRecord[]): UpsertResult => {
    let inserted = 0;
    let updated = 0;
    for (const row of rows) {
      const isUpdate = exists.get(row.source, row.source_id) !== undefined;
      stmt.run(row);
      if (isUpdate) updated++;
      else inserted++;
    }
    return { inserted, updated };
  });

  return run(records);
}

/**
 * SQL predicate that excludes apartments and condominiums (case-insensitive,
 * matching CONDO/Condo/condominium and APARTMENT/Apartment). We only invest in
 * SFH / Duplex / Triplex / Quad, so this is applied wherever for-sale inventory
 * is read — grading and price/sqft comps — so those types never reach a grade
 * or skew a comp median. `col` is the (optionally table-qualified) column.
 */
export function excludeApartmentsCondos(col = 'property_type'): string {
  return (
    `LOWER(COALESCE(${col}, '')) NOT LIKE '%apartment%' ` +
    `AND LOWER(COALESCE(${col}, '')) NOT LIKE '%condo%'`
  );
}

export function countListings(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM listings').get() as {
    n: number;
  };
  return row.n;
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

export function getListingById(id: number): ListingRow | null {
  const row = getDb()
    .prepare(`SELECT ${LISTING_COLUMNS} FROM listings WHERE id = ?`)
    .get(id) as ListingRow | undefined;
  return row ?? null;
}

/** All listings (optionally filtered to a zip) — used for batch grading.
 * Apartments and condominiums are excluded so they're never graded. */
export function getListings(zipCode?: string): ListingRow[] {
  const db = getDb();
  if (zipCode) {
    return db
      .prepare(
        `SELECT ${LISTING_COLUMNS} FROM listings
         WHERE zip_code = ? AND ${excludeApartmentsCondos()}`,
      )
      .all(zipCode) as ListingRow[];
  }
  return db
    .prepare(
      `SELECT ${LISTING_COLUMNS} FROM listings WHERE ${excludeApartmentsCondos()}`,
    )
    .all() as ListingRow[];
}

/**
 * Price-per-sqft of every comparable listing in a zip with the same bed and
 * bath count (and a valid price + living area). Used to compute the zip median.
 * When `requireBaths` is false, matches on bedrooms only (fallback for thin data).
 */
export function comparablePricePerSqft(
  zipCode: string,
  bedrooms: number,
  bathrooms: number,
  requireBaths = true,
): number[] {
  const db = getDb();
  const sql = `
    SELECT price, living_area FROM listings
    WHERE zip_code = ? AND bedrooms = ?
      ${requireBaths ? 'AND bathrooms = ?' : ''}
      AND price IS NOT NULL AND price > 0
      AND living_area IS NOT NULL AND living_area > 0
      AND ${excludeApartmentsCondos()}
  `;
  const rows = (
    requireBaths
      ? db.prepare(sql).all(zipCode, bedrooms, bathrooms)
      : db.prepare(sql).all(zipCode, bedrooms)
  ) as Array<{ price: number; living_area: number }>;
  return rows.map((r) => r.price / r.living_area);
}
