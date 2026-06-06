/**
 * Maps each target zip code to the Miami-Dade municipality whose
 * law-enforcement agency we use for FBI crime data. The FBI publishes crime by
 * agency (city police department), not by zip, so to grade at a finer grain
 * than "the whole state" we look up the city's agency and use its rate.
 *
 * This is intentionally a small, explicit table rather than a geocoding call:
 * the project tracks a fixed set of Miami-Dade zips, and an incorrect city
 * mapping would silently skew every grade in that zip. Add a zip here when you
 * start tracking it.
 */
export const ZIP_TO_CITY: Record<string, string> = {
  '33012': 'Hialeah',
  '33010': 'Hialeah',
  '33016': 'Hialeah',
  '33018': 'Miami Lakes',
  '33126': 'Miami',
  '33125': 'Miami',
  '33135': 'Miami',
  '33127': 'Miami',
  '33128': 'Miami',
  '33142': 'Miami',
  '33147': 'Miami Gardens',
  '33150': 'Miami',
};

/** The municipality for a zip, or null if the zip isn't in our coverage area. */
export function cityForZip(zipCode: string | null): string | null {
  if (!zipCode) return null;
  return ZIP_TO_CITY[zipCode.trim()] ?? null;
}

/**
 * The distinct cities we cover, in stable order. The "Miami-Dade crime median"
 * baseline is computed across exactly these cities' rates, so this list defines
 * the comparison set.
 */
export const TARGET_CITIES: string[] = [...new Set(Object.values(ZIP_TO_CITY))];
