import { getDb } from './db';
import type { Letter } from './format';

/**
 * Manual ("Grade a Property") scoring. Mirrors the tracker's Phase 2 scoring
 * engine (src/scoring/*) but runs against user-entered inputs instead of a
 * stored listing, and is self-contained in the dashboard so it doesn't pull in
 * the tracker's env-coupled config — the same approach lib/queries.ts takes.
 *
 * Components and weights match the engine exactly:
 *   coc 35% · cashflow 25% · price/sqft 20% · crime 10% · rental 10%
 *
 * Cash-flow components require a rent estimate (Rentcast comps in the zip); if
 * none exists the property can't be graded, mirroring the engine returning
 * null. Price/sqft compares against the zip median for the same bed/bath.
 * Crime and rental prevalence are zip/city-level signals, so we reuse the most
 * recent stored values for the same zip rather than re-hitting the FBI/Census
 * APIs — keeping the action fast and offline-safe.
 *
 * One addition over the batch engine: optional monthly HOA fees, subtracted
 * from both cash-flow figures.
 */

// --- inputs / outputs ------------------------------------------------------

export type ManualPropertyType = 'SFH' | 'Duplex' | 'Triplex' | 'Quad';

export interface ManualGradeInput {
  address: string;
  zip: string;
  price: number;
  sqft: number;
  beds: number;
  baths: number;
  propertyType: ManualPropertyType;
  /** Monthly HOA fee in dollars; 0 when none. */
  hoaMonthly: number;
}

export interface ManualComponent {
  key: string;
  label: string;
  weight: number;
  grade: Letter | null;
  /** Short human-readable detail, or why it was skipped. */
  detail: string;
}

export interface ManualAssumptions {
  purchasePrice: number;
  downPaymentPct: number;
  downPayment: number;
  closingCosts: number;
  totalCashInvested: number;
  loanAmount: number;
  interestRatePct: number;
  loanTermYears: number;
  monthlyMortgage: number;
  annualMortgage: number;
  propertyTaxPct: number;
  annualPropertyTax: number;
  insurancePct: number;
  annualInsurance: number;
  hoaMonthly: number;
  annualHoa: number;
  monthlyRent: number;
  rentComps: number;
  vacancyFactor: number;
  annualCashFlow: number;
}

export interface ManualGradeResult {
  ok: true;
  input: ManualGradeInput;
  overallGrade: Letter;
  overallScore: number;
  components: ManualComponent[];
  cocReturn: number;
  monthlyCashflow: number;
  estRent: number;
  rentComps: number;
  pricePerSqft: number | null;
  zipMedianPerSqft: number | null;
  sqftComps: number;
  crimeIndex: number | null;
  rentalPrevalence: number | null;
  rate: { effectiveRate: number; baseRate: number; premium: number };
  assumptions: ManualAssumptions;
  takeaway: string;
  recommendation: 'Pursue' | 'Watch' | 'Pass';
}

export interface ManualGradeError {
  ok: false;
  error: string;
}

// --- constants (mirror src/scoring/finance.ts & grades.ts) -----------------

const DOWN_PAYMENT_PCT = 25;
const CLOSING_COSTS = 20_000;
const LOAN_TERM_YEARS = 30;
const PROPERTY_TAX_PCT = 1;
const INSURANCE_PCT = 1.5;
const VACANCY_FACTOR = 0.08;
const MIN_COMPS = 3;

const WEIGHTS = { coc: 0.35, cashflow: 0.25, sqft: 0.2, crime: 0.1, rental: 0.1 } as const;
const POINTS: Record<Letter, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };

/** Fallback rate if the tracker has never stored a PMMS snapshot. */
const FALLBACK_RATE = { effectiveRate: 7.5, baseRate: 6.75, premium: 0.75 };

const MULTI_TYPES: ManualPropertyType[] = ['Duplex', 'Triplex', 'Quad'];

// --- public entry point ----------------------------------------------------

export function gradeManualProperty(
  input: ManualGradeInput,
): ManualGradeResult | ManualGradeError {
  const db = getDb();
  if (!db) return { ok: false, error: 'Tracker database not found.' };

  const rentEst = estimateMonthlyRent(db, input);
  if (rentEst == null) {
    return {
      ok: false,
      error: `Not enough rental comps in ${input.zip} for a ${input.beds}-bed to estimate rent — can't grade the cash-flow components.`,
    };
  }

  const rate = getEffectiveRate(db);
  const fin = computeFinancials(input, rentEst.monthlyRent, rentEst.comps, rate);
  const isMulti = MULTI_TYPES.includes(input.propertyType);

  const components: ManualComponent[] = [];

  // Cash-on-cash (35%) and cash flow (25%) — always present.
  const cocLetter = gradeCashOnCash(fin.cocReturnPct);
  components.push({
    key: 'coc',
    label: 'Cash-on-cash return',
    weight: WEIGHTS.coc,
    grade: cocLetter,
    detail: `${fmtPct(fin.cocReturnPct)} on ${fmtMoney(fin.assumptions.totalCashInvested)} invested`,
  });

  const cashflowLetter = gradeCashFlow(fin.monthlyCashflow);
  components.push({
    key: 'cashflow',
    label: 'Monthly cash flow',
    weight: WEIGHTS.cashflow,
    grade: cashflowLetter,
    detail: `${fmtMoney(fin.monthlyCashflow)}/mo`,
  });

  // Price/sqft vs zip median (20%).
  const sqftCmp = priceSqftVsZipMedian(db, input);
  components.push({
    key: 'sqft',
    label: 'Price / sqft vs zip median',
    weight: WEIGHTS.sqft,
    grade: sqftCmp ? gradePricePerSqft(sqftCmp.deltaPct) : null,
    detail: sqftCmp
      ? `${fmtMoney(sqftCmp.pricePerSqft)}/sqft vs ${fmtMoney(sqftCmp.zipMedian)} median (${sqftCmp.comps} comps)`
      : 'Not enough comparable listings in this zip.',
  });

  // Crime (10%) and rental prevalence (10%) — reuse stored per-zip signals.
  const crime = lookupCrime(db, input.zip, isMulti);
  components.push({
    key: 'crime',
    label: 'Crime rate',
    weight: WEIGHTS.crime,
    grade: crime?.grade ?? null,
    detail: crime
      ? `City crime index ${fmtNum(crime.index)}/100k (grade ${crime.grade})`
      : 'No crime data for this zip.',
  });

  const rental = lookupRental(db, input.zip);
  components.push({
    key: 'rental',
    label: 'Rental prevalence',
    weight: WEIGHTS.rental,
    grade: rental?.grade ?? null,
    detail: rental
      ? `${fmtPct(rental.prevalence, 0)} renter-occupied (grade ${rental.grade})`
      : 'No census data for this zip.',
  });

  // Weighted combination, renormalized over present components.
  const present = components.filter((c) => c.grade != null);
  const totalWeight = present.reduce((s, c) => s + c.weight, 0);
  const weightedPoints = present.reduce(
    (s, c) => s + c.weight * POINTS[c.grade as Letter],
    0,
  );
  const overallScore = round2(totalWeight > 0 ? weightedPoints / totalWeight : 0);
  const overallGrade = letterFromScore(overallScore);

  const takeaway = buildTakeaway(overallGrade, components, input, fin, isMulti);
  const recommendation = recommend(overallGrade);

  return {
    ok: true,
    input,
    overallGrade,
    overallScore,
    components,
    cocReturn: fin.cocReturnPct,
    monthlyCashflow: fin.monthlyCashflow,
    estRent: rentEst.monthlyRent,
    rentComps: rentEst.comps,
    pricePerSqft: sqftCmp?.pricePerSqft ?? null,
    zipMedianPerSqft: sqftCmp?.zipMedian ?? null,
    sqftComps: sqftCmp?.comps ?? 0,
    crimeIndex: crime?.index ?? null,
    rentalPrevalence: rental?.prevalence ?? null,
    rate,
    assumptions: fin.assumptions,
    takeaway,
    recommendation,
  };
}

// --- rent estimate (mirror scoring/comps.ts) -------------------------------

/** Map a profile property type to the Rentcast property_type label it stores. */
function rentcastType(t: ManualPropertyType): string {
  return t === 'SFH' ? 'Single Family' : 'Multi-Family';
}

interface RentEstimate {
  monthlyRent: number;
  comps: number;
}

function estimateMonthlyRent(
  db: NonNullable<ReturnType<typeof getDb>>,
  input: ManualGradeInput,
): RentEstimate | null {
  const beds = Math.round(input.beds);

  const query = (propertyType?: string): number[] => {
    const sql = `
      SELECT rent FROM rentals
      WHERE zip_code = ? AND bedrooms = ?
        ${propertyType ? 'AND property_type = ?' : ''}
        AND rent IS NOT NULL AND rent > 0`;
    const rows = (
      propertyType
        ? db.prepare(sql).all(input.zip, beds, propertyType)
        : db.prepare(sql).all(input.zip, beds)
    ) as Array<{ rent: number }>;
    return rows.map((r) => r.rent);
  };

  // Prefer same-type comps; fall back to any type if too thin.
  const typed = query(rentcastType(input.propertyType));
  const rents = typed.length >= MIN_COMPS ? typed : query();

  const m = median(rents);
  if (m == null) return null;
  return { monthlyRent: Math.round(m), comps: rents.length };
}

// --- financials (mirror scoring/finance.ts, plus HOA) ----------------------

function computeFinancials(
  input: ManualGradeInput,
  monthlyRent: number,
  rentComps: number,
  rate: { effectiveRate: number },
): { assumptions: ManualAssumptions; cocReturnPct: number; monthlyCashflow: number } {
  const price = input.price;
  const downPayment = (DOWN_PAYMENT_PCT / 100) * price;
  const totalCashInvested = downPayment + CLOSING_COSTS;
  const loanAmount = price - downPayment;

  const monthlyMortgage = monthlyMortgagePayment(loanAmount, rate.effectiveRate, LOAN_TERM_YEARS);
  const annualMortgage = monthlyMortgage * 12;
  const annualPropertyTax = (PROPERTY_TAX_PCT / 100) * price;
  const annualInsurance = (INSURANCE_PCT / 100) * price;
  const annualHoa = input.hoaMonthly * 12;

  // CoC uses vacancy-adjusted annual rent, net of all carrying costs incl. HOA.
  const annualCashFlow =
    monthlyRent * 12 * (1 - VACANCY_FACTOR) -
    annualMortgage -
    annualPropertyTax -
    annualInsurance -
    annualHoa;
  const cocReturnPct = (annualCashFlow / totalCashInvested) * 100;

  // Monthly cash flow uses GROSS rent (no vacancy), per the engine's convention.
  const monthlyCashflow =
    monthlyRent -
    monthlyMortgage -
    annualPropertyTax / 12 -
    annualInsurance / 12 -
    input.hoaMonthly;

  const assumptions: ManualAssumptions = {
    purchasePrice: price,
    downPaymentPct: DOWN_PAYMENT_PCT,
    downPayment: round2(downPayment),
    closingCosts: CLOSING_COSTS,
    totalCashInvested: round2(totalCashInvested),
    loanAmount: round2(loanAmount),
    interestRatePct: rate.effectiveRate,
    loanTermYears: LOAN_TERM_YEARS,
    monthlyMortgage: round2(monthlyMortgage),
    annualMortgage: round2(annualMortgage),
    propertyTaxPct: PROPERTY_TAX_PCT,
    annualPropertyTax: round2(annualPropertyTax),
    insurancePct: INSURANCE_PCT,
    annualInsurance: round2(annualInsurance),
    hoaMonthly: input.hoaMonthly,
    annualHoa: round2(annualHoa),
    monthlyRent,
    rentComps,
    vacancyFactor: VACANCY_FACTOR,
    annualCashFlow: round2(annualCashFlow),
  };

  return {
    assumptions,
    cocReturnPct: round2(cocReturnPct),
    monthlyCashflow: round2(monthlyCashflow),
  };
}

function monthlyMortgagePayment(principal: number, annualRatePct: number, years = 30): number {
  if (principal <= 0) return 0;
  const n = years * 12;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return principal / n;
  const factor = (1 + r) ** n;
  return (principal * (r * factor)) / (factor - 1);
}

// --- price/sqft (mirror scoring/comps.ts; excludes apartments/condos) ------

interface SqftComparison {
  pricePerSqft: number;
  zipMedian: number;
  deltaPct: number;
  comps: number;
}

function priceSqftVsZipMedian(
  db: NonNullable<ReturnType<typeof getDb>>,
  input: ManualGradeInput,
): SqftComparison | null {
  if (input.sqft <= 0 || input.price <= 0) return null;
  const beds = Math.round(input.beds);
  const baths = Math.round(input.baths);

  const query = (requireBaths: boolean): number[] => {
    const sql = `
      SELECT price, living_area FROM listings
      WHERE zip_code = ? AND bedrooms = ?
        ${requireBaths ? 'AND bathrooms = ?' : ''}
        AND price IS NOT NULL AND price > 0
        AND living_area IS NOT NULL AND living_area > 0
        AND LOWER(COALESCE(property_type, '')) NOT LIKE '%apartment%'
        AND LOWER(COALESCE(property_type, '')) NOT LIKE '%condo%'`;
    const rows = (
      requireBaths
        ? db.prepare(sql).all(input.zip, beds, baths)
        : db.prepare(sql).all(input.zip, beds)
    ) as Array<{ price: number; living_area: number }>;
    return rows.map((x) => x.price / x.living_area);
  };

  let comps = query(true);
  if (comps.length < MIN_COMPS) comps = query(false);

  const zipMedian = median(comps);
  if (zipMedian == null || zipMedian <= 0) return null;

  const pricePerSqft = input.price / input.sqft;
  const deltaPct = ((pricePerSqft - zipMedian) / zipMedian) * 100;
  return {
    pricePerSqft: round2(pricePerSqft),
    zipMedian: round2(zipMedian),
    deltaPct: round2(deltaPct),
    comps: comps.length,
  };
}

// --- crime / rental: reuse stored per-zip signals --------------------------

const MULTI_SQL = `(
  LOWER(COALESCE(l.property_type, '')) LIKE '%multi%'
  OR LOWER(COALESCE(l.property_type, '')) LIKE '%duplex%'
  OR LOWER(COALESCE(l.property_type, '')) LIKE '%plex%'
  OR LOWER(COALESCE(l.property_type, '')) LIKE '%two family%'
  OR LOWER(COALESCE(l.property_type, '')) LIKE '%three family%'
  OR LOWER(COALESCE(l.property_type, '')) LIKE '%four family%'
)`;

/**
 * Crime grade for the zip, taken from the most recent stored grade in that zip.
 * Crime grading is one letter more lenient for multi-family, so we prefer a
 * stored grade whose listing matches this property's multi/single classification
 * — and fall back to any same-zip grade if none matches.
 */
function lookupCrime(
  db: NonNullable<ReturnType<typeof getDb>>,
  zip: string,
  isMulti: boolean,
): { grade: Letter; index: number } | null {
  const pick = (matchType: boolean): { crime_grade: Letter; crime_index: number } | undefined => {
    const typeClause = matchType ? `AND ${isMulti ? MULTI_SQL : `NOT ${MULTI_SQL}`}` : '';
    return db
      .prepare(
        `SELECT g.crime_grade, g.crime_index
         FROM grades g JOIN listings l ON l.id = g.property_id
         WHERE l.zip_code = ? AND g.crime_grade IS NOT NULL AND g.crime_index IS NOT NULL
           ${typeClause}
         ORDER BY g.id DESC LIMIT 1`,
      )
      .get(zip) as { crime_grade: Letter; crime_index: number } | undefined;
  };

  const row = pick(true) ?? pick(false);
  if (!row) return null;
  return { grade: row.crime_grade, index: row.crime_index };
}

/** Rental-prevalence grade for the zip (zip-level, type-independent). */
function lookupRental(
  db: NonNullable<ReturnType<typeof getDb>>,
  zip: string,
): { grade: Letter; prevalence: number } | null {
  const row = db
    .prepare(
      `SELECT g.rental_grade, g.rental_prevalence
       FROM grades g JOIN listings l ON l.id = g.property_id
       WHERE l.zip_code = ? AND g.rental_grade IS NOT NULL AND g.rental_prevalence IS NOT NULL
       ORDER BY g.id DESC LIMIT 1`,
    )
    .get(zip) as { rental_grade: Letter; rental_prevalence: number } | undefined;
  if (!row) return null;
  return { grade: row.rental_grade, prevalence: row.rental_prevalence };
}

// --- interest rate ---------------------------------------------------------

function getEffectiveRate(
  db: NonNullable<ReturnType<typeof getDb>>,
): { effectiveRate: number; baseRate: number; premium: number } {
  const row = db
    .prepare(
      `SELECT base_rate, premium, effective_rate
       FROM interest_rates ORDER BY fetched_at DESC, id DESC LIMIT 1`,
    )
    .get() as { base_rate: number; premium: number; effective_rate: number } | undefined;
  if (!row) return { ...FALLBACK_RATE };
  return { effectiveRate: row.effective_rate, baseRate: row.base_rate, premium: row.premium };
}

// --- grading thresholds (mirror the engine exactly) ------------------------

function gradeCashOnCash(coc: number): Letter {
  if (coc >= 8) return 'A';
  if (coc >= 6) return 'B';
  if (coc >= 4) return 'C';
  if (coc >= 2) return 'D';
  return 'F';
}

function gradeCashFlow(cf: number): Letter {
  if (cf >= 500) return 'A';
  if (cf >= 300) return 'B';
  if (cf >= 100) return 'C';
  if (cf >= 0) return 'D';
  return 'F';
}

function gradePricePerSqft(deltaPct: number): Letter {
  if (deltaPct <= -15) return 'A';
  if (deltaPct <= -5) return 'B';
  if (deltaPct < 5) return 'C';
  if (deltaPct < 15) return 'D';
  return 'F';
}

function letterFromScore(score: number): Letter {
  if (score >= 3.5) return 'A';
  if (score >= 2.5) return 'B';
  if (score >= 1.5) return 'C';
  if (score >= 0.5) return 'D';
  return 'F';
}

// --- narrative -------------------------------------------------------------

function recommend(grade: Letter): 'Pursue' | 'Watch' | 'Pass' {
  if (grade === 'A' || grade === 'B') return 'Pursue';
  if (grade === 'C') return 'Watch';
  return 'Pass';
}

function buildTakeaway(
  grade: Letter,
  components: ManualComponent[],
  input: ManualGradeInput,
  fin: { cocReturnPct: number; monthlyCashflow: number },
  isMulti: boolean,
): string {
  const dwelling = isMulti ? `a ${input.propertyType.toLowerCase()}` : 'an SFH';
  const headline: Record<Letter, string> = {
    A: 'a strong investment',
    B: 'a solid investment',
    C: 'a borderline investment',
    D: 'a weak investment',
    F: 'a poor investment',
  };

  const cashWord =
    fin.monthlyCashflow >= 0
      ? `${fmtMoney(fin.monthlyCashflow)}/mo of positive cash flow`
      : `${fmtMoney(fin.monthlyCashflow)}/mo (negative)`;

  let text =
    `This ${dwelling} in ${input.zip} grades ${grade} — ${headline[grade]}. ` +
    `At a ${fmtMoney(input.price)} purchase it projects a ${fmtPct(fin.cocReturnPct)} ` +
    `cash-on-cash return with ${cashWord}.`;

  const present = components.filter((c) => c.grade != null);
  const best = present.reduce<ManualComponent | null>(
    (b, c) => (b == null || POINTS[c.grade as Letter] > POINTS[b.grade as Letter] ? c : b),
    null,
  );
  const worst = present.reduce<ManualComponent | null>(
    (w, c) => (w == null || POINTS[c.grade as Letter] < POINTS[w.grade as Letter] ? c : w),
    null,
  );
  if (best && worst && best.key !== worst.key) {
    text += ` Its strongest factor is ${best.label.toLowerCase()} (${best.grade}); the weakest is ${worst.label.toLowerCase()} (${worst.grade}).`;
  }

  const skipped = components.filter((c) => c.grade == null);
  if (skipped.length > 0) {
    text += ` (${skipped.map((c) => c.label.toLowerCase()).join(' and ')} unavailable — weights renormalized.)`;
  }

  const rec = recommend(grade);
  const recText: Record<'Pursue' | 'Watch' | 'Pass', string> = {
    Pursue: ' Worth pursuing.',
    Watch: ' Worth watching — the numbers are marginal, so negotiate or wait for a better entry.',
    Pass: ' Better to pass at this price.',
  };
  return text + recText[rec];
}

// --- small utilities -------------------------------------------------------

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmtMoney(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
}

function fmtPct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}
