import { queryOne } from '../db/index.js';
import type { GradedProperty } from '../db/grades.js';

/**
 * Investor-profile filtering for the notification layer.
 *
 * The dashboard filters listings against the saved investor profile before
 * showing them (src/dashboard/lib/{profile,queries,format}.ts). Notifications
 * must not alert on properties that would be hidden on the dashboard, so this
 * mirrors that logic on the tracker side. (The dashboard is a self-contained
 * Next app with its own module graph, so — as with lib/queries.ts — the logic
 * is intentionally duplicated rather than imported across the boundary.)
 *
 * Applied filters (matching the profile fields the dashboard enforces):
 *   - investable property types only (SFH plus any multi-family) — always,
 *     mirroring the dashboard's query-level allow-list
 *   - minimum / maximum list price
 *   - target property types (the profile's selected subset)
 *   - minimum bedrooms
 *   - minimum cash-on-cash return
 *
 * Note: the dashboard also has an "available cash" constraint, but that needs
 * each listing's total-cash-invested figure, which GradedProperty doesn't
 * carry; it's omitted here (and isn't part of the requested notification
 * filters).
 */

export interface InvestorProfile {
  minPurchasePrice: number | null;
  maxPurchasePrice: number | null;
  availableCash: number | null;
  propertyTypes: string[];
  minBeds: number | null;
  minCocReturn: number | null;
}

const PROFILE_PROPERTY_TYPES = ['SFH', 'Triplex', 'Quad', 'Multi'];

/** The saved investor profile, or null if none/unavailable. */
export async function getInvestorProfile(): Promise<InvestorProfile | null> {
  let row:
    | {
        min_purchase_price: number | null;
        max_purchase_price: number | null;
        available_cash: number | null;
        property_types: string | null;
        min_beds: number | null;
        min_coc_return: number | null;
      }
    | null;
  try {
    row = await queryOne(
      `SELECT min_purchase_price, max_purchase_price, available_cash,
              property_types, min_beds, min_coc_return
       FROM investor_profile WHERE id = 1`,
    );
  } catch {
    // Table or columns may not exist (profile never saved). No constraints.
    return null;
  }
  if (!row) return null;

  return {
    minPurchasePrice: row.min_purchase_price,
    maxPurchasePrice: row.max_purchase_price,
    availableCash: row.available_cash,
    propertyTypes: parseTypes(row.property_types),
    minBeds: row.min_beds,
    minCocReturn: row.min_coc_return,
  };
}

/** True if any profile constraint (beyond the always-on allow-list) is set. */
export function isProfileActive(p: InvestorProfile): boolean {
  return (
    p.minPurchasePrice != null ||
    p.maxPurchasePrice != null ||
    p.propertyTypes.length > 0 ||
    p.minBeds != null ||
    p.minCocReturn != null
  );
}

/**
 * Filter graded properties to those that would show on the dashboard. The
 * investable-types allow-list is always enforced (the dashboard applies it at
 * the query level regardless of profile); the remaining constraints apply only
 * when the profile sets them.
 */
export function filterByProfile<T extends GradedProperty>(
  rows: T[],
  profile: InvestorProfile | null,
): T[] {
  return rows.filter((r) => {
    if (!isInvestableType(r.property_type)) return false; // SFH + multi-family only
    if (!profile) return true;

    if (
      profile.minPurchasePrice != null &&
      r.price != null &&
      r.price < profile.minPurchasePrice
    ) {
      return false;
    }
    if (
      profile.maxPurchasePrice != null &&
      r.price != null &&
      r.price > profile.maxPurchasePrice
    ) {
      return false;
    }
    if (profile.minBeds != null && (r.bedrooms ?? 0) < profile.minBeds) {
      return false;
    }
    if (
      profile.minCocReturn != null &&
      (r.coc_return == null || r.coc_return < profile.minCocReturn)
    ) {
      return false;
    }
    if (
      profile.propertyTypes.length > 0 &&
      !matchesProfileTypes(r.property_type, profile.propertyTypes)
    ) {
      return false;
    }
    return true;
  });
}

// --- property-type helpers (mirror src/dashboard/lib/format.ts) ------------

/**
 * Is this a type we invest in — SFH or duplex/triplex/quad (multi-family)?
 * Mirrors the SQL allow-list in db/listings.ts:investableTypesOnly. Condo,
 * townhouse, manufactured, lot, apartment, and unknown/blank are excluded.
 */
export function isInvestableType(propertyType: string | null): boolean {
  if (!propertyType) return false;
  const t = propertyType.toLowerCase();
  return /single.*family|sfh|multi|duplex|triplex|quad|plex|two.?family|three.?family|four.?family/.test(
    t,
  );
}

/** Classify a raw type into a profile category. Mirrors canonicalPropertyType. */
function canonicalPropertyType(
  propertyType: string | null,
): 'SFH' | 'Triplex' | 'Quad' | 'Multi' {
  if (!propertyType) return 'SFH';
  const t = propertyType.toLowerCase();
  if (/quad|four.?plex|four.?family|4.?unit/.test(t)) return 'Quad';
  if (/triplex|three.?family|3.?unit/.test(t)) return 'Triplex';
  if (/multi|duplex|plex|two.?family|2.?unit/.test(t)) return 'Multi';
  return 'SFH';
}

/** Does a listing's type satisfy the profile's selected types? Mirrors dashboard. */
function matchesProfileTypes(
  propertyType: string | null,
  selected: readonly string[],
): boolean {
  if (!selected || selected.length === 0) return true;
  const cat = canonicalPropertyType(propertyType);
  if (selected.includes(cat)) return true;
  if (cat === 'Multi' && selected.some((s) => s === 'Triplex' || s === 'Quad')) {
    return true;
  }
  if (
    selected.includes('Multi') &&
    (cat === 'Triplex' || cat === 'Quad' || cat === 'Multi')
  ) {
    return true;
  }
  return false;
}

function parseTypes(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    const allowed = new Set<string>(PROFILE_PROPERTY_TYPES);
    return parsed.filter((t): t is string => allowed.has(t));
  } catch {
    return [];
  }
}
