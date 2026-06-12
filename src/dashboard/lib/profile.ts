import { getPool, query, queryOne, ensureProfileTable, NOW_UTC } from './db';
import type { ProfilePropertyType } from './format';
import { PROFILE_PROPERTY_TYPES } from './format';

/**
 * The investor's saved buy-box. The dashboard filters listings and grades
 * against it before display. A null field means "no constraint"; an empty
 * propertyTypes list means "any type". Persisted as a single row (id = 1) in
 * the investor_profile table.
 */
export interface InvestorProfile {
  minPurchasePrice: number | null;
  maxPurchasePrice: number | null;
  availableCash: number | null;
  propertyTypes: ProfilePropertyType[];
  minBeds: number | null;
  minCocReturn: number | null;
}

export const EMPTY_PROFILE: InvestorProfile = {
  minPurchasePrice: null,
  maxPurchasePrice: null,
  availableCash: null,
  propertyTypes: [],
  minBeds: null,
  minCocReturn: null,
};

/**
 * Sensible starting buy-box, shown on the settings form when no profile has
 * been saved yet (or the saved one is empty). The user can change or clear any
 * of these before saving. Min price $400k, min 3 beds, all property types.
 */
export const DEFAULT_PROFILE: InvestorProfile = {
  minPurchasePrice: 400000,
  maxPurchasePrice: null,
  availableCash: null,
  propertyTypes: [...PROFILE_PROPERTY_TYPES],
  minBeds: 3,
  minCocReturn: null,
};

/** True if any constraint is set (so the dashboard is actively filtering). */
export function isProfileActive(p: InvestorProfile): boolean {
  return (
    p.minPurchasePrice != null ||
    p.maxPurchasePrice != null ||
    p.availableCash != null ||
    p.propertyTypes.length > 0 ||
    p.minBeds != null ||
    p.minCocReturn != null
  );
}

interface ProfileRow {
  min_purchase_price: number | null;
  max_purchase_price: number | null;
  available_cash: number | null;
  property_types: string | null;
  min_beds: number | null;
  min_coc_return: number | null;
}

/** The saved profile, or an empty (no-constraint) profile if none exists. */
export async function getProfile(): Promise<InvestorProfile> {
  if (!getPool()) return EMPTY_PROFILE;

  let row: ProfileRow | null;
  try {
    row = await queryOne<ProfileRow>(
      `SELECT min_purchase_price, max_purchase_price, available_cash, property_types, min_beds, min_coc_return
       FROM investor_profile WHERE id = 1`,
    );
  } catch {
    // Table/column may not exist yet (never saved, pre-feature database).
    // Treat as empty; saving once creates the table via ensureProfileTable.
    return EMPTY_PROFILE;
  }
  if (!row) return EMPTY_PROFILE;

  return {
    minPurchasePrice: row.min_purchase_price,
    maxPurchasePrice: row.max_purchase_price,
    availableCash: row.available_cash,
    propertyTypes: parseTypes(row.property_types),
    minBeds: row.min_beds,
    minCocReturn: row.min_coc_return,
  };
}

/** Upsert the single profile row. Throws if the database isn't reachable. */
export async function saveProfile(p: InvestorProfile): Promise<void> {
  if (!getPool()) {
    throw new Error('Database not configured — cannot save the investor profile.');
  }
  await ensureProfileTable();
  await query(
    `INSERT INTO investor_profile
       (id, min_purchase_price, max_purchase_price, available_cash, property_types, min_beds, min_coc_return, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, $6, ${NOW_UTC})
     ON CONFLICT (id) DO UPDATE SET
       min_purchase_price = excluded.min_purchase_price,
       max_purchase_price = excluded.max_purchase_price,
       available_cash     = excluded.available_cash,
       property_types     = excluded.property_types,
       min_beds           = excluded.min_beds,
       min_coc_return     = excluded.min_coc_return,
       updated_at         = ${NOW_UTC}`,
    [
      p.minPurchasePrice,
      p.maxPurchasePrice,
      p.availableCash,
      JSON.stringify(p.propertyTypes),
      p.minBeds,
      p.minCocReturn,
    ],
  );
}

function parseTypes(json: string | null): ProfilePropertyType[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    const allowed = new Set<string>(PROFILE_PROPERTY_TYPES);
    return parsed.filter((t): t is ProfilePropertyType => allowed.has(t));
  } catch {
    return [];
  }
}
