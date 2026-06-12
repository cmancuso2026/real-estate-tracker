import { config } from '../config.js';
import { initDb } from '../db/init.js';
import { closeDb } from '../db/index.js';
import { upsertRentals, countRentals } from '../db/rentals.js';
import { fetchRentalsByZip } from '../api/rentcast.js';

/**
 * Fetch rental comps for every TARGET_ZIP_CODES entry (or zips passed as CLI
 * args) and store them deduplicated.
 *
 *   npm run fetch:rentals            # uses TARGET_ZIP_CODES
 *   npm run fetch:rentals 78704 78745
 */
async function main(): Promise<void> {
  await initDb();

  const zips = argZips() ?? config.targetZipCodes;
  if (zips.length === 0) {
    throw new Error(
      'No zip codes to fetch. Set TARGET_ZIP_CODES in .env or pass zips as args.',
    );
  }

  let totalInserted = 0;
  let totalUpdated = 0;

  for (const zip of zips) {
    process.stdout.write(`Rentcast: fetching rentals for ${zip} … `);
    try {
      const rentals = await fetchRentalsByZip(zip);
      const { inserted, updated } = await upsertRentals(rentals);
      totalInserted += inserted;
      totalUpdated += updated;
      console.log(`${rentals.length} comps (${inserted} new, ${updated} updated)`);
    } catch (err) {
      console.log('FAILED');
      console.error(`  ${(err as Error).message}`);
    }
  }

  console.log(
    `\n✓ Rentals: ${totalInserted} new, ${totalUpdated} updated. ` +
      `Total in DB: ${await countRentals()}.`,
  );
  await closeDb();
}

function argZips(): string[] | null {
  const zips = process.argv.slice(2).filter((a) => /^\d{5}$/.test(a));
  return zips.length > 0 ? zips : null;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
