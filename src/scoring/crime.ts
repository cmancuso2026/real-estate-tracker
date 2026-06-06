import { config } from '../config.js';
import { getDb } from '../db/index.js';
import type { Letter } from './types.js';

/**
 * Crime component. We derive a per-zip crime index from SpotCrime (count of
 * recent incidents around the property's coordinates) and grade it relative to
 * the configured Miami-Dade county median.
 *
 * Both a SpotCrime key AND a county median must be configured; otherwise this
 * returns null and the grader redistributes the component's weight. Results are
 * cached per zip (30-day TTL) so batch grading doesn't re-hit the API.
 */

const CACHE_TTL_DAYS = 30;
const SPOTCRIME_RADIUS = 0.05; // ~3.5 mi bounding radius

export interface CrimeResult {
  crimeIndex: number;
  countyMedian: number;
}

export async function getCrimeIndex(
  zipCode: string,
  latitude: number | null,
  longitude: number | null,
): Promise<CrimeResult | null> {
  const countyMedian = config.miamiDadeCrimeMedian;
  if (countyMedian == null) return null; // no baseline -> can't grade relatively

  const cached = readCache(zipCode);
  if (cached) return { crimeIndex: cached, countyMedian };

  if (!config.spotcrimeApiKey || latitude == null || longitude == null) {
    return null;
  }

  const index = await fetchSpotcrimeIndex(latitude, longitude);
  if (index == null) return null;

  writeCache(zipCode, index, countyMedian);
  return { crimeIndex: index, countyMedian };
}

async function fetchSpotcrimeIndex(
  lat: number,
  lon: number,
): Promise<number | null> {
  const url = new URL('https://api.spotcrime.com/crimes.json');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('radius', String(SPOTCRIME_RADIUS));
  url.searchParams.set('key', config.spotcrimeApiKey);

  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`SpotCrime fetch failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { crimes?: unknown[] };
  if (!Array.isArray(data.crimes)) return null;
  return data.crimes.length; // recent-incident count = crime index
}

/**
 * Crime grade. `crimeIndex` vs `countyMedian` as a percentage above the median
 * (negative = safer). Multi-family is graded one full letter more lenient than
 * single-family, per spec.
 */
export function gradeCrime(
  crimeIndex: number,
  countyMedian: number,
  isMultiFamily: boolean,
): Letter {
  const pctAbove = ((crimeIndex - countyMedian) / countyMedian) * 100;

  if (isMultiFamily) {
    // A 40%+ below, B at median, C 20-40% above, D 40%+ above, F 60%+ above.
    if (pctAbove <= -40) return 'A';
    if (pctAbove < 20) return 'B';
    if (pctAbove < 40) return 'C';
    if (pctAbove < 60) return 'D';
    return 'F';
  }

  // SFH: A 40%+ below, B 20-40% below, C at median, D 20-40% above, F 40%+ above.
  if (pctAbove <= -40) return 'A';
  if (pctAbove <= -20) return 'B';
  if (pctAbove < 20) return 'C';
  if (pctAbove < 40) return 'D';
  return 'F';
}

/** Heuristic: is this property type a duplex / multi-family dwelling? */
export function isMultiFamily(propertyType: string | null): boolean {
  if (!propertyType) return false;
  const t = propertyType.toLowerCase();
  return /multi|duplex|triplex|fourplex|quadplex|two.?family|three.?family|four.?family/.test(
    t,
  );
}

function readCache(zipCode: string): number | null {
  const row = getDb()
    .prepare(
      `SELECT crime_index FROM crime_cache
       WHERE zip_code = ? AND fetched_at > datetime('now', ?)`,
    )
    .get(zipCode, `-${CACHE_TTL_DAYS} days`) as
    | { crime_index: number | null }
    | undefined;
  return row && row.crime_index != null ? row.crime_index : null;
}

function writeCache(zipCode: string, index: number, countyMedian: number): void {
  getDb()
    .prepare(
      `INSERT INTO crime_cache (zip_code, crime_index, county_median, fetched_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT (zip_code) DO UPDATE SET
         crime_index = excluded.crime_index,
         county_median = excluded.county_median,
         fetched_at = datetime('now')`,
    )
    .run(zipCode, index, countyMedian);
}
