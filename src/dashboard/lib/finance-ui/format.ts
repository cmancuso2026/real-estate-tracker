/** '+$1,234.56' / '-$1,234.56' (the old page's fmt). */
export function fmt(n: number): string {
  const s = Math.abs(n)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? '-$' : '+$') + s;
}

/** '+$1.2k' / '-$950' (the old page's fmtShort). */
export function fmtShort(n: number): string {
  const abs = Math.abs(n);
  const s = abs >= 1000 ? (abs / 1000).toFixed(1) + 'k' : abs.toFixed(0);
  return (n < 0 ? '-$' : '+$') + s;
}

export const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MON_SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Apr 28' */
export function shortDate(date: string): string {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
