// Account balances from a Bank of America deposit-account export (checking or
// savings — same layout), for the cash position chart. Separate from the
// transaction parser (parsers/bankofamerica.js), which is left exactly as it is.
//
// The export has a summary block, then rows of
//   Date, Description, Amount, Running Bal.
// including "Beginning balance as of MM/DD/YYYY" (no amount, a balance).
// For each date we keep that day's closing balance. Rows may be listed oldest
// or newest first; the order is worked out from the running balances.
import { columnMap, fileToRows, findHeaderRow, parseAmount, toISODate } from './util.js';

const near = (a, b) => Math.abs(a - b) < 0.005;
const dayBefore = (d) => {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
};

/**
 * → { begin: { date, balance } | null, points: [{ date, balance }], kind } (one point
 * per day, sorted), or null if the file isn't a BofA deposit-account export.
 * begin = the opening balance ("Beginning balance as of …"), i.e. the balance
 * before the file's first day. kind: 'Savings' when the file has interest
 * lines, else 'Checking' — only a starting name, renamable.
 */
export function bofaDepositBalancesFromRows(rows) {
  const idx = findHeaderRow(rows, ['Date', 'Description', 'Amount', 'Running Bal.']);
  if (idx === -1) return null;
  const col = columnMap(rows[idx]);
  const cBal = col['running bal.'] ?? col['running bal'] ?? col['running balance'];
  if (cBal == null) return null;

  // Summary block above the header: "Ending balance as of MM/DD/YYYY, , 7,050.00"
  // → the closing balance on the statement's last day.
  let end = null;
  for (let i = 0; i < idx; i += 1) {
    const cells = (rows[i] || []).map((c) => String(c ?? '').trim());
    const m = cells.join(' ').match(/ending balance as of\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (!m) continue;
    const amt = cells.map((c) => parseAmount(c)).filter((n) => !Number.isNaN(n)).pop();
    const d = toISODate(m[1]);
    if (d && amt != null) end = { date: d, balance: amt };
  }

  let begin = null;
  let interest = false; // savings accounts show "Interest Earned" lines
  const lines = []; // transaction rows in file order: { date, amount, balance }
  for (let i = idx + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const date = toISODate(row[col.date]);
    const description = String(row[col.description] ?? '');
    const balance = parseAmount(row[cBal]);
    if (!date || Number.isNaN(balance)) continue;
    if (/beginning balance as of/i.test(description)) {
      begin = { date, balance };
      continue;
    }
    const amount = parseAmount(row[col.amount]);
    if (Number.isNaN(amount)) continue;
    if (/interest earned/i.test(description)) interest = true;
    lines.push({ date, amount, balance });
  }

  // Oldest first if each running balance = the previous one + this amount.
  let fwd = 0;
  let back = 0;
  for (let i = 1; i < lines.length; i += 1) {
    if (near(lines[i].balance, lines[i - 1].balance + lines[i].amount)) fwd += 1;
    if (near(lines[i - 1].balance, lines[i].balance + lines[i - 1].amount)) back += 1;
  }
  const ordered = back > fwd ? [...lines].reverse() : lines;

  if (!begin && ordered.length) begin = { date: ordered[0].date, balance: ordered[0].balance - ordered[0].amount };
  const byDate = new Map();
  // The opening balance is the previous day's closing balance: stored on that
  // day, so statements of the same account share a day and match up.
  if (begin) byDate.set(dayBefore(begin.date), begin.balance);
  for (const l of ordered) byDate.set(l.date, l.balance); // the day's last line wins = closing balance
  if (end && !byDate.has(end.date)) byDate.set(end.date, end.balance);
  const points = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, balance]) => ({ date, balance }));
  return { begin, points, kind: interest ? 'Savings' : 'Checking' };
}

export function bofaDepositBalances(buffer, filename) {
  try {
    return bofaDepositBalancesFromRows(fileToRows(buffer, filename));
  } catch {
    return null;
  }
}
