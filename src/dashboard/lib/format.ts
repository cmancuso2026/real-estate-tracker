export type Letter = 'A' | 'B' | 'C' | 'D' | 'F';

/** Tailwind classes per grade for badges (solid) — light + dark friendly. */
export const GRADE_BADGE: Record<Letter, string> = {
  A: 'bg-green-600 text-white',
  B: 'bg-blue-600 text-white',
  C: 'bg-yellow-500 text-black',
  D: 'bg-orange-600 text-white',
  F: 'bg-red-600 text-white',
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
