import { z } from 'zod';
import { config } from '../config.js';
import { getJson } from './http.js';
import type { ListingRecord } from '../db/types.js';

/**
 * Zillow via RapidAPI (provider: us-property-market1.p.rapidapi.com).
 *
 * GET https://<host>/search
 *   ?location=33126&status_type=ForSale&home_type=Houses&page=1
 *   headers: X-RapidAPI-Key, X-RapidAPI-Host
 *
 * Returns { props[], totalPages, currentPage, totalResultCount, resultsPerPage }.
 * Each prop carries a single combined `address` string (e.g.
 * "251 NW 60th Ct, Miami, FL 33126") rather than separate city/state/zip
 * fields, so we parse those out below. The schema is intentionally lenient and
 * we keep the full payload in raw_json.
 *
 * NOTE: the BASIC plan enforces a hard 1-request/second limit, so we throttle
 * between page requests to avoid 429s.
 */

const ZillowProp = z
  .object({
    zpid: z.union([z.string(), z.number()]).nullish(),
    address: z.string().nullish(),
    addressStreet: z.string().nullish(),
    addressCity: z.string().nullish(),
    addressState: z.string().nullish(),
    addressZipcode: z.union([z.string(), z.number()]).nullish(),
    price: z.number().nullish(),
    bedrooms: z.number().nullish(),
    bathrooms: z.number().nullish(),
    livingArea: z.number().nullish(),
    lotAreaValue: z.number().nullish(),
    lotAreaUnit: z.string().nullish(),
    propertyType: z.string().nullish(),
    daysOnZillow: z.number().nullish(),
    listingStatus: z.string().nullish(),
    detailUrl: z.string().nullish(),
    latitude: z.number().nullish(),
    longitude: z.number().nullish(),
    yearBuilt: z.number().nullish(),
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

const BASE_PATH = '/search';

/** BASIC-plan rate limit is 1 req/sec; pad slightly to stay under it. */
const THROTTLE_MS = 1_100;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

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
    if (page > 1) await sleep(THROTTLE_MS); // respect 1 req/sec on BASIC plan

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

      // This provider returns a single combined address string; fall back to
      // the discrete fields if a future payload supplies them.
      const addr = parseAddress(p.address);
      const zip =
        p.addressZipcode != null
          ? String(p.addressZipcode)
          : addr.zip ?? zipCode;

      records.push({
        source: 'zillow',
        source_id: zpid,
        address: p.addressStreet ?? addr.street ?? p.address ?? null,
        city: p.addressCity ?? addr.city ?? null,
        state: p.addressState ?? addr.state ?? null,
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

interface ParsedAddress {
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

/**
 * Split a combined Zillow address such as
 * "251 NW 60th Ct, Miami, FL 33126" into its parts. Returns nulls for any
 * component that can't be confidently extracted.
 */
function parseAddress(address: string | null | undefined): ParsedAddress {
  const empty: ParsedAddress = {
    street: null,
    city: null,
    state: null,
    zip: null,
  };
  if (!address) return empty;

  const parts = address.split(',').map((s) => s.trim());
  // Expected: ["251 NW 60th Ct", "Miami", "FL 33126"]
  const last = parts[parts.length - 1] ?? '';
  const stateZip = last.match(/^([A-Z]{2})\s+(\d{5})(?:-\d{4})?$/);

  return {
    street: parts[0] || null,
    city: parts.length >= 3 ? parts[parts.length - 2] || null : null,
    state: stateZip ? stateZip[1] ?? null : null,
    zip: stateZip ? stateZip[2] ?? null : null,
  };
}

/** Normalize lot size to square feet (Zillow reports acres or sqft). */
function normalizeLotSize(
  value: number | null | undefined,
  unit: string | null | undefined,
): number | null {
  if (value == null) return null;
  if (unit && unit.toLowerCase().startsWith('acre')) {
    return Math.round(value * 43_560);
  }
  return Math.round(value);
}

function toAbsoluteUrl(detailUrl: string | null | undefined): string | null {
  if (!detailUrl) return null;
  if (detailUrl.startsWith('http')) return detailUrl;
  return `https://www.zillow.com${detailUrl}`;
}
