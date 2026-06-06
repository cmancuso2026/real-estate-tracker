import { config } from '../config.js';
import { getDb } from '../db/index.js';
import type { Letter } from './types.js';

/**
 * Rental-prevalence component. Pulls % renter-occupied housing units for a zip
 * (ZCTA) from the Census ACS 5-year API (table B25003: tenure by occupied
 * units). Cached per zip (90-day TTL — ACS updates annually).
 *
 * B25003_001E = total occupied units, B25003_003E = renter-occupied units.
 */

const CACHE_TTL_DAYS = 90;
const ACS_YEAR = '2022';

export async function getRenterOccupiedPct(
  zipCode: string,
): Promise<number | null> {
  const cached = readCache(zipCode);
  if (cached != null) return cached;

  const result = await fetchAcsTenure(zipCode);
  if (result == null) return null;

  writeCache(zipCode, result.renterPct, result.totalOccupied);
  return result.renterPct;
}

interface AcsTenure {
  renterPct: number;
  totalOccupied: number;
}

async function fetchAcsTenure(zipCode: string): Promise<AcsTenure | null> {
  const url = new URL(`https://api.census.gov/data/${ACS_YEAR}/acs/acs5`);
  url.searchParams.set('get', 'B25003_001E,B25003_003E');
  url.searchParams.set('for', `zip code tabulation area:${zipCode}`);
  if (config.censusApiKey) url.searchParams.set('key', config.censusApiKey);

  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`Census ACS fetch failed: HTTP ${res.status}`);
  }

  // Response is a 2D array: [header row, data row].
  const rows = (await res.json()) as string[][];
  const data = rows[1];
  if (!data) return null;

  const totalOccupied = Number(data[0]);
  const renterOccupied = Number(data[1]);
  if (!Number.isFinite(totalOccupied) || totalOccupied <= 0) return null;

  const renterPct = round2((renterOccupied / totalOccupied) * 100);
  return { renterPct, totalOccupied };
}

/** Rental-prevalence grade: A 60%+, B 50-60%, C 40-50%, D 30-40%, F below 30%. */
export function gradeRentalPrevalence(renterPct: number): Letter {
  if (renterPct >= 60) return 'A';
  if (renterPct >= 50) return 'B';
  if (renterPct >= 40) return 'C';
  if (renterPct >= 30) return 'D';
  return 'F';
}

function readCache(zipCode: string): number | null {
  const row = getDb()
    .prepare(
      `SELECT renter_occupied_pct FROM census_cache
       WHERE zip_code = ? AND fetched_at > datetime('now', ?)`,
    )
    .get(zipCode, `-${CACHE_TTL_DAYS} days`) as
    | { renter_occupied_pct: number | null }
    | undefined;
  return row && row.renter_occupied_pct != null ? row.renter_occupied_pct : null;
}

function writeCache(
  zipCode: string,
  renterPct: number,
  totalOccupied: number,
): void {
  getDb()
    .prepare(
      `INSERT INTO census_cache (zip_code, renter_occupied_pct, total_occupied, fetched_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT (zip_code) DO UPDATE SET
         renter_occupied_pct = excluded.renter_occupied_pct,
         total_occupied = excluded.total_occupied,
         fetched_at = datetime('now')`,
    )
    .run(zipCode, renterPct, totalOccupied);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
