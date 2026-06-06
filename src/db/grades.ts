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
