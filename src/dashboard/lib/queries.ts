import { getDb } from './db';
import type { Letter } from './format';
import { matchesProfileTypes } from './format';
import type { InvestorProfile } from './profile';
import { isProfileActive } from './profile';

/**
 * All read queries for the dashboard. These mirror the shapes used by the
 * tracker's own db layer (latest grade per property, price/sqft vs zip median)
 * but are reimplemented here so the dashboard stays a self-contained app and
 * doesn't pull in the tracker's env-coupled config on import.
 */

// --- shared types ----------------------------------------------------------

export interface GradedRow {
  listing_id: number;
  source: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  property_type: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  living_area: number | null;
  price: number | null;
  price_per_sqft: number | null;
  est_rent: number | null;
  /** Cash needed to close (down payment + closing) — for the available-cash filter. */
  cash_required: number | null;
  coc_return: number | null;
  monthly_cashflow: number | null;
  overall_grade: Letter;
  overall_score: number;
  first_seen_at: string;
  graded_at: string;
  listing_url: string | null;
}

export interface Assumptions {
  purchasePrice: number;
  downPaymentPct: number;
  downPayment: number;
  closingCosts: number;
  totalCashInvested: number;
  loanAmount: number;
  interestRatePct: number;
  baseRatePct: number;
  ratePremiumPct: number;
  loanTermYears: number;
  monthlyMortgage: number;
  annualMortgage: number;
  propertyTaxPct: number;
  annualPropertyTax: number;
  insurancePct: number;
  annualInsurance: number;
  monthlyRent: number;
  rentComps: number;
  vacancyFactor: number;
  annualCashFlow: number;
}

export interface ComponentBreakdown {
  key: string;
  label: string;
  weight: number;
  grade: Letter | null;
}

export interface PriceSqftComparison {
  pricePerSqft: number;
  zipMedian: number;
  /** % BELOW the median (positive = cheaper = better). */
  belowMedianPct: number;
  comps: number;
}

export interface HistoryPoint {
  graded_at: string;
  overall_grade: Letter;
  overall_score: number;
  coc_return: number | null;
}

export interface PropertyDetail extends GradedRow {
  source_id: string;
  latitude: number | null;
  longitude: number | null;
  lot_size: number | null;
  year_built: number | null;
  days_on_market: number | null;
  status: string | null;
  crime_index: number | null;
  rental_prevalence: number | null;
  interest_rate_used: number | null;
  reasoning: string | null;
  components: ComponentBreakdown[];
  assumptions: Assumptions | null;
  priceVsMedian: PriceSqftComparison | null;
  zillowUrl: string | null;
  realtorUrl: string | null;
  history: HistoryPoint[];
}

export interface RateInfo {
  effectiveRate: number;
  baseRate: number;
  premium: number;
  weekDate: string | null;
}

export interface Summary {
  totalProperties: number;
  totalGraded: number;
  gradeCounts: Record<Letter, number>;
  avgCoc: number | null;
  best: GradedRow | null;
  rate: RateInfo | null;
}

/**
 * SQL predicate keeping ONLY investable property types — single-family and
 * duplex / triplex / quad (MULTI_FAMILY) — and excluding everything else
 * (condo, apartment, townhouse, manufactured, lot, unknown). The tracker no
 * longer grades non-investable types, but legacy grade rows may still exist, so
 * the dashboard also filters at query time — they never show in results, comps,
 * or summary counts. Mirrors db/listings.ts:investableTypesOnly.
 */
function investableTypesOnly(col: string): string {
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

// --- component weights (mirror src/scoring/grades.ts) ----------------------

const COMPONENTS: Array<{ key: string; gradeCol: string; label: string; weight: number }> = [
  { key: 'coc', gradeCol: 'coc_grade', label: 'Cash-on-cash return', weight: 0.3 },
  { key: 'crime', gradeCol: 'crime_grade', label: 'Crime rate', weight: 0.25 },
  { key: 'cashflow', gradeCol: 'cashflow_grade', label: 'Monthly cash flow', weight: 0.2 },
  { key: 'sqft', gradeCol: 'sqft_grade', label: 'Price / sqft vs zip median', weight: 0.15 },
  { key: 'rental', gradeCol: 'rental_grade', label: 'Rental prevalence', weight: 0.1 },
];

// Latest grade per property (highest grades.id), joined to its listing.
const LATEST_GRADE_JOIN = `
  SELECT
    l.id AS listing_id, l.source, l.source_id, l.address, l.city, l.state,
    l.zip_code, l.latitude, l.longitude, l.price, l.bedrooms, l.bathrooms,
    l.living_area, l.lot_size, l.year_built, l.property_type, l.days_on_market,
    l.status, l.listing_url, l.first_seen_at,
    g.overall_grade, g.overall_score,
    g.coc_grade, g.cashflow_grade, g.sqft_grade, g.crime_grade, g.rental_grade,
    g.coc_return, g.monthly_cashflow, g.price_per_sqft, g.crime_index,
    g.rental_prevalence, g.interest_rate_used, g.reasoning, g.assumptions_json,
    g.graded_at
  FROM grades g
  JOIN listings l ON l.id = g.property_id
  WHERE g.id = (SELECT MAX(g2.id) FROM grades g2 WHERE g2.property_id = g.property_id)
    AND ${investableTypesOnly('l.property_type')}
`;

// --- helpers ---------------------------------------------------------------

function parseAssumptions(json: unknown): Assumptions | null {
  if (typeof json !== 'string' || !json) return null;
  try {
    return JSON.parse(json) as Assumptions;
  } catch {
    return null;
  }
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toGradedRow(r: any): GradedRow {
  const assumptions = parseAssumptions(r.assumptions_json);
  return {
    listing_id: r.listing_id,
    source: r.source,
    address: r.address,
    city: r.city,
    state: r.state,
    zip_code: r.zip_code,
    property_type: r.property_type,
    bedrooms: r.bedrooms,
    bathrooms: r.bathrooms,
    living_area: r.living_area,
    price: r.price,
    price_per_sqft: r.price_per_sqft,
    est_rent: assumptions?.monthlyRent ?? null,
    cash_required: assumptions?.totalCashInvested ?? null,
    coc_return: r.coc_return,
    monthly_cashflow: r.monthly_cashflow,
    overall_grade: r.overall_grade as Letter,
    overall_score: r.overall_score,
    first_seen_at: r.first_seen_at,
    graded_at: r.graded_at,
    listing_url: r.listing_url,
  };
}

function resolveLinks(source: string, url: string | null): {
  zillowUrl: string | null;
  realtorUrl: string | null;
} {
  if (source === 'zillow') return { zillowUrl: url, realtorUrl: null };
  if (source === 'realtor') return { zillowUrl: null, realtorUrl: url };
  return { zillowUrl: null, realtorUrl: null };
}

// --- profile filtering -----------------------------------------------------

/**
 * Keep only the rows that satisfy the investor profile. Unknown values are
 * treated leniently — a missing price or cash figure doesn't exclude a row, we
 * only drop rows that are *known* to violate a constraint.
 */
export function filterByProfile(rows: GradedRow[], p: InvestorProfile): GradedRow[] {
  if (!isProfileActive(p)) return rows;
  return rows.filter((r) => {
    if (p.minPurchasePrice != null && r.price != null && r.price < p.minPurchasePrice) {
      return false;
    }
    if (p.maxPurchasePrice != null && r.price != null && r.price > p.maxPurchasePrice) {
      return false;
    }
    if (p.availableCash != null && r.cash_required != null && r.cash_required > p.availableCash) {
      return false;
    }
    if (p.minBeds != null && (r.bedrooms ?? 0) < p.minBeds) return false;
    if (
      p.minCocReturn != null &&
      (r.coc_return == null || r.coc_return < p.minCocReturn)
    ) {
      return false;
    }
    if (p.propertyTypes.length > 0 && !matchesProfileTypes(r.property_type, p.propertyTypes)) {
      return false;
    }
    return true;
  });
}

// --- public queries --------------------------------------------------------

/**
 * Every property at its latest grade, best first. Powers the main table. When a
 * profile is supplied, results are filtered to the investor's buy-box.
 */
export function getGradedProperties(profile?: InvestorProfile): GradedRow[] {
  const db = getDb();
  if (!db) return [];
  const rows = db
    .prepare(`${LATEST_GRADE_JOIN} ORDER BY g.overall_score DESC, g.coc_return DESC`)
    .all();
  const mapped = rows.map(toGradedRow);
  return profile ? filterByProfile(mapped, profile) : mapped;
}

/**
 * Top-of-page summary metrics. When a profile is supplied, the grade
 * distribution, average CoC and best opportunity reflect only the matching
 * properties; totalProperties remains the full count of tracked listings.
 */
export function getSummary(profile?: InvestorProfile): Summary {
  const db = getDb();
  const empty: Summary = {
    totalProperties: 0,
    totalGraded: 0,
    gradeCounts: { A: 0, B: 0, C: 0, D: 0, F: 0 },
    avgCoc: null,
    best: null,
    rate: null,
  };
  if (!db) return empty;

  const totalProperties = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM listings WHERE ${investableTypesOnly('property_type')}`,
      )
      .get() as { n: number }
  ).n;

  const graded = getGradedProperties(profile);
  const gradeCounts: Record<Letter, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  let cocSum = 0;
  let cocCount = 0;
  for (const g of graded) {
    if (g.overall_grade in gradeCounts) gradeCounts[g.overall_grade]++;
    if (g.coc_return != null && Number.isFinite(g.coc_return)) {
      cocSum += g.coc_return;
      cocCount++;
    }
  }

  const rateRow = db
    .prepare(
      `SELECT base_rate, premium, effective_rate, week_date
       FROM interest_rates ORDER BY fetched_at DESC, id DESC LIMIT 1`,
    )
    .get() as
    | { base_rate: number; premium: number; effective_rate: number; week_date: string | null }
    | undefined;

  return {
    totalProperties,
    totalGraded: graded.length,
    gradeCounts,
    avgCoc: cocCount ? round2(cocSum / cocCount) : null,
    best: graded[0] ?? null,
    rate: rateRow
      ? {
          effectiveRate: rateRow.effective_rate,
          baseRate: rateRow.base_rate,
          premium: rateRow.premium,
          weekDate: rateRow.week_date,
        }
      : null,
  };
}

/** Full detail for one property, or null if it has no grade. */
export function getPropertyDetail(id: number): PropertyDetail | null {
  const db = getDb();
  if (!db) return null;

  const r = db
    .prepare(`${LATEST_GRADE_JOIN} AND l.id = ?`)
    .get(id) as any;
  if (!r) return null;

  const base = toGradedRow(r);
  const assumptions = parseAssumptions(r.assumptions_json);
  const components: ComponentBreakdown[] = COMPONENTS.map((c) => ({
    key: c.key,
    label: c.label,
    weight: c.weight,
    grade: (r[c.gradeCol] as Letter | null) ?? null,
  }));

  const { zillowUrl, realtorUrl } = resolveLinks(r.source, r.listing_url);

  return {
    ...base,
    source_id: r.source_id,
    latitude: r.latitude,
    longitude: r.longitude,
    lot_size: r.lot_size,
    year_built: r.year_built,
    days_on_market: r.days_on_market,
    status: r.status,
    crime_index: r.crime_index,
    rental_prevalence: r.rental_prevalence,
    interest_rate_used: r.interest_rate_used,
    reasoning: r.reasoning,
    components,
    assumptions,
    priceVsMedian: priceSqftVsZipMedian(r),
    zillowUrl,
    realtorUrl,
    history: getGradeHistory(id),
  };
}

/** Every grading run for a property, oldest first. Powers the history chart. */
export function getGradeHistory(id: number): HistoryPoint[] {
  const db = getDb();
  if (!db) return [];
  return db
    .prepare(
      `SELECT graded_at, overall_grade, overall_score, coc_return
       FROM grades WHERE property_id = ? ORDER BY graded_at ASC, id ASC`,
    )
    .all(id) as HistoryPoint[];
}

/**
 * Compare a listing's price/sqft against the zip median for the same bed/bath
 * (falling back to beds-only when bed+bath is too thin). Mirrors the tracker's
 * scoring/comps.ts. `r` is a row exposing zip_code/bedrooms/bathrooms/price/
 * living_area.
 */
function priceSqftVsZipMedian(r: any): PriceSqftComparison | null {
  const db = getDb();
  if (!db) return null;
  if (
    r.zip_code == null ||
    r.bedrooms == null ||
    r.bathrooms == null ||
    r.price == null ||
    r.living_area == null ||
    r.living_area <= 0
  ) {
    return null;
  }

  const beds = Math.round(r.bedrooms);
  const baths = Math.round(r.bathrooms);

  const query = (requireBaths: boolean): number[] => {
    const sql = `
      SELECT price, living_area FROM listings
      WHERE zip_code = ? AND bedrooms = ?
        ${requireBaths ? 'AND bathrooms = ?' : ''}
        AND price IS NOT NULL AND price > 0
        AND living_area IS NOT NULL AND living_area > 0
        AND ${investableTypesOnly('property_type')}`;
    const rows = (
      requireBaths
        ? db.prepare(sql).all(r.zip_code, beds, baths)
        : db.prepare(sql).all(r.zip_code, beds)
    ) as Array<{ price: number; living_area: number }>;
    return rows.map((x) => x.price / x.living_area);
  };

  const MIN_COMPS = 3;
  let comps = query(true);
  if (comps.length < MIN_COMPS) comps = query(false);

  const zipMedian = median(comps);
  if (zipMedian == null || zipMedian <= 0) return null;

  const pricePerSqft = r.price / r.living_area;
  const deltaPct = ((pricePerSqft - zipMedian) / zipMedian) * 100;
  return {
    pricePerSqft: round2(pricePerSqft),
    zipMedian: round2(zipMedian),
    belowMedianPct: round2(-deltaPct), // positive = below median = cheaper
    comps: comps.length,
  };
}
