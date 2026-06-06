import { config } from '../config.js';
import { initDb } from '../db/init.js';
import { closeDb } from '../db/index.js';
import { upsertListings, countListings } from '../db/listings.js';
import { upsertRentals, countRentals } from '../db/rentals.js';
import { fetchListingsByZip } from '../api/zillow.js';
import { fetchRentalsByZip } from '../api/rentcast.js';

/**
 * Full Phase 1 pass: for each target zip, pull for-sale listings (Zillow) and
 * rental comps (Rentcast), storing both deduplicated. This is the unit the
 * Phase 6 scheduler will invoke daily.
 *
 *   npm run fetch:all            # uses TARGET_ZIP_CODES
 *   npm run fetch:all 78704 78745
 */
async function main(): Promise<void> {
  initDb();

  const zips = argZips() ?? config.targetZipCodes;
  if (zips.length === 0) {
    throw new Error(
      'No zip codes to fetch. Set TARGET_ZIP_CODES in .env or pass zips as args.',
    );
  }

  for (const zip of zips) {
    console.log(`\n=== ${zip} ===`);

    try {
      const listings = await fetchListingsByZip(zip);
      const r = upsertListings(listings);
      console.log(
        `  Zillow listings: ${listings.length} (${r.inserted} new, ${r.updated} updated)`,
      );
    } catch (err) {
      console.error(`  Zillow FAILED: ${(err as Error).message}`);
    }

    try {
      const rentals = await fetchRentalsByZip(zip);
      const r = upsertRentals(rentals);
      console.log(
        `  Rentcast comps: ${rentals.length} (${r.inserted} new, ${r.updated} updated)`,
      );
    } catch (err) {
      console.error(`  Rentcast FAILED: ${(err as Error).message}`);
    }
  }

  console.log(
    `\n✓ Done. DB totals — listings: ${countListings()}, rentals: ${countRentals()}.`,
  );
  closeDb();
}

function argZips(): string[] | null {
  const zips = process.argv.slice(2).filter((a) => /^\d{5}$/.test(a));
  return zips.length > 0 ? zips : null;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
