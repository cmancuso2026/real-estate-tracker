import type { ComponentKey, Letter } from './types.js';

/**
 * Letter <-> point conversions and component weights, per the Phase 2 spec.
 * Weights sum to 1.0; if a component is missing for a given property, the
 * grader renormalizes over the components that are present.
 */

export const WEIGHTS: Record<ComponentKey, number> = {
  coc: 0.35,
  cashflow: 0.25,
  sqft: 0.2,
  crime: 0.1,
  rental: 0.1,
};

const POINTS: Record<Letter, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };

export function pointsForLetter(letter: Letter): number {
  return POINTS[letter];
}

/**
 * Final letter from the weighted 0-4 score:
 *   A = 3.5+, B = 2.5-3.5, C = 1.5-2.5, D = 0.5-1.5, F = below 0.5
 */
export function letterFromScore(score: number): Letter {
  if (score >= 3.5) return 'A';
  if (score >= 2.5) return 'B';
  if (score >= 1.5) return 'C';
  if (score >= 0.5) return 'D';
  return 'F';
}

export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  coc: 'cash-on-cash return',
  cashflow: 'monthly cash flow',
  sqft: 'price per sqft vs zip median',
  crime: 'crime rate',
  rental: 'rental prevalence',
};
