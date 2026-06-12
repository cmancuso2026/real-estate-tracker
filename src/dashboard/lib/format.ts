export type Letter = 'A' | 'B' | 'C' | 'D' | 'F';

/**
 * Hex per grade — the single source of truth for grade colors, used by the
 * round badges (white text on these fills), inline SVG, chart strokes, and the
 * email digest. Hardcoded so the colors look identical in light and dark mode.
 * A=green, B=blue, C=yellow, D=orange, F=red.
 */
export const GRADE_HEX: Record<Letter, string> = {
  A: '#16a34a',
  B: '#2563eb',
  C: '#ca8a04',
  D: '#ea580c',
  F: '#dc2626',
};

export const GRADE_ORDER: Letter[] = ['A', 'B', 'C', 'D', 'F'];

/** Letter from a 0–4 weighted score (mirrors src/scoring/grades.ts). */
export function letterFromScore(score: number): Letter {
  if (score >= 3.5) return 'A';
  if (score >= 2.5) return 'B';
  if (score >= 1.5) return 'C';
  if (score >= 0.5) return 'D';
  return 'F';
}

/** Grade hex color derived from a 0–4 score. */
export function letterColorFromScore(score: number): string {
  return GRADE_HEX[letterFromScore(score)];
}

export function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** Money with a +/- sign — for cash flow, where direction matters. */
export function fmtSignedMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
}

export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

export function fmtNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

export function fmtSqft(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US');
}

/** "3 / 2" beds/baths, trimming trailing ".0". */
export function fmtBedsBaths(
  beds: number | null,
  baths: number | null,
): string {
  return `${fmtNum(beds)} / ${fmtNum(baths)}`;
}

/**
 * Friendly property-type bucket for display: only "SFH" or "Multi". Anything
 * that isn't an explicit single-family dwelling (duplex, triplex, quad, generic
 * multi-family, etc.) is shown as "Multi". Unknown/blank defaults to SFH.
 */
export function propertyTypeLabel(propertyType: string | null): string {
  if (!propertyType) return 'SFH';
  return /single.?family|sfh/.test(propertyType.toLowerCase()) ? 'SFH' : 'Multi';
}

/** The property types an investor can target in their profile. */
export const PROFILE_PROPERTY_TYPES = ['SFH', 'Triplex', 'Quad', 'Multi'] as const;
export type ProfilePropertyType = (typeof PROFILE_PROPERTY_TYPES)[number];

/**
 * Classify a raw listing property-type string into a profile category. Specific
 * unit counts are detected when present (triplex/quad); any other multi-family
 * dwelling — including duplex, two-family, or a generic "multi-family" with no
 * count — is reported as 'Multi'. Unknown/blank defaults to 'SFH'.
 */
export function canonicalPropertyType(
  propertyType: string | null,
): ProfilePropertyType {
  if (!propertyType) return 'SFH';
  const t = propertyType.toLowerCase();
  if (/quad|four.?plex|four.?family|4.?unit/.test(t)) return 'Quad';
  if (/triplex|three.?family|3.?unit/.test(t)) return 'Triplex';
  if (/multi|duplex|plex|two.?family|2.?unit/.test(t)) return 'Multi';
  return 'SFH';
}

/**
 * Does a listing's type satisfy the investor's selected target types? An empty
 * selection means "any type". 'Multi' is the umbrella for any multi-family
 * dwelling: a generic multi listing matches a specific Triplex/Quad target, and
 * any multi-family listing (Triplex/Quad/Multi) matches a 'Multi' target.
 */
export function matchesProfileTypes(
  propertyType: string | null,
  selected: readonly string[],
): boolean {
  if (!selected || selected.length === 0) return true;
  const cat = canonicalPropertyType(propertyType);
  if (selected.includes(cat)) return true;
  if (cat === 'Multi' && selected.some((s) => s === 'Triplex' || s === 'Quad')) {
    return true;
  }
  if (
    selected.includes('Multi') &&
    (cat === 'Triplex' || cat === 'Quad' || cat === 'Multi')
  ) {
    return true;
  }
  return false;
}

/**
 * Group a string of digits with comma thousands separators as the user types:
 * "400000" -> "400,000", "1000000" -> "1,000,000". Non-digits are dropped, so
 * the field can be re-formatted on every keystroke. Empty in -> empty out.
 */
export function formatThousands(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits ? Number(digits).toLocaleString('en-US') : '';
}

/** Parse a comma-formatted money string back to a raw number (null if empty). */
export function parseThousands(value: string): number | null {
  const digits = value.replace(/\D/g, '');
  return digits ? Number(digits) : null;
}

/** YYYY-MM-DD (or full datetime) -> "Jun 5, 2026". */
export function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s.includes('T') || s.includes(' ') ? s : `${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
