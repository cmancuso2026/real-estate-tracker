import { config } from '../config.js';
import { initDb } from '../db/init.js';
import { closeDb } from '../db/index.js';
import { upsertListings, countListings } from '../db/listings.js';
import {
  upsertRentals,
  countRentals,
  rentalsLastRefreshedAt,
} from '../db/rentals.js';
import { fetchListingsByZip } from '../api/zillow.js';
import { fetchRentalsByZip } from '../api/rentcast.js';

/**
 * Full Phase 1 pass: for each target zip, pull for-sale listings (Zillow) and
 * rental comps (Rentcast), storing both deduplicated. This is the unit the
 * Phase 6 scheduler will invoke daily.
 *
 * Zillow listings are fetched on every run (new listings appear daily), but
 * Rentcast comps are throttled to a weekly cadence per zip (RENTAL_REFRESH_DAYS,
 * default 7) to conserve API quota — comps change slowly. Use
 * `npm run fetch:rentals <zip>` to force an immediate rental refresh.
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

  const refreshDays = config.rentalRefreshDays;

  for (const zip of zips) {
    console.log(`\n=== ${zip} ===`);

    // Zillow: every run — new for-sale listings appear daily.
    try {
      const listings = await fetchListingsByZip(zip);
      const r = upsertListings(listings);
      console.log(
        `  Zillow listings: ${listings.length} (${r.inserted} new, ${r.updated} updated)`,
      );
    } catch (err) {
      console.error(`  Zillow FAILED: ${(err as Error).message}`);
    }

    // Rentcast: weekly per zip — comps change slowly, so skip if this zip was
    // refreshed within RENTAL_REFRESH_DAYS to conserve API quota.
    const lastRefresh = rentalsLastRefreshedAt(zip);
    const ageDays = lastRefresh != null ? daysSince(lastRefresh) : null;
    if (ageDays != null && ageDays < refreshDays) {
      console.log(
        `  Rentcast comps: skipped — refreshed ${ageDays.toFixed(1)}d ago ` +
          `(next in ${(refreshDays - ageDays).toFixed(1)}d; \`fetch:rentals ${zip}\` to force)`,
      );
    } else {
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

/**
 * Days elapsed since a SQLite UTC datetime string ("YYYY-MM-DD HH:MM:SS").
 * Unparseable values return Infinity so the zip is treated as stale (we fetch
 * rather than risk wrongly skipping a refresh).
 */
function daysSince(sqliteUtc: string): number {
  const iso = sqliteUtc.includes('T') ? sqliteUtc : `${sqliteUtc.replace(' ', 'T')}Z`;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return Infinity;
  return (Date.now() - then) / 86_400_000;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
