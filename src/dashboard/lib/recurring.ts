/** Recurring costs: monthly or yearly, an amount as billed, an optional date range. */
export type Frequency = 'monthly' | 'yearly';
export const FREQUENCIES: Frequency[] = ['monthly', 'yearly'];

export interface RecurringInput {
  frequency?: unknown;
  amount?: unknown;
  /** Older callers send only this (a monthly amount). */
  monthly_amount?: unknown;
  start_date?: unknown;
  end_date?: unknown;
}

export interface RecurringFields {
  frequency: Frequency;
  amount: number;
  /** The monthly equivalent (yearly / 12), which cash flow sums. */
  monthly_amount: number;
  start_date: string | null;
  end_date: string | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const date = (v: unknown, name: string): string | null => {
  if (v == null || v === '') return null;
  const s = String(v);
  if (!ISO.test(s) || Number.isNaN(new Date(s + 'T00:00:00Z').getTime())) throw new Error(`${name} must be a date (YYYY-MM-DD)`);
  return s;
};

/** Validate a recurring cost; throws an Error with a readable message. */
export function recurringFields(b: RecurringInput): RecurringFields {
  const frequency = (b.frequency ?? 'monthly') as Frequency;
  if (!FREQUENCIES.includes(frequency)) throw new Error('frequency must be monthly or yearly');
  const raw = b.amount ?? b.monthly_amount;
  const amount = Number(raw);
  if (raw == null || raw === '' || !Number.isFinite(amount) || amount < 0) throw new Error('amount must be a positive number');
  const start_date = date(b.start_date, 'start_date');
  const end_date = date(b.end_date, 'end_date');
  if (start_date && end_date && end_date < start_date) throw new Error('The end date is before the start date');
  const monthly_amount = Math.round((frequency === 'yearly' ? amount / 12 : amount) * 100) / 100;
  return { frequency, amount, monthly_amount, start_date, end_date };
}

/** Whether a recurring cost applies on a date (inside its start / end, inclusive). */
export function activeOn(rc: { is_active?: boolean; start_date?: string | null; end_date?: string | null }, day: string): boolean {
  if (rc.is_active === false) return false;
  if (rc.start_date && day < rc.start_date) return false;
  if (rc.end_date && day > rc.end_date) return false;
  return true;
}

/** "$1,200 / year · Jan 1, 2026 – Dec 31, 2026" */
export function describeRecurring(rc: { frequency?: string | null; amount?: number | string | null; monthly_amount?: number | string | null; start_date?: string | null; end_date?: string | null }): string {
  const amt = Number(rc.amount ?? rc.monthly_amount ?? 0);
  const per = rc.frequency === 'yearly' ? 'year' : 'month';
  const d = (s: string) => new Date(s + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const range = rc.start_date || rc.end_date ? ` · ${rc.start_date ? d(rc.start_date) : 'Any time'} – ${rc.end_date ? d(rc.end_date) : 'ongoing'}` : '';
  return `$${amt.toLocaleString('en-US', { maximumFractionDigits: 2 })} / ${per}${range}`;
}
