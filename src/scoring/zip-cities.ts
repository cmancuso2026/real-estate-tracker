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
  '33168': 'Miami Gardens',
  '33161': 'North Miami',
  '33147': 'Miami',
  '33154': 'Bal Harbour',
  '33167': 'Miami Gardens',
};

/**
 * Cities to grade against the Miami-Dade median when the FBI has no resolvable
 * agency (or no data) for them. Small municipalities like Bal Harbour Village
 * often aren't reported individually in the CDE; rather than skip the crime
 * component for their zips, we treat them as average (the county median) so the
 * property still gets a neutral crime grade instead of redistributing weight.
 */
export const MEDIAN_FALLBACK_CITIES: Set<string> = new Set(['Bal Harbour']);

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
