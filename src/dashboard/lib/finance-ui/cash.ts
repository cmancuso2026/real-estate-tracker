import type { Granularity } from './chart';

/** The balance in force on a date (last closing balance on or before it). */
export function on(points: { date: string; balance: number }[], date: string): number | null {
  let v: number | null = null;
  for (const p of points) {
    if (p.date <= date) v = p.balance;
    else break;
  }
  return v;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** First and last day of a chart bucket (keys from getBucketKey). */
export function bucketRange(key: string, gran: Granularity): { start: string; end: string } {
  if (gran === 'monthly') {
    const [y, m] = key.split('-').map(Number);
    return { start: `${key}-01`, end: iso(new Date(y!, m!, 0)) };
  }
  if (gran === 'weekly') {
    const d = new Date(key + 'T00:00:00');
    d.setDate(d.getDate() + 6);
    return { start: key, end: iso(d) };
  }
  return { start: key, end: key };
}

/**
 * The balance at the end of each bucket: the last closing balance on or before
 * the bucket's last day. Buckets before the first recorded balance, or that
 * start after the latest one, are gaps (null) rather than guesses.
 */
export function balancesByBucket(points: { date: string; balance: number }[], keys: string[], gran: Granularity): (number | null)[] {
  const latest = points[points.length - 1]?.date;
  return keys.map((k) => {
    const { start, end } = bucketRange(k, gran);
    if (!latest || start > latest) return null;
    return on(points, end);
  });
}
