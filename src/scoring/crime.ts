import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { cityForZip, TARGET_CITIES } from './zip-cities.js';
import type { Letter } from './types.js';

/**
 * Crime component, sourced from the FBI Crime Data Explorer (CDE) API
 * (https://api.usa.gov/crime/fbi/cde). No key is strictly required — the shared
 * "DEMO_KEY" works out of the box (configurable via FBI_API_KEY for a higher
 * rate limit).
 *
 * The FBI publishes crime by law-enforcement agency (a city police department),
 * not by zip code. So rather than grade every property against the whole
 * state's rate, we map each target zip to its Miami-Dade municipality
 * (see zip-cities.ts), resolve that city's police agency (ORI) from the CDE
 * agency list, and use the agency's combined (violent + property) crime rate
 * per 100k people.
 *
 * The comparison baseline is the **median** of those same Miami-Dade cities'
 * rates, recomputed automatically from whatever city data we can fetch — no
 * hand-configured county median. A city below the local median grades well; one
 * above it grades poorly. All numbers come from the same source and the same
 * year basis, so they're directly comparable.
 *
 * Results are cached per city (30-day TTL) in crime_cache and memoized within a
 * process run, so batch grading hits the FBI API at most once per city.
 */

const CACHE_TTL_DAYS = 30;
const CDE_BASE = 'https://api.usa.gov/crime/fbi/cde';
const STATE_ABBR = 'FL';

/** FBI agency data lags ~1-2 years; request a window and use the latest year. */
const YEARS_BACK = 5;

/** Series names in CDE payloads that are aggregates, not the agency itself. */
const AGGREGATE_SERIES = /united states|nationwide|national|florida|state/i;

export interface CrimeResult {
  /** The municipality this property's zip maps to. */
  city: string;
  /** City combined crime rate per 100k (violent + property). */
  crimeIndex: number;
  /** Median of the tracked Miami-Dade cities' rates — the comparison baseline. */
  baseline: number;
}

interface CityRate {
  ori: string;
  rate: number;
}

// Per-run memos so grading a batch doesn't refetch the agency list, a city's
// rate, or the derived county median.
let agencyListMemo: Promise<AgencyRecord[]> | null = null;
const cityRateMemo = new Map<string, Promise<CityRate | null>>();
let countyMedianMemo: Promise<number | null> | null = null;

/**
 * Crime result for a zip: the zip's city rate vs the Miami-Dade median. Returns
 * null (so the grader redistributes the crime weight) when the zip isn't in our
 * coverage area, the city has no resolvable agency, or the API is unavailable.
 */
export async function getCrimeIndex(
  zipCode: string,
): Promise<CrimeResult | null> {
  const city = cityForZip(zipCode);
  if (!city) return null; // zip outside our Miami-Dade coverage map

  const [cityRate, baseline] = await Promise.all([
    getCityRate(city),
    getCountyMedian(),
  ]);
  if (cityRate == null || baseline == null) return null;

  return { city, crimeIndex: cityRate.rate, baseline };
}

/**
 * Diagnostic view of the crime data: every tracked city with its resolved FBI
 * agency (ORI) and rate, plus the derived Miami-Dade median. Used by the
 * `crime:check` script to verify city-level fetching end to end.
 */
export async function inspectCrimeCoverage(): Promise<{
  cities: Array<{ city: string; ori: string | null; rate: number | null }>;
  median: number | null;
}> {
  const cities = await Promise.all(
    TARGET_CITIES.map(async (city) => {
      const r = await getCityRate(city);
      return { city, ori: r?.ori ?? null, rate: r?.rate ?? null };
    }),
  );
  const med = await getCountyMedian();
  return { cities, median: med };
}

/** The median crime rate across all tracked cities that returned data. */
async function getCountyMedian(): Promise<number | null> {
  if (countyMedianMemo) return countyMedianMemo;
  countyMedianMemo = (async () => {
    const rates = await Promise.all(TARGET_CITIES.map((c) => getCityRate(c)));
    const values = rates
      .filter((r): r is CityRate => r != null)
      .map((r) => r.rate)
      .sort((a, b) => a - b);
    if (values.length === 0) return null;
    return median(values);
  })();
  return countyMedianMemo;
}

/** A city's combined crime rate per 100k, from cache or the FBI API. */
async function getCityRate(city: string): Promise<CityRate | null> {
  const memoized = cityRateMemo.get(city);
  if (memoized) return memoized;

  const promise = (async (): Promise<CityRate | null> => {
    const cached = readCache(city);
    if (cached) return cached;

    const ori = await resolveOri(city);
    if (!ori) return null; // no municipal police agency (e.g. unincorporated)

    const rate = await fetchAgencyCrimeRate(ori);
    if (rate == null) return null;

    const result = { ori, rate };
    writeCache(city, result);
    return result;
  })();

  cityRateMemo.set(city, promise);
  return promise;
}

// --- FBI agency resolution --------------------------------------------------

interface AgencyRecord {
  ori: string;
  agency_name: string;
  agency_type_name?: string;
}

/** Map a city to its police-agency ORI via the CDE state agency list. */
async function resolveOri(city: string): Promise<string | null> {
  const agencies = await getAgencies();
  const target = city.toLowerCase().trim();

  // Prefer an exact municipal match: strip a trailing "Police Department" /
  // "Department" / "Police" and compare the remainder to the city name. This
  // keeps "Miami" from matching "Miami Gardens", "Miami Beach", "North Miami",
  // etc. — each of which is its own agency.
  for (const a of agencies) {
    const base = (a.agency_name ?? '')
      .toLowerCase()
      .replace(/\s+(police department|department|police)\s*$/, '')
      .trim();
    if (base === target) return a.ori;
  }
  return null;
}

/** Fetch (once per run) the list of Florida law-enforcement agencies. */
async function getAgencies(): Promise<AgencyRecord[]> {
  if (agencyListMemo) return agencyListMemo;
  agencyListMemo = (async () => {
    const url = new URL(`${CDE_BASE}/agency/byStateAbbr/${STATE_ABBR}`);
    url.searchParams.set('API_KEY', config.fbiApiKey);
    const data = await fetchJson(url);
    return collectAgencies(data);
  })();
  return agencyListMemo;
}

/**
 * Pull every agency record out of the payload regardless of envelope. The CDE
 * has returned this list as a bare array, wrapped under `results`/`data`, and
 * grouped into an object keyed by county — so we recurse and collect any object
 * carrying a string `ori`.
 */
function collectAgencies(node: unknown, out: AgencyRecord[] = []): AgencyRecord[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) collectAgencies(item, out);
    return out;
  }
  const o = node as Record<string, unknown>;
  if (typeof o.ori === 'string') {
    out.push({
      ori: o.ori,
      agency_name: String(o.agency_name ?? ''),
      agency_type_name:
        typeof o.agency_type_name === 'string' ? o.agency_type_name : undefined,
    });
    return out;
  }
  for (const value of Object.values(o)) collectAgencies(value, out);
  return out;
}

// --- FBI agency crime rate --------------------------------------------------

/**
 * Combined (violent + property) crime rate per 100k for an agency, using the
 * latest year the FBI reports. We sum the two offense categories' per-100k
 * rates, computing each from reported counts and population when the payload
 * doesn't already expose a rate. Returns null on any network/parse failure.
 */
async function fetchAgencyCrimeRate(ori: string): Promise<number | null> {
  const [violent, property] = await Promise.all([
    fetchOffenseRate(ori, 'violent-crime'),
    fetchOffenseRate(ori, 'property-crime'),
  ]);
  if (violent == null && property == null) return null;
  return round2((violent ?? 0) + (property ?? 0));
}

/** Per-100k rate for one offense category for an agency (latest year). */
async function fetchOffenseRate(
  ori: string,
  offense: string,
): Promise<number | null> {
  const url = new URL(
    `${CDE_BASE}/summarized/agency/${ori}/${offense}/${fromYear()}/${toYear()}`,
  );
  url.searchParams.set('API_KEY', config.fbiApiKey);
  const data = await fetchJson(url);
  if (!data) return null;

  // Prefer a precomputed rate series if the payload exposes one.
  const rateMap = pickSeries((data as any)?.offenses?.rates);
  const directRate = latestValue(rateMap);
  if (directRate != null) return directRate;

  // Otherwise derive rate = reported count / population * 100k for the latest
  // year both series share.
  const countMap = pickSeries(
    (data as any)?.offenses?.actuals ?? (data as any)?.actuals,
  );
  const popMap = pickSeries(
    (data as any)?.populations?.population ??
      (data as any)?.populations ??
      (data as any)?.population,
  );
  if (!countMap || !popMap) return null;

  const year = latestCommonYear(countMap, popMap);
  if (!year) return null;
  const count = Number(countMap[year]);
  const pop = Number(popMap[year]);
  if (!Number.isFinite(count) || !Number.isFinite(pop) || pop <= 0) return null;
  return round2((count / pop) * 100_000);
}

/**
 * Given a CDE `{ seriesName: { year: value } }` object, return the year-map for
 * the agency itself — i.e. skip aggregate series like "United States" or the
 * state. When several non-aggregate series exist we take the first; in practice
 * an agency payload carries one agency series.
 */
function pickSeries(obj: unknown): Record<string, number> | null {
  if (!obj || typeof obj !== 'object') return null;
  const entries = Object.entries(obj as Record<string, unknown>);
  const named = entries.filter(
    ([name, v]) => !AGGREGATE_SERIES.test(name) && isYearMap(v),
  );
  const pick = named[0] ?? entries.find(([, v]) => isYearMap(v));
  return pick ? (pick[1] as Record<string, number>) : null;
}

/** Latest-year value from a `{ year: number }` map, or null. */
function latestValue(map: Record<string, number> | null): number | null {
  if (!map) return null;
  for (const year of yearsDesc(map)) {
    const v = Number(map[year]);
    if (Number.isFinite(v) && v > 0) return round2(v);
  }
  return null;
}

/** The most recent year present in both maps, or null. */
function latestCommonYear(
  a: Record<string, number>,
  b: Record<string, number>,
): string | null {
  const inB = new Set(yearsDesc(b));
  for (const year of yearsDesc(a)) {
    if (inB.has(year)) return year;
  }
  return null;
}

function yearsDesc(map: Record<string, unknown>): string[] {
  return Object.keys(map)
    .filter((k) => /^\d{4}$/.test(k))
    .sort()
    .reverse();
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

async function fetchJson(url: URL): Promise<unknown> {
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return await res.json();
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

// --- helpers ----------------------------------------------------------------

function fromYear(): number {
  return new Date().getFullYear() - YEARS_BACK;
}

function toYear(): number {
  return new Date().getFullYear() - 1;
}

function median(sortedAsc: number[]): number {
  const n = sortedAsc.length;
  const mid = Math.floor(n / 2);
  const hi = sortedAsc[mid] ?? 0;
  const m = n % 2 === 0 ? ((sortedAsc[mid - 1] ?? hi) + hi) / 2 : hi;
  return round2(m);
}

function readCache(city: string): CityRate | null {
  const row = getDb()
    .prepare(
      `SELECT ori, crime_index FROM crime_cache
       WHERE city = ? AND fetched_at > datetime('now', ?)`,
    )
    .get(city, `-${CACHE_TTL_DAYS} days`) as
    | { ori: string | null; crime_index: number | null }
    | undefined;
  if (row && row.crime_index != null && row.ori) {
    return { ori: row.ori, rate: row.crime_index };
  }
  return null;
}

function writeCache(city: string, result: CityRate): void {
  getDb()
    .prepare(
      `INSERT INTO crime_cache (city, ori, crime_index, fetched_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT (city) DO UPDATE SET
         ori = excluded.ori,
         crime_index = excluded.crime_index,
         fetched_at = datetime('now')`,
    )
    .run(city, result.ori, result.rate);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
