import { z } from 'zod';
import { config } from '../config.js';
import { getJson } from './http.js';
import type { RentalRecord } from '../db/types.js';

/**
 * Rentcast — rental comps by zip code.
 * Docs: https://developers.rentcast.io/reference/rental-listings-long-term
 *
 * GET https://api.rentcast.io/v1/listings/rental/long-term
 *   ?zipCode=78704&status=Active&limit=500
 *   header: X-Api-Key: <RENTCAST_API_KEY>
 */

const BASE_URL = 'https://api.rentcast.io/v1/listings/rental/long-term';

// Lenient schema: Rentcast omits fields it doesn't have, so everything past
// `id` is optional. Unknown keys pass through and land in raw_json.
const RentcastListing = z
  .object({
    id: z.string(),
    formattedAddress: z.string().optional(),
    addressLine1: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zipCode: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    propertyType: z.string().optional(),
    bedrooms: z.number().optional(),
    bathrooms: z.number().optional(),
    squareFootage: z.number().optional(),
    price: z.number().optional(), // monthly rent
    listedDate: z.string().optional(),
  })
  .passthrough();

const RentcastResponse = z.array(RentcastListing);

export interface FetchRentalsOptions {
  /** Max records to request (Rentcast caps at 500 per call). */
  limit?: number;
  status?: 'Active' | 'Inactive';
}

/** Fetch rental comps for a single zip code, normalized to RentalRecord[]. */
export async function fetchRentalsByZip(
  zipCode: string,
  opts: FetchRentalsOptions = {},
): Promise<RentalRecord[]> {
  const { limit = 500, status = 'Active' } = opts;

  const raw = await getJson(BASE_URL, {
    headers: { 'X-Api-Key': config.rentcastApiKey },
    query: { zipCode, status, limit },
  });

  const listings = RentcastResponse.parse(raw);

  return listings.map((l): RentalRecord => ({
    source: 'rentcast',
    source_id: l.id,
    address: l.formattedAddress ?? l.addressLine1 ?? null,
    city: l.city ?? null,
    state: l.state ?? null,
    zip_code: l.zipCode ?? zipCode,
    latitude: l.latitude ?? null,
    longitude: l.longitude ?? null,
    rent: l.price != null ? Math.round(l.price) : null,
    bedrooms: l.bedrooms ?? null,
    bathrooms: l.bathrooms ?? null,
    living_area: l.squareFootage != null ? Math.round(l.squareFootage) : null,
    property_type: l.propertyType ?? null,
    listed_date: l.listedDate ?? null,
    raw_json: JSON.stringify(l),
  }));
}
