import { getDb } from './index.js';
import type { RentalRecord, UpsertResult } from './types.js';

/**
 * Insert rental comps, deduplicating on (source, source_id). Mirrors
 * upsertListings: refresh mutable fields, preserve first_seen_at, bump
 * last_seen_at.
 */
export function upsertRentals(records: RentalRecord[]): UpsertResult {
  const db = getDb();

  const exists = db.prepare<[string, string]>(
    'SELECT 1 FROM rentals WHERE source = ? AND source_id = ?',
  );

  const stmt = db.prepare(`
    INSERT INTO rentals (
      source, source_id, address, city, state, zip_code,
      latitude, longitude, rent, bedrooms, bathrooms, living_area,
      property_type, listed_date, raw_json
    ) VALUES (
      @source, @source_id, @address, @city, @state, @zip_code,
      @latitude, @longitude, @rent, @bedrooms, @bathrooms, @living_area,
      @property_type, @listed_date, @raw_json
    )
    ON CONFLICT (source, source_id) DO UPDATE SET
      address       = excluded.address,
      city          = excluded.city,
      state         = excluded.state,
      zip_code      = excluded.zip_code,
      latitude      = excluded.latitude,
      longitude     = excluded.longitude,
      rent          = excluded.rent,
      bedrooms      = excluded.bedrooms,
      bathrooms     = excluded.bathrooms,
      living_area   = excluded.living_area,
      property_type = excluded.property_type,
      listed_date   = excluded.listed_date,
      raw_json      = excluded.raw_json,
      last_seen_at  = datetime('now')
  `);

  const run = db.transaction((rows: RentalRecord[]): UpsertResult => {
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

export function countRentals(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM rentals').get() as {
    n: number;
  };
  return row.n;
}

/**
 * The most recent `last_seen_at` for any rental comp in a zip — i.e. when the
 * zip's comps were last refreshed from Rentcast — as a UTC datetime string, or
 * null if the zip has none yet. Used to throttle Rentcast to a weekly cadence.
 */
export function rentalsLastRefreshedAt(zipCode: string): string | null {
  const row = getDb()
    .prepare('SELECT MAX(last_seen_at) AS ts FROM rentals WHERE zip_code = ?')
    .get(zipCode) as { ts: string | null } | undefined;
  return row?.ts ?? null;
}

/**
 * Monthly rents of comparable rental comps in a zip with the same bedroom
 * count (whole-property rent, as stored). `propertyType` narrows further when
 * provided. Returns rents only where a positive value exists.
 */
export function comparableRents(
  zipCode: string,
  bedrooms: number,
  propertyType?: string | null,
): number[] {
  const db = getDb();
  const sql = `
    SELECT rent FROM rentals
    WHERE zip_code = ? AND bedrooms = ?
      ${propertyType ? 'AND property_type = ?' : ''}
      AND rent IS NOT NULL AND rent > 0
  `;
  const rows = (
    propertyType
      ? db.prepare(sql).all(zipCode, bedrooms, propertyType)
      : db.prepare(sql).all(zipCode, bedrooms)
  ) as Array<{ rent: number }>;
  return rows.map((r) => r.rent);
}
