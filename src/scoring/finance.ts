import { monthlyMortgagePayment } from './mortgage.js';
import type { Assumptions, Letter } from './types.js';

/**
 * Fixed financial assumptions from the Phase 2 spec. Everything else is derived
 * from purchase price, modeled rent, and the effective interest rate.
 */
const DOWN_PAYMENT_PCT = 25;
const CLOSING_COSTS = 20_000;
const LOAN_TERM_YEARS = 30;
const PROPERTY_TAX_PCT = 1; // % of purchase price / year
const INSURANCE_PCT = 1.5; // % of purchase price / year
const VACANCY_FACTOR = 0.08; // 8% of gross rent

export interface RateInput {
  effectiveRate: number; // base + premium, annual %
  baseRate: number;
  premium: number;
}

export interface Financials {
  assumptions: Assumptions;
  /** Cash-on-cash return, percent. */
  cocReturnPct: number;
  /** Monthly cash flow after mortgage + tax + insurance (gross rent, no vacancy). */
  monthlyCashflow: number;
}

/** Build the full set of financial assumptions and the two cash metrics. */
export function computeFinancials(
  purchasePrice: number,
  monthlyRent: number,
  rentComps: number,
  rate: RateInput,
): Financials {
  const downPayment = (DOWN_PAYMENT_PCT / 100) * purchasePrice;
  const totalCashInvested = downPayment + CLOSING_COSTS;
  const loanAmount = purchasePrice - downPayment; // remaining 75%

  const monthlyMortgage = monthlyMortgagePayment(
    loanAmount,
    rate.effectiveRate,
    LOAN_TERM_YEARS,
  );
  const annualMortgage = monthlyMortgage * 12;

  const annualPropertyTax = (PROPERTY_TAX_PCT / 100) * purchasePrice;
  const annualInsurance = (INSURANCE_PCT / 100) * purchasePrice;

  // Cash-on-cash uses vacancy-adjusted annual rent.
  const annualCashFlow =
    monthlyRent * 12 * (1 - VACANCY_FACTOR) -
    annualMortgage -
    annualPropertyTax -
    annualInsurance;
  const cocReturnPct = (annualCashFlow / totalCashInvested) * 100;

  // Monthly cash flow uses GROSS monthly rent (no vacancy), per spec.
  const monthlyCashflow =
    monthlyRent - monthlyMortgage - annualPropertyTax / 12 - annualInsurance / 12;

  const assumptions: Assumptions = {
    purchasePrice,
    downPaymentPct: DOWN_PAYMENT_PCT,
    downPayment: round2(downPayment),
    closingCosts: CLOSING_COSTS,
    totalCashInvested: round2(totalCashInvested),
    loanAmount: round2(loanAmount),
    interestRatePct: rate.effectiveRate,
    baseRatePct: rate.baseRate,
    ratePremiumPct: rate.premium,
    loanTermYears: LOAN_TERM_YEARS,
    monthlyMortgage: round2(monthlyMortgage),
    annualMortgage: round2(annualMortgage),
    propertyTaxPct: PROPERTY_TAX_PCT,
    annualPropertyTax: round2(annualPropertyTax),
    insurancePct: INSURANCE_PCT,
    annualInsurance: round2(annualInsurance),
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

/** Cash-on-cash grade: A 8%+, B 6-8%, C 4-6%, D 2-4%, F below 2% / negative. */
export function gradeCashOnCash(cocReturnPct: number): Letter {
  if (cocReturnPct >= 8) return 'A';
  if (cocReturnPct >= 6) return 'B';
  if (cocReturnPct >= 4) return 'C';
  if (cocReturnPct >= 2) return 'D';
  return 'F';
}

/** Monthly cash-flow grade: A $500+, B $300-500, C $100-300, D $0-100, F negative. */
export function gradeCashFlow(monthlyCashflow: number): Letter {
  if (monthlyCashflow >= 500) return 'A';
  if (monthlyCashflow >= 300) return 'B';
  if (monthlyCashflow >= 100) return 'C';
  if (monthlyCashflow >= 0) return 'D';
  return 'F';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
