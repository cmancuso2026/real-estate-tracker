import { comparableRents } from '../db/rentals.js';
import { comparablePricePerSqft } from '../db/listings.js';
import type { ListingRow } from '../db/listings.js';
import { median } from './stats.js';

/** Minimum comps before we trust a median without widening the match. */
const MIN_COMPS = 3;

export interface RentEstimate {
  monthlyRent: number;
  comps: number; // how many comps backed the estimate
}

/**
 * Estimate whole-property monthly rent for a listing from Rentcast comps in the
 * same zip. We match on bedrooms (and property type when it yields enough
 * comps), then take the median rent. Returns null when no comparable rent
 * exists — the property then can't be graded on the cash-flow components.
 */
export async function estimateMonthlyRent(
  listing: ListingRow,
): Promise<RentEstimate | null> {
  if (listing.zip_code == null || listing.bedrooms == null) return null;
  const beds = Math.round(listing.bedrooms);

  // Prefer same property-type comps; fall back to any type if too thin.
  const typed = await comparableRents(listing.zip_code, beds, listing.property_type);
  const rents =
    typed.length >= MIN_COMPS
      ? typed
      : await comparableRents(listing.zip_code, beds);

  const m = median(rents);
  if (m == null) return null;
  return { monthlyRent: Math.round(m), comps: rents.length };
}

export interface PricePerSqftComparison {
  pricePerSqft: number;
  zipMedian: number;
  /** % the property is ABOVE the median (negative = below = cheaper). */
  deltaPct: number;
  comps: number;
}

/**
 * Compare a listing's price/sqft against the zip median for the same bed/bath.
 * Falls back to beds-only matching when bed+bath yields too few comps. Returns
 * null if the listing lacks price/area or there are no comparable listings.
 */
export async function pricePerSqftVsZipMedian(
  listing: ListingRow,
): Promise<PricePerSqftComparison | null> {
  if (
    listing.zip_code == null ||
    listing.bedrooms == null ||
    listing.bathrooms == null ||
    listing.price == null ||
    listing.living_area == null ||
    listing.living_area <= 0
  ) {
    return null;
  }

  const beds = Math.round(listing.bedrooms);
  const baths = Math.round(listing.bathrooms);

  let comps = await comparablePricePerSqft(listing.zip_code, beds, baths, true);
  if (comps.length < MIN_COMPS) {
    comps = await comparablePricePerSqft(listing.zip_code, beds, baths, false);
  }

  const zipMedian = median(comps);
  if (zipMedian == null || zipMedian <= 0) return null;

  const pricePerSqft = listing.price / listing.living_area;
  const deltaPct = ((pricePerSqft - zipMedian) / zipMedian) * 100;
  return {
    pricePerSqft: round2(pricePerSqft),
    zipMedian: round2(zipMedian),
    deltaPct: round2(deltaPct),
    comps: comps.length,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
