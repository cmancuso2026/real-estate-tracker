import { query, queryOne, withTransaction, NOW_UTC } from './index.js';
import type { RentalRecord, UpsertResult } from './types.js';

/**
 * Insert rental comps, deduplicating on (source, source_id). Mirrors
 * upsertListings: refresh mutable fields, preserve first_seen_at, bump
 * last_seen_at, probing existence first to report insert vs. update counts.
 */
export async function upsertRentals(
  records: RentalRecord[],
): Promise<UpsertResult> {
  const sql = `
    INSERT INTO rentals (
      source, source_id, address, city, state, zip_code,
      latitude, longitude, rent, bedrooms, bathrooms, living_area,
      property_type, listed_date, raw_json
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11, $12,
      $13, $14, $15
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
      last_seen_at  = ${NOW_UTC}
  `;

  return withTransaction(async (client) => {
    let inserted = 0;
    let updated = 0;
    for (const row of records) {
      const existing = await client.query(
        'SELECT 1 FROM rentals WHERE source = $1 AND source_id = $2',
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
        row.rent,
        row.bedrooms,
        row.bathrooms,
        row.living_area,
        row.property_type,
        row.listed_date,
        row.raw_json,
      ]);
      if (isUpdate) updated++;
      else inserted++;
    }
    return { inserted, updated };
  });
}

export async function countRentals(): Promise<number> {
  const row = await queryOne<{ n: string }>('SELECT COUNT(*) AS n FROM rentals');
  return Number(row?.n ?? 0);
}

/**
 * The most recent `last_seen_at` for any rental comp in a zip — i.e. when the
 * zip's comps were last refreshed from Rentcast — as a UTC datetime string, or
 * null if the zip has none yet. Used to throttle Rentcast to a weekly cadence.
 */
export async function rentalsLastRefreshedAt(
  zipCode: string,
): Promise<string | null> {
  const row = await queryOne<{ ts: string | null }>(
    'SELECT MAX(last_seen_at) AS ts FROM rentals WHERE zip_code = $1',
    [zipCode],
  );
  return row?.ts ?? null;
}

/**
 * Monthly rents of comparable rental comps in a zip with the same bedroom
 * count (whole-property rent, as stored). `propertyType` narrows further when
 * provided. Returns rents only where a positive value exists.
 */
export async function comparableRents(
  zipCode: string,
  bedrooms: number,
  propertyType?: string | null,
): Promise<number[]> {
  const sql = `
    SELECT rent FROM rentals
    WHERE zip_code = $1 AND bedrooms = $2
      ${propertyType ? 'AND property_type = $3' : ''}
      AND rent IS NOT NULL AND rent > 0
  `;
  const params = propertyType ? [zipCode, bedrooms, propertyType] : [zipCode, bedrooms];
  const rows = await query<{ rent: number }>(sql, params);
  return rows.map((r) => r.rent);
}
