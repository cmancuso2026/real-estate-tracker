import type { Taxonomy } from './taxonomy';
import { groupOf } from './taxonomy';
import type { PropertyGroup, Txn } from './types';

/** Years present in the data, newest first ('2026', '2025', …). */
export function yearsInData(txns: Txn[]): string[] {
  return [...new Set(txns.map((t) => t.date.slice(0, 4)))].sort((a, b) => b.localeCompare(a));
}

/** Month numbers present in the data as strings ('1'…'12'), ascending. */
export function monthsInData(txns: Txn[]): string[] {
  return [...new Set(txns.map((t) => String(parseInt(t.date.split('-')[1]!, 10))))].sort(
    (a, b) => parseInt(a, 10) - parseInt(b, 10),
  );
}

/** Default: the current year only; all years if the data has none for it. */
export function defaultYearSelection(values: string[], now = new Date()): string[] {
  const cur = String(now.getFullYear());
  return values.includes(cur) ? [cur] : values;
}

/**
 * Default: the current month + the prior two (3-month window by month number,
 * wrapping past January); all months if none of those have data.
 */
export function defaultMonthSelection(values: string[], now = new Date()): string[] {
  const cur = now.getMonth() + 1;
  const months: number[] = [];
  for (let back = 0; back <= 2; back += 1) months.push(((cur - 1 - back + 12) % 12) + 1);
  const want = months.map(String).filter((v) => values.includes(v));
  return want.length ? want : values;
}

/** Rows in the selected years × months, optionally narrowed to a group and/or category. */
export function filterByPeriod(
  txns: Txn[],
  years: ReadonlySet<string>,
  months: ReadonlySet<string>,
  tax: Taxonomy,
  grp?: string | null,
  cat?: string | null,
): Txn[] {
  return txns.filter((t) => {
    if (!years.has(t.date.slice(0, 4))) return false;
    const mo = String(parseInt(t.date.split('-')[1]!, 10));
    if (!months.has(mo)) return false;
    const g = groupOf(tax, t.cat);
    if (grp && g !== grp) return false;
    if (cat && t.cat !== cat) return false;
    return true;
  });
}

/**
 * The property a category rolls up to, from property_category_map
 * ("1207 Rent" → 1205-1207 NE 117th St). null if it isn't mapped.
 */
export function propertyOfCat(cat: string, props: PropertyGroup[]): PropertyGroup | null {
  return props.find((p) => p.categories.includes(cat)) ?? null;
}

/** The (up to) three largest-|amount| noted transactions — for note tooltips. */
export function topNotes(rows: Txn[]): Txn[] {
  return rows
    .filter((t) => t.note && t.note.trim())
    .sort((a, b) => Math.abs(b.amt) - Math.abs(a.amt))
    .slice(0, 3);
}
