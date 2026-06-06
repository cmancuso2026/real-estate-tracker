import { z } from 'zod';
import { config } from '../config.js';
import { getJson } from './http.js';
import type { ListingRecord } from '../db/types.js';

/**
 * Zillow via RapidAPI (default provider: zillow-com1.p.rapidapi.com).
 *
 * GET https://<host>/propertyExtendedSearch
 *   ?location=78704&status_type=ForSale&home_type=Houses&page=1
 *   headers: X-RapidAPI-Key, X-RapidAPI-Host
 *
 * The response shape varies slightly between RapidAPI Zillow providers, so the
 * schema is intentionally lenient and we keep the full payload in raw_json.
 */

const ZillowProp = z
  .object({
    zpid: z.union([z.string(), z.number()]).optional(),
    address: z.string().optional(),
    addressStreet: z.string().optional(),
    addressCity: z.string().optional(),
    addressState: z.string().optional(),
    addressZipcode: z.union([z.string(), z.number()]).optional(),
    price: z.number().optional(),
    bedrooms: z.number().optional(),
    bathrooms: z.number().optional(),
    livingArea: z.number().optional(),
    lotAreaValue: z.number().optional(),
    lotAreaUnit: z.string().optional(),
    propertyType: z.string().optional(),
    daysOnZillow: z.number().optional(),
    listingStatus: z.string().optional(),
    detailUrl: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    yearBuilt: z.number().optional(),
  })
  .passthrough();

const ZillowSearchResponse = z
  .object({
    props: z.array(ZillowProp).nullish(),
    totalPages: z.number().optional(),
    currentPage: z.number().optional(),
  })
  .passthrough();

export interface FetchListingsOptions {
  statusType?: 'ForSale' | 'ForRent' | 'RecentlySold';
  homeType?: string; // e.g. 'Houses', 'Townhomes', 'Multi-family'
  /** Max result pages to walk (each page ~40 results). */
  maxPages?: number;
}

const BASE_PATH = '/propertyExtendedSearch';

/** Fetch for-sale listings for a zip code across pages, normalized. */
export async function fetchListingsByZip(
  zipCode: string,
  opts: FetchListingsOptions = {},
): Promise<ListingRecord[]> {
  const { statusType = 'ForSale', homeType, maxPages = 5 } = opts;
  const host = config.rapidApiZillowHost;
  const url = `https://${host}${BASE_PATH}`;

  const headers = {
    'X-RapidAPI-Key': config.rapidApiKey,
    'X-RapidAPI-Host': host,
  };

  const records: ListingRecord[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const raw = await getJson(url, {
      headers,
      query: {
        location: zipCode,
        status_type: statusType,
        home_type: homeType,
        page,
      },
    });

    const parsed = ZillowSearchResponse.parse(raw);
    totalPages = Math.min(parsed.totalPages ?? 1, maxPages);

    for (const p of parsed.props ?? []) {
      const zpid = p.zpid != null ? String(p.zpid) : null;
      if (!zpid) continue; // can't dedupe without a stable id — skip

      const zip =
        p.addressZipcode != null ? String(p.addressZipcode) : zipCode;

      records.push({
        source: 'zillow',
        source_id: zpid,
        address: p.address ?? p.addressStreet ?? null,
        city: p.addressCity ?? null,
        state: p.addressState ?? null,
        zip_code: zip,
        latitude: p.latitude ?? null,
        longitude: p.longitude ?? null,
        price: p.price != null ? Math.round(p.price) : null,
        bedrooms: p.bedrooms ?? null,
        bathrooms: p.bathrooms ?? null,
        living_area: p.livingArea != null ? Math.round(p.livingArea) : null,
        lot_size: normalizeLotSize(p.lotAreaValue, p.lotAreaUnit),
        year_built: p.yearBuilt ?? null,
        property_type: p.propertyType ?? null,
        days_on_market: p.daysOnZillow ?? null,
        status: p.listingStatus ?? statusType,
        listing_url: toAbsoluteUrl(p.detailUrl),
        raw_json: JSON.stringify(p),
      });
    }

    page++;
  } while (page <= totalPages);

  return records;
}

/** Normalize lot size to square feet (Zillow reports acres or sqft). */
function normalizeLotSize(
  value: number | undefined,
  unit: string | undefined,
): number | null {
  if (value == null) return null;
  if (unit && unit.toLowerCase().startsWith('acre')) {
    return Math.round(value * 43_560);
  }
  return Math.round(value);
}

function toAbsoluteUrl(detailUrl: string | undefined): string | null {
  if (!detailUrl) return null;
  if (detailUrl.startsWith('http')) return detailUrl;
  return `https://www.zillow.com${detailUrl}`;
}
