import { getDb, getWritableDb } from './db';
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
export function getProfile(): InvestorProfile {
  const db = getDb();
  if (!db) return EMPTY_PROFILE;

  let row: ProfileRow | undefined;
  try {
    row = db
      .prepare(
        `SELECT min_purchase_price, max_purchase_price, available_cash, property_types, min_beds, min_coc_return
         FROM investor_profile WHERE id = 1`,
      )
      .get() as ProfileRow | undefined;
  } catch {
    // Table/column may not exist yet (never saved, pre-feature database).
    // Treat as empty; saving once migrates the schema via getWritableDb.
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

/** Upsert the single profile row. Throws if the database isn't writable. */
export function saveProfile(p: InvestorProfile): void {
  const db = getWritableDb();
  if (!db) {
    throw new Error('Tracker database not found — cannot save the investor profile.');
  }
  db.prepare(
    `INSERT INTO investor_profile
       (id, min_purchase_price, max_purchase_price, available_cash, property_types, min_beds, min_coc_return, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (id) DO UPDATE SET
       min_purchase_price = excluded.min_purchase_price,
       max_purchase_price = excluded.max_purchase_price,
       available_cash     = excluded.available_cash,
       property_types     = excluded.property_types,
       min_beds           = excluded.min_beds,
       min_coc_return     = excluded.min_coc_return,
       updated_at         = datetime('now')`,
  ).run(
    p.minPurchasePrice,
    p.maxPurchasePrice,
    p.availableCash,
    JSON.stringify(p.propertyTypes),
    p.minBeds,
    p.minCocReturn,
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
