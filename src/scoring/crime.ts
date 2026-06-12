import { queryOne, execute, NOW_UTC, nowOffsetText } from '../db/index.js';
import type { Letter } from './types.js';

/**
 * Crime component, sourced from the Miami-Dade Open Data portal
 * (opendata.miamidade.gov). The portal hosts an Esri crime-index layer by
 * neighborhood — `crime_by_neighborhood` — where CRMCYTOTC is a total crime
 * index (100 = US national average; higher = more crime).
 *
 * The layer is keyed by neighborhood, not zip, so we map it to our target zips
 * geographically: for each zip we spatially query the neighborhoods within
 * RADIUS_MILES of the zip's centroid and average their crime index. The
 * comparison baseline is the Miami-Dade median — the median crime index across
 * every neighborhood in the layer. A zip with no neighborhoods in range (e.g.
 * Bal Harbour, out on the barrier island, beyond the layer's coverage) falls
 * back to the county median, i.e. a neutral crime grade.
 *
 * Per-zip results are cached in crime_zip_cache and refreshed weekly
 * (REFRESH_DAYS) so re-grading doesn't re-hit the service for every property.
 */

// Miami-Dade Open Data — Esri "crime index by neighborhood" feature layer.
const CRIME_LAYER_QUERY =
  'https://services.arcgis.com/aScBVpZOvioggfOZ/arcgis/rest/services/crime_by_neighborhood/FeatureServer/0/query';
const CRIME_FIELD = 'CRMCYTOTC';
const REFRESH_DAYS = 7; // weekly refresh
const RADIUS_MILES = 3; // neighborhoods within this distance of a zip's centroid

/**
 * Centroids (WGS84 lat/lon) for the target zips. The crime layer covers
 * central/NE Miami-Dade; zips outside that footprint resolve to no neighbors
 * and fall back to the county median.
 */
const ZIP_CENTROIDS: Record<string, { lat: number; lon: number }> = {
  '33147': { lat: 25.846, lon: -80.224 }, // West Little River / Brownsville
  '33161': { lat: 25.893, lon: -80.183 }, // North Miami
  '33168': { lat: 25.888, lon: -80.207 }, // North Miami / Miami Gardens edge
  '33154': { lat: 25.888, lon: -80.123 }, // Bal Harbour / Surfside (island)
  '33167': { lat: 25.88, lon: -80.235 }, // NW Miami-Dade / Miami Gardens edge
};

export interface CrimeResult {
  /** Label for the area graded (the zip code). */
  city: string;
  /** Combined crime index for the zip (avg of nearby neighborhoods, or median). */
  crimeIndex: number;
  /** Miami-Dade median crime index — the comparison baseline. */
  baseline: number;
}

// Per-run memo so grading a batch computes the county median only once.
let countyMedianMemo: Promise<number | null> | null = null;

/**
 * Crime result for a zip: the zip's crime index vs the Miami-Dade median.
 * Returns null (so the grader redistributes the crime weight) only when the zip
 * isn't in our coverage map or the service and baseline are both unavailable.
 */
export async function getCrimeIndex(
  zipCode: string,
): Promise<CrimeResult | null> {
  const zip = (zipCode ?? '').trim();

  const cached = await readCache(zip);
  if (cached) return cached;

  const centroid = ZIP_CENTROIDS[zip];
  if (!centroid) return null; // outside our coverage map

  const baseline = await getCountyMedian();
  if (baseline == null) return null; // no baseline -> can't grade crime

  const local = await fetchZipIndex(centroid.lat, centroid.lon);
  // Fall back to the county median when no neighborhood data is in range.
  const crimeIndex = local?.index ?? baseline;

  const result: CrimeResult = {
    city: zip,
    crimeIndex: round2(crimeIndex),
    baseline: round2(baseline),
  };
  await writeCache(zip, result, local?.count ?? 0);
  return result;
}

/**
 * Diagnostic view: every target zip with its crime index, the neighborhood
 * count backing it (0 = fell back to the median), and the county median.
 * Powers `npm run crime:check`.
 */
export async function inspectCrimeCoverage(): Promise<{
  zips: Array<{
    zip: string;
    crimeIndex: number | null;
    neighborhoods: number;
    fellBack: boolean;
  }>;
  median: number | null;
}> {
  const median = await getCountyMedian();
  const zips = await Promise.all(
    Object.entries(ZIP_CENTROIDS).map(async ([zip, c]) => {
      if (median == null) {
        return { zip, crimeIndex: null, neighborhoods: 0, fellBack: false };
      }
      const local = await fetchZipIndex(c.lat, c.lon);
      return {
        zip,
        crimeIndex: round2(local?.index ?? median),
        neighborhoods: local?.count ?? 0,
        fellBack: local == null,
      };
    }),
  );
  return { zips, median: median == null ? null : round2(median) };
}

// --- Miami-Dade Open Data fetching -----------------------------------------

/** The Miami-Dade median crime index across every neighborhood in the layer. */
async function getCountyMedian(): Promise<number | null> {
  if (countyMedianMemo) return countyMedianMemo;
  countyMedianMemo = (async () => {
    const data = await fetchJson({
      where: `${CRIME_FIELD} > 0`,
      outFields: CRIME_FIELD,
      returnGeometry: 'false',
      f: 'json',
    });
    const values = featureValues(data);
    return values.length ? median(values) : null;
  })();
  return countyMedianMemo;
}

/**
 * Average crime index of the neighborhoods within RADIUS_MILES of a point, plus
 * the count backing it. Returns null when no neighborhoods are in range.
 */
async function fetchZipIndex(
  lat: number,
  lon: number,
): Promise<{ index: number; count: number } | null> {
  const data = await fetchJson({
    where: '1=1',
    geometry: JSON.stringify({
      x: lon,
      y: lat,
      spatialReference: { wkid: 4326 },
    }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    distance: String(RADIUS_MILES),
    units: 'esriSRUnit_StatuteMile',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: CRIME_FIELD,
    returnGeometry: 'false',
    f: 'json',
  });
  const values = featureValues(data);
  if (values.length === 0) return null;
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  return { index: avg, count: values.length };
}

/** Pull the CRMCYTOTC values out of an ArcGIS query response. */
function featureValues(data: unknown): number[] {
  const features = (data as { features?: Array<{ attributes?: Record<string, unknown> }> })
    ?.features;
  if (!Array.isArray(features)) return [];
  return features
    .map((f) => Number(f.attributes?.[CRIME_FIELD]))
    .filter((v) => Number.isFinite(v) && v > 0);
}

async function fetchJson(
  params: Record<string, string>,
): Promise<unknown | null> {
  try {
    const url = `${CRIME_LAYER_QUERY}?${new URLSearchParams(params).toString()}`;
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && typeof data === 'object' && 'error' in data) return null;
    return data;
  } catch {
    return null;
  }
}

// --- Grading ----------------------------------------------------------------

/**
 * Crime grade. `crimeIndex` vs `baseline` as a percentage above the baseline
 * (negative = safer). Multi-family is graded one full letter more lenient than
 * single-family, per spec.
 */
export function gradeCrime(
  crimeIndex: number,
  baseline: number,
  isMultiFamily: boolean,
): Letter {
  const pctAbove = ((crimeIndex - baseline) / baseline) * 100;

  if (isMultiFamily) {
    // A 40%+ below, B at baseline, C 20-40% above, D 40%+ above, F 60%+ above.
    if (pctAbove <= -40) return 'A';
    if (pctAbove < 20) return 'B';
    if (pctAbove < 40) return 'C';
    if (pctAbove < 60) return 'D';
    return 'F';
  }

  // SFH: A 40%+ below, B 20-40% below, C at baseline, D 20-40% above, F 40%+ above.
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

// --- cache (crime_zip_cache, weekly TTL) ------------------------------------

async function readCache(zip: string): Promise<CrimeResult | null> {
  const row = await queryOne<{
    crime_index: number | null;
    baseline: number | null;
  }>(
    `SELECT crime_index, baseline FROM crime_zip_cache
     WHERE zip_code = $1 AND fetched_at > ${nowOffsetText('days', '$2')}`,
    [zip, REFRESH_DAYS],
  );
  if (row && row.crime_index != null && row.baseline != null) {
    return { city: zip, crimeIndex: row.crime_index, baseline: row.baseline };
  }
  return null;
}

async function writeCache(
  zip: string,
  result: CrimeResult,
  neighborhoods: number,
): Promise<void> {
  await execute(
    `INSERT INTO crime_zip_cache (zip_code, crime_index, baseline, neighborhoods, source, fetched_at)
     VALUES ($1, $2, $3, $4, 'miami_dade_open_data', ${NOW_UTC})
     ON CONFLICT (zip_code) DO UPDATE SET
       crime_index   = excluded.crime_index,
       baseline      = excluded.baseline,
       neighborhoods = excluded.neighborhoods,
       source        = excluded.source,
       fetched_at    = ${NOW_UTC}`,
    [zip, result.crimeIndex, result.baseline, neighborhoods],
  );
}

// --- helpers ----------------------------------------------------------------

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
