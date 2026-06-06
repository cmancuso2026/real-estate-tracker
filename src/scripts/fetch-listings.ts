import { config } from '../config.js';
import { initDb } from '../db/init.js';
import { closeDb } from '../db/index.js';
import { upsertListings, countListings } from '../db/listings.js';
import { fetchListingsByZip } from '../api/zillow.js';

/**
 * Fetch for-sale listings for every TARGET_ZIP_CODES entry (or zips passed as
 * CLI args) and store them deduplicated.
 *
 *   npm run fetch:listings            # uses TARGET_ZIP_CODES
 *   npm run fetch:listings 78704 78745
 */
async function main(): Promise<void> {
  initDb();

  const zips = argZips() ?? config.targetZipCodes;
  if (zips.length === 0) {
    throw new Error(
      'No zip codes to fetch. Set TARGET_ZIP_CODES in .env or pass zips as args.',
    );
  }

  let totalInserted = 0;
  let totalUpdated = 0;

  for (const zip of zips) {
    process.stdout.write(`Zillow: fetching for-sale listings for ${zip} … `);
    try {
      const listings = await fetchListingsByZip(zip);
      const { inserted, updated } = upsertListings(listings);
      totalInserted += inserted;
      totalUpdated += updated;
      console.log(`${listings.length} listings (${inserted} new, ${updated} updated)`);
    } catch (err) {
      console.log('FAILED');
      console.error(`  ${(err as Error).message}`);
    }
  }

  console.log(
    `\n✓ Listings: ${totalInserted} new, ${totalUpdated} updated. ` +
      `Total in DB: ${countListings()}.`,
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
