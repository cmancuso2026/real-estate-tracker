import { getDb } from './index.js';
import type { GradeResult } from '../scoring/types.js';

/**
 * Persist a grading result. Each run inserts a new row (history is kept); the
 * latest row per property_id is the current grade.
 */
export function saveGrade(result: GradeResult): number {
  const c = result.components;
  const info = getDb()
    .prepare(
      `INSERT INTO grades (
        property_id, overall_grade, overall_score,
        coc_grade, cashflow_grade, sqft_grade, crime_grade, rental_grade,
        coc_return, monthly_cashflow, price_per_sqft, crime_index,
        rental_prevalence, interest_rate_used, reasoning, assumptions_json
      ) VALUES (
        @property_id, @overall_grade, @overall_score,
        @coc_grade, @cashflow_grade, @sqft_grade, @crime_grade, @rental_grade,
        @coc_return, @monthly_cashflow, @price_per_sqft, @crime_index,
        @rental_prevalence, @interest_rate_used, @reasoning, @assumptions_json
      )`,
    )
    .run({
      property_id: result.propertyId,
      overall_grade: result.overallGrade,
      overall_score: result.overallScore,
      coc_grade: c.coc?.letter ?? null,
      cashflow_grade: c.cashflow?.letter ?? null,
      sqft_grade: c.sqft?.letter ?? null,
      crime_grade: c.crime?.letter ?? null,
      rental_grade: c.rental?.letter ?? null,
      coc_return: result.cocReturn,
      monthly_cashflow: result.monthlyCashflow,
      price_per_sqft: result.pricePerSqft,
      crime_index: result.crimeIndex,
      rental_prevalence: result.rentalPrevalence,
      interest_rate_used: result.interestRateUsed,
      reasoning: result.reasoning,
      assumptions_json: JSON.stringify(result.assumptions),
    });
  return Number(info.lastInsertRowid);
}

export function countGrades(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM grades').get() as {
    n: number;
  };
  return row.n;
}

/**
 * A property's current grade joined with the listing fields the notification
 * layer needs (address, links, beds/baths, etc.). One row per property — the
 * most recent grade — so re-grading doesn't produce duplicates.
 */
export interface GradedProperty {
  listing_id: number;
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
  listing_url: string | null;
  overall_grade: string;
  overall_score: number;
  coc_return: number | null;
  monthly_cashflow: number | null;
  price_per_sqft: number | null;
  crime_index: number | null;
  rental_prevalence: number | null;
  graded_at: string;
}

// Latest grade per property (highest grades.id), joined to its listing. The
// correlated subquery picks the most recent grading run for each property.
const LATEST_GRADE_JOIN = `
  SELECT
    l.id AS listing_id, l.source, l.source_id, l.address, l.city, l.state,
    l.zip_code, l.latitude, l.longitude, l.price, l.bedrooms, l.bathrooms,
    l.living_area, l.property_type, l.listing_url,
    g.overall_grade, g.overall_score, g.coc_return, g.monthly_cashflow,
    g.price_per_sqft, g.crime_index, g.rental_prevalence, g.graded_at
  FROM grades g
  JOIN listings l ON l.id = g.property_id
  WHERE g.id = (SELECT MAX(g2.id) FROM grades g2 WHERE g2.property_id = g.property_id)
`;

/**
 * Properties graded within the last `sinceHours` (default 24), ordered best
 * grade first. Powers the daily email digest. Filtered on graded_at so only
 * fresh grading runs are included.
 */
export function getRecentGradedProperties(sinceHours = 24): GradedProperty[] {
  return getDb()
    .prepare(
      `${LATEST_GRADE_JOIN}
         AND g.graded_at > datetime('now', ?)
       ORDER BY g.overall_score DESC, g.coc_return DESC`,
    )
    .all(`-${sinceHours} hours`) as GradedProperty[];
}

/**
 * Every property whose current grade is "A", regardless of when it was graded.
 * Powers Slack alerts — dedup against alerts_sent prevents re-notifying, so we
 * don't need a time window here.
 */
export function getAGradeProperties(): GradedProperty[] {
  return getDb()
    .prepare(
      `${LATEST_GRADE_JOIN}
         AND g.overall_grade = 'A'
       ORDER BY g.overall_score DESC, g.coc_return DESC`,
    )
    .all() as GradedProperty[];
}
