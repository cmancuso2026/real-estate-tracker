import type { ListingRow } from '../db/listings.js';
import type {
  ComponentGrade,
  ComponentKey,
  GradeResult,
} from './types.js';
import { WEIGHTS, pointsForLetter, letterFromScore } from './grades.js';
import { getEffectiveRate } from './interest-rate.js';
import { estimateMonthlyRent, pricePerSqftVsZipMedian } from './comps.js';
import {
  computeFinancials,
  gradeCashOnCash,
  gradeCashFlow,
} from './finance.js';
import { gradePricePerSqft } from './price-sqft.js';
import { getCrimeIndex, gradeCrime, isMultiFamily } from './crime.js';
import { getRenterOccupiedPct, gradeRentalPrevalence } from './census.js';
import { buildReasoning } from './reasoning.js';

/**
 * Grade a single listing across all six components and combine into a weighted
 * A-F. Cash-on-cash and cash flow require a rent estimate; if none exists the
 * property cannot be graded and we return null. Price/sqft, crime, and rental
 * prevalence are optional — when their data is unavailable the component is
 * skipped and its weight is redistributed across the rest.
 */
export async function gradeListing(
  listing: ListingRow,
): Promise<GradeResult | null> {
  if (listing.price == null || listing.price <= 0) return null;
  if (listing.zip_code == null) return null;

  const rentEst = estimateMonthlyRent(listing);
  if (rentEst == null) return null; // no rent -> can't grade the investment

  const rate = await getEffectiveRate();
  const fin = computeFinancials(
    listing.price,
    rentEst.monthlyRent,
    rentEst.comps,
    rate,
  );

  const components: Partial<Record<ComponentKey, ComponentGrade>> = {};
  const skipped: ComponentKey[] = [];

  // --- Cash-on-cash (35%) and cash flow (25%) — always present here. --------
  components.coc = {
    key: 'coc',
    letter: gradeCashOnCash(fin.cocReturnPct),
    value: fin.cocReturnPct,
    detail: `${fin.cocReturnPct}% on $${fin.assumptions.totalCashInvested} invested`,
  };
  components.cashflow = {
    key: 'cashflow',
    letter: gradeCashFlow(fin.monthlyCashflow),
    value: fin.monthlyCashflow,
    detail: `$${fin.monthlyCashflow}/mo`,
  };

  // --- Price/sqft vs zip median (20%) --------------------------------------
  const sqftCmp = pricePerSqftVsZipMedian(listing);
  let pricePerSqft: number | null = null;
  if (sqftCmp) {
    pricePerSqft = sqftCmp.pricePerSqft;
    components.sqft = {
      key: 'sqft',
      letter: gradePricePerSqft(sqftCmp.deltaPct),
      value: sqftCmp.deltaPct,
      detail: `$${sqftCmp.pricePerSqft}/sqft vs $${sqftCmp.zipMedian} median (${sqftCmp.comps} comps)`,
    };
  } else {
    skipped.push('sqft');
  }

  const multi = isMultiFamily(listing.property_type);

  // --- Crime (10%) ----------------------------------------------------------
  let crimeIndex: number | null = null;
  const crime = await getCrimeIndex(listing.zip_code).catch(
    () => null,
  ); // external failure -> skip, don't abort the grade
  if (crime) {
    crimeIndex = crime.crimeIndex;
    const pctAbove =
      ((crime.crimeIndex - crime.baseline) / crime.baseline) * 100;
    components.crime = {
      key: 'crime',
      letter: gradeCrime(crime.crimeIndex, crime.baseline, multi),
      value: round2(pctAbove),
      detail: `${crime.city} ${crime.crimeIndex}/100k vs ${crime.baseline} Miami-Dade median`,
    };
  } else {
    skipped.push('crime');
  }

  // --- Rental prevalence (10%) ---------------------------------------------
  let rentalPrevalence: number | null = null;
  const renterPct = await getRenterOccupiedPct(listing.zip_code).catch(
    () => null,
  ); // external failure -> skip, don't abort the grade
  if (renterPct != null) {
    rentalPrevalence = renterPct;
    components.rental = {
      key: 'rental',
      letter: gradeRentalPrevalence(renterPct),
      value: renterPct,
      detail: `${renterPct}% renter-occupied`,
    };
  } else {
    skipped.push('rental');
  }

  // --- Weighted combination, renormalized over present components -----------
  const present = Object.values(components);
  const totalWeight = present.reduce((sum, c) => sum + WEIGHTS[c.key], 0);
  const weightedPoints = present.reduce(
    (sum, c) => sum + WEIGHTS[c.key] * pointsForLetter(c.letter),
    0,
  );
  const overallScore = round2(weightedPoints / totalWeight);
  const overallGrade = letterFromScore(overallScore);

  const reasoning = buildReasoning({
    overallGrade,
    components,
    isMultiFamily: multi,
    skipped,
  });

  return {
    propertyId: listing.id,
    overallGrade,
    overallScore,
    components,
    cocReturn: fin.cocReturnPct,
    monthlyCashflow: fin.monthlyCashflow,
    pricePerSqft,
    crimeIndex,
    rentalPrevalence,
    interestRateUsed: rate.effectiveRate,
    reasoning,
    assumptions: fin.assumptions,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
