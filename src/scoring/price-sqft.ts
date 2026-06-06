import type { Letter } from './types.js';

/**
 * Price/sqft grade vs the zip median for the same beds/baths. `deltaPct` is how
 * far the property's price/sqft sits ABOVE the median (negative = below/cheaper,
 * which is better for a buyer):
 *
 *   A = 15%+ below, B = 5-15% below, C = within 5%, D = 5-15% above, F = 15%+ above
 */
export function gradePricePerSqft(deltaPct: number): Letter {
  if (deltaPct <= -15) return 'A';
  if (deltaPct <= -5) return 'B';
  if (deltaPct < 5) return 'C';
  if (deltaPct < 15) return 'D';
  return 'F';
}
