/**
 * Standard fixed-rate fully-amortizing monthly payment.
 *
 *   M = P * r(1+r)^n / ((1+r)^n - 1)
 *
 * where P = principal, r = monthly interest rate (annual% / 100 / 12),
 * n = number of payments (years * 12). Handles the 0% edge case.
 */
export function monthlyMortgagePayment(
  principal: number,
  annualRatePct: number,
  years = 30,
): number {
  if (principal <= 0) return 0;
  const n = years * 12;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return principal / n;
  const factor = (1 + r) ** n;
  return (principal * (r * factor)) / (factor - 1);
}
