import { query, queryOne, nowOffsetText } from './index.js';
import type { GradeResult } from '../scoring/types.js';

/**
 * Persist a grading result. Each run inserts a new row (history is kept); the
 * latest row per property_id is the current grade. Returns the new row id.
 */
export async function saveGrade(result: GradeResult): Promise<number> {
  const c = result.components;
  const row = await queryOne<{ id: number }>(
    `INSERT INTO grades (
        property_id, overall_grade, overall_score,
        coc_grade, cashflow_grade, sqft_grade, crime_grade, rental_grade,
        coc_return, monthly_cashflow, price_per_sqft, crime_index,
        rental_prevalence, interest_rate_used, reasoning, assumptions_json
      ) VALUES (
        $1, $2, $3,
        $4, $5, $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14, $15, $16
      )
      RETURNING id`,
    [
      result.propertyId,
      result.overallGrade,
      result.overallScore,
      c.coc?.letter ?? null,
      c.cashflow?.letter ?? null,
      c.sqft?.letter ?? null,
      c.crime?.letter ?? null,
      c.rental?.letter ?? null,
      result.cocReturn,
      result.monthlyCashflow,
      result.pricePerSqft,
      result.crimeIndex,
      result.rentalPrevalence,
      result.interestRateUsed,
      result.reasoning,
      JSON.stringify(result.assumptions),
    ],
  );
  return Number(row?.id);
}

export async function countGrades(): Promise<number> {
  const row = await queryOne<{ n: string }>('SELECT COUNT(*) AS n FROM grades');
  return Number(row?.n ?? 0);
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
  reasoning: string | null;
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
    g.price_per_sqft, g.crime_index, g.rental_prevalence, g.reasoning, g.graded_at
  FROM grades g
  JOIN listings l ON l.id = g.property_id
  WHERE g.id = (SELECT MAX(g2.id) FROM grades g2 WHERE g2.property_id = g.property_id)
`;

/**
 * Properties graded within the last `sinceHours` (default 24), ordered best
 * grade first. Powers the daily email digest. Filtered on graded_at so only
 * fresh grading runs are included.
 */
export async function getRecentGradedProperties(
  sinceHours = 24,
): Promise<GradedProperty[]> {
  return query<GradedProperty>(
    `${LATEST_GRADE_JOIN}
       AND g.graded_at > ${nowOffsetText('hours', '$1')}
     ORDER BY g.overall_score DESC, g.coc_return DESC`,
    [sinceHours],
  );
}

/**
 * Every property whose current grade is "A", regardless of when it was graded.
 * Powers Slack alerts — dedup against alerts_sent prevents re-notifying, so we
 * don't need a time window here.
 */
export async function getAGradeProperties(): Promise<GradedProperty[]> {
  return query<GradedProperty>(
    `${LATEST_GRADE_JOIN}
       AND g.overall_grade = 'A'
     ORDER BY g.overall_score DESC, g.coc_return DESC`,
  );
}
