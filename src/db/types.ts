/**
 * Normalized domain records. API clients map provider-specific payloads into
 * these shapes; repositories persist them. `source` + `source_id` together are
 * the natural key used for deduplication.
 */

export interface ListingRecord {
  source: string; // 'zillow' | 'realtor'
  source_id: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  latitude: number | null;
  longitude: number | null;
  price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  living_area: number | null;
  lot_size: number | null;
  year_built: number | null;
  property_type: string | null;
  days_on_market: number | null;
  status: string | null;
  listing_url: string | null;
  raw_json: string | null;
}

export interface RentalRecord {
  source: string; // 'rentcast'
  source_id: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  latitude: number | null;
  longitude: number | null;
  rent: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  living_area: number | null;
  property_type: string | null;
  listed_date: string | null;
  raw_json: string | null;
}

/** Outcome of an upsert batch — how many rows were new vs. refreshed. */
export interface UpsertResult {
  inserted: number;
  updated: number;
}
