import { inspectCrimeCoverage, gradeCrime } from '../scoring/crime.js';
import { closeDb } from '../db/index.js';

/**
 * Diagnostic for the Miami-Dade Open Data crime component. For each target zip
 * it prints the crime index (average Esri crime index of nearby neighborhoods),
 * how many neighborhoods backed it (0 = fell back to the county median), the
 * Miami-Dade median baseline, and how the zip would grade (SFH) against it.
 *
 *   npm run crime:check
 *
 * A zip showing "median (no data)" had no neighborhood data within range (e.g.
 * Bal Harbour, beyond the layer's coverage) — it grades at the county median.
 */
async function main(): Promise<void> {
  console.log('Fetching Miami-Dade Open Data crime index by neighborhood…\n');
  const { zips, median } = await inspectCrimeCoverage();

  console.log('Zip      Crime index   Backed by         vs median    SFH grade');
  console.log('─────────────────────────────────────────────────────────────────');
  for (const z of zips) {
    if (z.crimeIndex == null || median == null) {
      console.log(`${pad(z.zip, 8)} ${pad('—', 13)} ${pad('—', 17)} ${pad('—', 12)} —`);
      continue;
    }
    const pctAbove = ((z.crimeIndex - median) / median) * 100;
    const grade = gradeCrime(z.crimeIndex, median, false);
    const backed = z.neighborhoods > 0 ? `${z.neighborhoods} hoods` : 'median (no data)';
    console.log(
      `${pad(z.zip, 8)} ${pad(z.crimeIndex.toFixed(1), 13)} ${pad(backed, 17)} ` +
        `${pad((pctAbove >= 0 ? '+' : '') + pctAbove.toFixed(1) + '%', 12)} ${grade}`,
    );
  }
  console.log('─────────────────────────────────────────────────────────────────');
  console.log(
    `Miami-Dade median baseline: ${median == null ? 'unavailable' : median.toFixed(1)}`,
  );

  if (median == null) {
    console.log(
      '\nNo crime data available — the Miami-Dade Open Data service was unreachable.',
    );
  }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
