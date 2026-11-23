// Search for the Needs Property list: one box that understands descriptions,
// amounts and dates, plus optional date and amount ranges.
//
//   "home depot"          description or category contains both words
//   65 / $65 / 65.00      amount: 65 matches $65.00–$65.99, 65.00 matches exactly
//                         (a plain number also matches text, e.g. "#6321",
//                         and 2000–2099 also matches that year)
//   2025-06-12 / 2025-06  that day / that month
//   6/12, 6/12/2025       month/day (any year), or the full date
//   jun 12, june 2025     month name with a day or a year; "june" alone = any June
// Every part must match (AND). Amounts compare without the sign.

export interface QueueFilters {
  q: string;
  from: string; // 'YYYY-MM-DD' or ''
  to: string;
  min: string; // dollars, '' = no limit
  max: string;
}
export const EMPTY_QUEUE_FILTERS: QueueFilters = { q: '', from: '', to: '', min: '', max: '' };

interface Row {
  date: string; // 'YYYY-MM-DD'
  description: string;
  category: string;
  amount: number;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const monthOf = (w: string) => {
  const i = MONTHS.indexOf(w.toLowerCase().slice(0, 3));
  return i >= 0 && /^[a-z]{3,9}\.?$/i.test(w) ? i + 1 : 0;
};

type Test = (r: Row) => boolean;

/** Turn the search text into tests (all must pass). */
export function parseQuery(q: string): Test[] {
  const tests: Test[] = [];
  let rest = ` ${q.trim()} `;

  // "jun 12", "june 12 2025", "jun 2025": month name + day and/or year
  rest = rest.replace(/\s([a-z]{3,9})\.?\s+(\d{1,4})(?:,?\s+(\d{4}))?(?=\s)/gi, (all, mw: string, n: string, y?: string) => {
    const m = monthOf(mw);
    if (!m) return all;
    if (n.length === 4) {
      tests.push((r) => r.date.startsWith(`${n}-${pad(m)}`));
    } else {
      const md = `-${pad(m)}-${pad(Number(n))}`;
      tests.push(y ? (r) => r.date === `${y}${md}` : (r) => r.date.slice(4) === md);
    }
    return ' ';
  });

  for (const tok of rest.split(/\s+/).filter(Boolean)) {
    let m: RegExpMatchArray | null;
    if ((m = tok.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/))) {
      const prefix = `${m[1]}-${pad(Number(m[2]))}` + (m[3] ? `-${pad(Number(m[3]))}` : '');
      tests.push((r) => r.date.startsWith(prefix));
    } else if ((m = tok.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/))) {
      const md = `-${pad(Number(m[1]))}-${pad(Number(m[2]))}`;
      const y = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : null;
      tests.push(y ? (r) => r.date === `${y}${md}` : (r) => r.date.slice(4) === md);
    } else if (monthOf(tok)) {
      const mm = `-${pad(monthOf(tok))}-`;
      tests.push((r) => r.date.slice(4, 8) === mm);
    } else if ((m = tok.match(/^-?\$?(\d[\d,]*)(\.(\d{1,2}))?$/))) {
      const whole = Number(m[1]!.replace(/,/g, ''));
      const cents = m[3] != null ? Math.round(Number(`${whole}.${m[3].padEnd(2, '0')}`) * 100) : null;
      const raw = tok.replace(/^\$/, '').toLowerCase();
      tests.push((r) => {
        const abs = Math.abs(r.amount);
        const amountHit = cents != null ? Math.round(abs * 100) === cents : Math.floor(abs + 1e-9) === whole;
        const yearHit = cents == null && /^20\d\d$/.test(raw) && r.date.startsWith(raw);
        return amountHit || yearHit || r.description.toLowerCase().includes(raw);
      });
    } else {
      const w = tok.toLowerCase();
      tests.push((r) => r.description.toLowerCase().includes(w) || r.category.toLowerCase().includes(w));
    }
  }
  return tests;
}

/** Rows that match the search and the ranges. */
export function filterQueue<T extends Row>(rows: T[], f: QueueFilters): T[] {
  const tests = parseQuery(f.q);
  const min = f.min.trim() === '' ? null : Math.abs(Number(f.min));
  const max = f.max.trim() === '' ? null : Math.abs(Number(f.max));
  return rows.filter((r) => {
    if (f.from && r.date < f.from) return false;
    if (f.to && r.date > f.to) return false;
    const abs = Math.abs(r.amount);
    if (min != null && Number.isFinite(min) && abs < min) return false;
    if (max != null && Number.isFinite(max) && abs > max) return false;
    return tests.every((t) => t(r));
  });
}

export const hasQueueFilters = (f: QueueFilters) => !!(f.q.trim() || f.from || f.to || f.min.trim() || f.max.trim());
