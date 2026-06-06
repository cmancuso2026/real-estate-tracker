import { config } from '../config.js';
import { getDb } from '../db/index.js';
import type { Letter } from './types.js';

/**
 * Crime component, sourced from the FBI Crime Data Explorer (CDE) API
 * (https://api.usa.gov/crime/fbi/cde). No key is strictly required — the shared
 * "DEMO_KEY" works out of the box (configurable via FBI_API_KEY for a higher
 * rate limit).
 *
 * The FBI publishes crime by law-enforcement agency and by state/nation, not by
 * zip or coordinate, so we grade at the granularity the data actually supports:
 * a property's STATE combined (violent + property) crime rate per 100k people,
 * compared against the NATIONAL rate as the baseline. A state safely below the
 * national rate grades well; one above it grades poorly. Both numbers come from
 * the same source so they're directly comparable.
 *
 * Results are cached per zip (30-day TTL) in crime_cache and memoized per state
 * within a process run so batch grading hits the API at most once per state.
 */

const CACHE_TTL_DAYS = 30;
const CDE_BASE = 'https://api.usa.gov/crime/fbi/cde';

/** FBI estimate data lags ~1-2 years; request a window and use the latest year. */
const YEARS_BACK = 4;

export interface CrimeResult {
  /** State combined crime rate per 100k (violent + property). */
  crimeIndex: number;
  /** National combined crime rate per 100k — the comparison baseline. */
  baseline: number;
}

// Per-run memo so grading a batch of listings doesn't refetch per state/nation.
const stateRateMemo = new Map<string, number | null>();
let nationalRateMemo: number | null | undefined;

export async function getCrimeIndex(
  zipCode: string,
  state: string | null,
): Promise<CrimeResult | null> {
  const cached = readCache(zipCode);
  if (cached) return cached;

  if (!state) return null; // no state -> can't locate the property in FBI data

  const [stateRate, national] = await Promise.all([
    getStateRate(state.toUpperCase()),
    getNationalRate(),
  ]);
  if (stateRate == null || national == null) return null;

  writeCache(zipCode, stateRate, national);
  return { crimeIndex: stateRate, baseline: national };
}

async function getStateRate(state: string): Promise<number | null> {
  if (stateRateMemo.has(state)) return stateRateMemo.get(state) ?? null;
  const url = `${CDE_BASE}/summarized/estimates/state/${state}/${fromYear()}/${toYear()}`;
  const rate = await fetchCombinedRate(url);
  stateRateMemo.set(state, rate);
  return rate;
}

async function getNationalRate(): Promise<number | null> {
  if (nationalRateMemo !== undefined) return nationalRateMemo;
  const url = `${CDE_BASE}/summarized/estimates/national/${fromYear()}/${toYear()}`;
  nationalRateMemo = await fetchCombinedRate(url);
  return nationalRateMemo;
}

/**
 * Fetch a CDE estimates payload and return the latest-year combined (violent +
 * property) crime rate per 100k. Returns null on any network/parse failure so
 * the grader simply redistributes the crime weight.
 */
async function fetchCombinedRate(baseUrl: string): Promise<number | null> {
  const url = new URL(baseUrl);
  url.searchParams.set('API_KEY', config.fbiApiKey);

  let data: unknown;
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    return null;
  }

  const violent = latestYearRate(data, 'Violent Crime');
  const property = latestYearRate(data, 'Property Crime');
  if (violent == null && property == null) return null;
  return round2((violent ?? 0) + (property ?? 0));
}

/**
 * Pull the most-recent-year rate for an offense from a CDE estimates payload.
 * The documented shape is `offenses.rates[offense] = { "<year>": rate, ... }`;
 * we try that first, then fall back to a recursive search for a year->number
 * map living under a key that matches the offense name. Tolerant by design —
 * the FBI's response shape varies between endpoints/versions.
 */
function latestYearRate(data: unknown, offense: string): number | null {
  const direct = (data as any)?.offenses?.rates?.[offense];
  const map = isYearMap(direct) ? direct : findYearMap(data, offense);
  if (!map) return null;

  const years = Object.keys(map)
    .filter((k) => /^\d{4}$/.test(k))
    .sort()
    .reverse();
  for (const year of years) {
    const v = Number(map[year]);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

/** True if an object looks like { "2021": 123.4, ... } (year -> number). */
function isYearMap(obj: unknown): obj is Record<string, number> {
  if (!obj || typeof obj !== 'object') return false;
  const keys = Object.keys(obj as object);
  return (
    keys.length > 0 &&
    keys.some((k) => /^\d{4}$/.test(k)) &&
    keys.every((k) => /^\d{4}$/.test(k))
  );
}

/** Depth-first search for a year-map stored under a key matching `offense`. */
function findYearMap(
  node: unknown,
  offense: string,
): Record<string, number> | null {
  if (!node || typeof node !== 'object') return null;
  const wanted = offense.toLowerCase();
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key.toLowerCase() === wanted && isYearMap(value)) return value;
    const nested = findYearMap(value, offense);
    if (nested) return nested;
  }
  return null;
}

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

function fromYear(): number {
  return new Date().getFullYear() - YEARS_BACK;
}

function toYear(): number {
  return new Date().getFullYear() - 1;
}

function readCache(zipCode: string): CrimeResult | null {
  const row = getDb()
    .prepare(
      `SELECT crime_index, county_median FROM crime_cache
       WHERE zip_code = ? AND fetched_at > datetime('now', ?)`,
    )
    .get(zipCode, `-${CACHE_TTL_DAYS} days`) as
    | { crime_index: number | null; county_median: number | null }
    | undefined;
  if (row && row.crime_index != null && row.county_median != null) {
    return { crimeIndex: row.crime_index, baseline: row.county_median };
  }
  return null;
}

function writeCache(zipCode: string, stateRate: number, national: number): void {
  getDb()
    .prepare(
      `INSERT INTO crime_cache (zip_code, crime_index, county_median, fetched_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT (zip_code) DO UPDATE SET
         crime_index = excluded.crime_index,
         county_median = excluded.county_median,
         fetched_at = datetime('now')`,
    )
    .run(zipCode, stateRate, national);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
