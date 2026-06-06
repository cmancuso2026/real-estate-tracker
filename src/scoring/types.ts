/** A-F letter grade used throughout the scoring engine. */
export type Letter = 'A' | 'B' | 'C' | 'D' | 'F';

/** Keys identifying each weighted scoring component. */
export type ComponentKey =
  | 'coc'
  | 'cashflow'
  | 'sqft'
  | 'crime'
  | 'rental';

/**
 * Result of grading a single component. `value` is the underlying metric
 * (e.g. CoC return %, $/month, % vs median) for transparency/reasoning.
 * A component is omitted entirely (null from its grader) when its required
 * data is unavailable — its weight is then redistributed across the rest.
 */
export interface ComponentGrade {
  key: ComponentKey;
  letter: Letter;
  /** Underlying numeric metric, component-specific. */
  value: number;
  /** Short human-readable detail used to build the reasoning string. */
  detail: string;
}

/** Financial assumptions used for a grading run; persisted as assumptions_json. */
export interface Assumptions {
  purchasePrice: number;
  downPaymentPct: number;
  downPayment: number;
  closingCosts: number;
  totalCashInvested: number;
  loanAmount: number;
  interestRatePct: number; // effective rate (base + premium)
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

/** Full grading outcome for one listing, ready to persist. */
export interface GradeResult {
  propertyId: number;
  overallGrade: Letter;
  overallScore: number;
  components: Partial<Record<ComponentKey, ComponentGrade>>;
  cocReturn: number | null;
  monthlyCashflow: number | null;
  pricePerSqft: number | null;
  crimeIndex: number | null;
  rentalPrevalence: number | null;
  interestRateUsed: number;
  reasoning: string;
  assumptions: Assumptions;
}
