export type Letter = 'A' | 'B' | 'C' | 'D' | 'F';

/**
 * Tailwind classes per grade for badges. Bright, saturated fills with a subtle
 * ring so they pop on both the light (gray-50/white) and dark (gray-950)
 * backgrounds. White text on A/B/D/F, dark text on the yellow C for contrast.
 */
export const GRADE_BADGE: Record<Letter, string> = {
  A: 'bg-green-500 text-white ring-1 ring-green-600/40',
  B: 'bg-blue-500 text-white ring-1 ring-blue-600/40',
  C: 'bg-yellow-400 text-gray-900 ring-1 ring-yellow-500/50',
  D: 'bg-orange-500 text-white ring-1 ring-orange-600/40',
  F: 'bg-red-500 text-white ring-1 ring-red-600/40',
};

/** Hex per grade, for inline SVG / chart strokes. */
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

/** Friendly property-type bucket: SFH / Duplex / Multi. */
export function propertyTypeLabel(propertyType: string | null): string {
  if (!propertyType) return 'SFH';
  const t = propertyType.toLowerCase();
  if (/duplex|two.?family/.test(t)) return 'Duplex';
  if (/multi|triplex|fourplex|quadplex|three.?family|four.?family/.test(t)) {
    return 'Multi';
  }
  return 'SFH';
}

/** The property types an investor can target in their profile. */
export const PROFILE_PROPERTY_TYPES = ['SFH', 'Duplex', 'Triplex', 'Quad'] as const;
export type ProfilePropertyType = (typeof PROFILE_PROPERTY_TYPES)[number];

/**
 * Classify a raw listing property-type string into a profile category. Unit
 * counts are detected when present (triplex/quad/duplex); a generic
 * "multi-family" with no count is reported as 'Multi' (it could be any of
 * Duplex/Triplex/Quad). Unknown/blank defaults to 'SFH', matching
 * propertyTypeLabel.
 */
export function canonicalPropertyType(
  propertyType: string | null,
): ProfilePropertyType | 'Multi' {
  if (!propertyType) return 'SFH';
  const t = propertyType.toLowerCase();
  if (/quad|four.?plex|four.?family|4.?unit/.test(t)) return 'Quad';
  if (/triplex|three.?family|3.?unit/.test(t)) return 'Triplex';
  if (/duplex|two.?family|2.?unit/.test(t)) return 'Duplex';
  if (/multi/.test(t)) return 'Multi';
  return 'SFH';
}

/**
 * Does a listing's type satisfy the investor's selected target types? An empty
 * selection means "any type". A generic multi-family listing (unit count
 * unknown) matches when the investor targets any multi-family type.
 */
export function matchesProfileTypes(
  propertyType: string | null,
  selected: readonly string[],
): boolean {
  if (!selected || selected.length === 0) return true;
  const cat = canonicalPropertyType(propertyType);
  if (selected.includes(cat)) return true;
  if (
    cat === 'Multi' &&
    selected.some((s) => s === 'Duplex' || s === 'Triplex' || s === 'Quad')
  ) {
    return true;
  }
  return false;
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
