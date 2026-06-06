import { inspectCrimeCoverage } from '../scoring/crime.js';
import { ZIP_TO_CITY } from '../scoring/zip-cities.js';
import { gradeCrime } from '../scoring/crime.js';
import { closeDb } from '../db/index.js';

/**
 * Diagnostic for the city-level FBI crime component. Prints the zip→city map,
 * each tracked city's resolved FBI agency (ORI) and combined crime rate /100k,
 * the auto-computed Miami-Dade median baseline, and how each city would grade
 * (SFH) against that median.
 *
 *   npm run crime:check
 *
 * A city showing "(no agency)" has no own police department in the FBI data
 * (e.g. an area policed by the county) — properties there skip the crime
 * component and the city is excluded from the median.
 */
async function main(): Promise<void> {
  console.log('Zip → city map:');
  for (const [zip, city] of Object.entries(ZIP_TO_CITY)) {
    console.log(`  ${zip}  →  ${city}`);
  }
  console.log('');

  console.log('Fetching FBI city-level crime data…');
  const { cities, median } = await inspectCrimeCoverage();

  console.log('');
  console.log('City             ORI            Rate/100k   vs median   SFH grade');
  console.log('───────────────────────────────────────────────────────────────');
  for (const c of cities) {
    if (c.rate == null || median == null) {
      console.log(
        `${pad(c.city, 16)} ${pad(c.ori ?? '(no agency)', 14)} ${pad('—', 11)} ${pad('—', 11)} —`,
      );
      continue;
    }
    const pctAbove = ((c.rate - median) / median) * 100;
    const grade = gradeCrime(c.rate, median, false);
    console.log(
      `${pad(c.city, 16)} ${pad(c.ori ?? '?', 14)} ${pad(c.rate.toFixed(1), 11)} ` +
        `${pad((pctAbove >= 0 ? '+' : '') + pctAbove.toFixed(1) + '%', 11)} ${grade}`,
    );
  }
  console.log('───────────────────────────────────────────────────────────────');
  console.log(
    `Miami-Dade median baseline: ${median == null ? 'unavailable' : median.toFixed(1) + ' /100k'}`,
  );

  if (median == null) {
    console.log(
      '\nNo city data available. The FBI DEMO_KEY is heavily rate-limited — set a\n' +
        'free FBI_API_KEY (https://api.data.gov/signup/) in .env and retry.',
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
