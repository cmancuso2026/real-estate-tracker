import { initDb } from '../db/init.js';
import { closeDb } from '../db/index.js';
import { getListings } from '../db/listings.js';
import { saveGrade, countGrades } from '../db/grades.js';
import { getEffectiveRate } from '../scoring/interest-rate.js';
import { gradeListing } from '../scoring/grader.js';
import type { Letter } from '../scoring/types.js';

/**
 * Grade every stored listing (optionally filtered to zip codes passed as args)
 * and persist the results.
 *
 *   npm run grade            # grade all listings
 *   npm run grade 78704      # grade listings in one zip
 */
async function main(): Promise<void> {
  await initDb();

  // Resolve the rate once up front so we can surface it (and fail fast if the
  // PMMS source is unreachable and no rate is stored / overridden).
  const rate = await getEffectiveRate();
  console.log(
    `Using effective rate ${rate.effectiveRate}% ` +
      `(${rate.baseRate}% base + ${rate.premium}% premium).\n`,
  );

  const zips = process.argv.slice(2).filter((a) => /^\d{5}$/.test(a));
  const listings = zips.length
    ? (await Promise.all(zips.map((z) => getListings(z)))).flat()
    : await getListings();

  if (listings.length === 0) {
    console.log('No listings to grade. Run `npm run fetch:listings` first.');
    await closeDb();
    return;
  }

  const dist: Record<Letter, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  let graded = 0;
  let skipped = 0;

  for (const listing of listings) {
    const result = await gradeListing(listing);
    if (!result) {
      skipped++;
      continue;
    }
    await saveGrade(result);
    dist[result.overallGrade]++;
    graded++;
  }

  console.log(`✓ Graded ${graded} listing(s); skipped ${skipped} (no rent comps).`);
  console.log(
    `  Distribution — A:${dist.A} B:${dist.B} C:${dist.C} D:${dist.D} F:${dist.F}`,
  );
  console.log(`  Total grade rows in DB: ${await countGrades()}.`);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
