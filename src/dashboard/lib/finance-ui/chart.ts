import { PROP_PREFIX } from './filters';
import { MONTH_NAMES } from './format';
import { topNotes } from './period';
import type { Taxonomy } from './taxonomy';
import type { Txn } from './types';

export { PROP_PREFIX };

export type Granularity = 'daily' | 'weekly' | 'monthly';

/** Bucket key: 'YYYY-MM' (monthly), the week's Sunday 'YYYY-MM-DD' (weekly), or the date. */
export function getBucketKey(dateStr: string, gran: Granularity): string {
  const d = new Date(dateStr + 'T00:00:00');
  if (gran === 'monthly') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  if (gran === 'weekly') {
    const s = new Date(d);
    s.setDate(d.getDate() - d.getDay());
    return `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-${String(s.getDate()).padStart(2, '0')}`;
  }
  return dateStr;
}

export function fmtBucket(key: string, gran: Granularity): string {
  if (gran === 'monthly') {
    const [y, m] = key.split('-');
    return MONTH_NAMES[parseInt(m!, 10)] + ' ' + y;
  }
  const d = new Date(key + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Distinct colors for the per-subcategory breakdown lines (cycled). */
export const CHART_PALETTE = ['#e03131', '#2f9e44', '#3b5bdb', '#f08c00', '#9c36b5', '#0ca678', '#e8590c', '#1971c2', '#c2255c', '#5f3dc4', '#2b8a3e', '#d9480f'];

export interface ChartSeries {
  label: string;
  data: number[];
  color: string;
  fill: boolean;
  dashed?: boolean;
  pointRadius: number;
  /** Translucent fill used by line charts. */
  fillColor: string;
}

export interface ChartModel {
  keys: string[];
  labels: string[];
  series: ChartSeries[];
  /** bucket key → top-3 noted transactions in it */
  notesByKey: Record<string, Txn[]>;
}

/**
 * The chart's data, built as the old renderChart() did, from rows that already
 * have the period and global filters applied. `grp` / `cat` (the global Group
 * and Category filters) only choose the shape:
 * - a group with no category → one series per subcategory with activity
 * - a property ('prop:<id>') → Rent / Costs / Net
 * - otherwise → Income / Spending
 * Returns null when there are no rows (the old page drew no chart).
 */
export function buildChart(
  rows: Txn[],
  tax: Taxonomy,
  grp: string,
  cat: string,
  gran: Granularity,
): ChartModel | null {
  const isProp = cat.startsWith(PROP_PREFIX);

  const groupBreakdown = !!grp && !cat;
  let keys: string[];
  let series: ChartSeries[];

  if (groupBreakdown) {
    const cats = tax.groups[grp] || [];
    const perCat: Record<string, Record<string, number>> = {};
    cats.forEach((c) => (perCat[c] = {}));
    rows.forEach((t) => {
      if (!(t.cat in perCat)) return;
      const k = getBucketKey(t.date, gran);
      perCat[t.cat]![k] = (perCat[t.cat]![k] || 0) + t.amt;
    });
    keys = [...new Set(rows.map((t) => getBucketKey(t.date, gran)))].sort();
    if (!keys.length) return null;
    const liveCats = cats.filter((c) => keys.some((k) => Math.abs(perCat[c]![k] || 0) >= 0.01));
    series = liveCats.map((c, i) => {
      const color = CHART_PALETTE[i % CHART_PALETTE.length]!;
      return {
        label: c,
        data: keys.map((k) => +Math.abs(perCat[c]![k] || 0).toFixed(2)),
        color,
        fillColor: color + '22',
        fill: false,
        pointRadius: 4,
      };
    });
  } else {
    const incB: Record<string, number> = {};
    const expB: Record<string, number> = {};
    rows.forEach((t) => {
      const key = getBucketKey(t.date, gran);
      if (t.amt > 0) incB[key] = (incB[key] || 0) + t.amt;
      else expB[key] = (expB[key] || 0) + Math.abs(t.amt);
    });
    keys = [...new Set([...Object.keys(incB), ...Object.keys(expB)])].sort();
    if (!keys.length) return null;
    series = [
      { label: isProp ? 'Rent' : 'Income', data: keys.map((k) => +(incB[k] || 0).toFixed(2)), color: '#2f9e44', fillColor: 'rgba(47,158,68,.08)', fill: true, pointRadius: 4 },
      { label: isProp ? 'Costs' : 'Spending', data: keys.map((k) => +(expB[k] || 0).toFixed(2)), color: '#e03131', fillColor: 'rgba(224,49,49,.08)', fill: true, pointRadius: 4 },
    ];
    if (isProp) {
      series.push({
        label: 'Net',
        data: keys.map((k) => +((incB[k] || 0) - (expB[k] || 0)).toFixed(2)),
        color: '#3b5bdb',
        fillColor: 'rgba(59,91,219,.05)',
        fill: false,
        dashed: true,
        pointRadius: 3,
      });
    }
  }

  const notesByKey: Record<string, Txn[]> = {};
  rows.forEach((t) => {
    if (t.note && t.note.trim()) {
      const k = getBucketKey(t.date, gran);
      (notesByKey[k] = notesByKey[k] || []).push(t);
    }
  });
  Object.keys(notesByKey).forEach((k) => (notesByKey[k] = topNotes(notesByKey[k]!)));

  return { keys, labels: keys.map((k) => fmtBucket(k, gran)), series, notesByKey };
}
