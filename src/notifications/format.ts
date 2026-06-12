import type { GradedProperty } from '../db/grades.js';
import type { ListingRow } from '../db/listings.js';
import { pricePerSqftVsZipMedian } from '../scoring/comps.js';

/**
 * Shared presentation layer for Slack and email. A `GradedProperty` (raw DB
 * join) is enriched into a `NotificationItem` with derived display fields:
 * source links (Zillow preferred, Realtor.com fallback) and how far the
 * property's price/sqft sits below the zip median.
 */

export interface NotificationItem {
  property: GradedProperty;
  /** Direct Zillow listing URL, if this property came from Zillow. */
  zillowUrl: string | null;
  /** Direct Realtor.com listing URL, if this property came from Realtor.com. */
  realtorUrl: string | null;
  /**
   * % the property's price/sqft is BELOW the zip median (positive = cheaper =
   * better). Null when there aren't enough comps to compute a median.
   */
  belowMedianPct: number | null;
}

export async function toNotificationItem(
  p: GradedProperty,
): Promise<NotificationItem> {
  const links = resolveLinks(p);
  return {
    property: p,
    zillowUrl: links.zillowUrl,
    realtorUrl: links.realtorUrl,
    belowMedianPct: await computeBelowMedianPct(p),
  };
}

/**
 * Map a listing's single `listing_url` onto the right provider slot. Each
 * listing has exactly one source, so only one of these is ever populated.
 */
function resolveLinks(p: GradedProperty): {
  zillowUrl: string | null;
  realtorUrl: string | null;
} {
  const url = p.listing_url ?? null;
  if (p.source === 'zillow') return { zillowUrl: url, realtorUrl: null };
  if (p.source === 'realtor') return { zillowUrl: null, realtorUrl: url };
  return { zillowUrl: null, realtorUrl: null };
}

/**
 * The grades table stores the property's price/sqft but not its delta vs the
 * zip median, so we recompute the comparison from current listing data. Returns
 * a positive percentage when the property is cheaper than the median.
 */
async function computeBelowMedianPct(p: GradedProperty): Promise<number | null> {
  const row: ListingRow = {
    id: p.listing_id,
    source: p.source,
    source_id: p.source_id,
    address: p.address,
    city: p.city,
    state: p.state,
    zip_code: p.zip_code,
    latitude: p.latitude,
    longitude: p.longitude,
    price: p.price,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    living_area: p.living_area,
    property_type: p.property_type,
  };
  const cmp = await pricePerSqftVsZipMedian(row);
  if (!cmp) return null;
  // deltaPct is % ABOVE the median; negate so positive means below/cheaper.
  return round1(-cmp.deltaPct);
}

// --- value formatters ------------------------------------------------------

export function fmtMoney(n: number | null | undefined): string {
  if (n == null) return 'n/a';
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null) return 'n/a';
  return `${n.toFixed(digits)}%`;
}

/** "$XXX (X% below zip median)" — or just the price/sqft when no median. */
export function fmtPriceSqft(item: NotificationItem): string {
  const psf = item.property.price_per_sqft;
  if (psf == null) return 'n/a';
  const base = fmtMoney(psf);
  if (item.belowMedianPct == null) return base;
  const pct = Math.abs(item.belowMedianPct).toFixed(0);
  const side = item.belowMedianPct >= 0 ? 'below' : 'above';
  return `${base} (${pct}% ${side} zip median)`;
}

/** "3/2" beds/baths, trimming trailing ".0". */
export function fmtBedsBaths(p: GradedProperty): string {
  return `${fmtNum(p.bedrooms)}/${fmtNum(p.bathrooms)}`;
}

export function fmtSqft(p: GradedProperty): string {
  return p.living_area != null ? p.living_area.toLocaleString('en-US') : 'n/a';
}

/** Friendly property-type label for display: only "SFH" or "Multi". */
export function fmtType(propertyType: string | null): string {
  if (!propertyType) return 'SFH';
  return /single.?family|sfh/.test(propertyType.toLowerCase()) ? 'SFH' : 'Multi';
}

export function fmtNum(n: number | null | undefined): string {
  if (n == null) return 'n/a';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
