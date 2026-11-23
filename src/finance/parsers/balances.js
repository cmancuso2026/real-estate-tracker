// Account balances from a Bank of America *checking* export, for the cash
// position chart. Separate from the transaction parser (parsers/
// bankofamerica.js), which is left exactly as it is.
//
// The checking export has a summary block, then rows of
//   Date, Description, Amount, Running Bal.
// including "Beginning balance as of MM/DD/YYYY" (no amount, a balance).
// For each date we keep the last running balance of the day (the file lists
// transactions oldest first), i.e. that day's closing balance.
import { columnMap, fileToRows, findHeaderRow, parseAmount, toISODate } from './util.js';

export const BOFA_CHECKING = 'Bank of America checking';

/** [{ date: 'YYYY-MM-DD', balance }] (one per day, sorted), or [] if the file isn't a BofA checking export. */
export function bofaCheckingBalancesFromRows(rows) {
  const idx = findHeaderRow(rows, ['Date', 'Description', 'Amount', 'Running Bal.']);
  if (idx === -1) return [];
  const col = columnMap(rows[idx]);
  const cBal = col['running bal.'] ?? col['running bal'] ?? col['running balance'];
  if (cBal == null) return [];
  const byDate = new Map();
  for (let i = idx + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const date = toISODate(row[col.date]);
    const balance = parseAmount(row[cBal]);
    if (!date || Number.isNaN(balance)) continue;
    byDate.set(date, balance); // later rows of the same day win
  }
  return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, balance]) => ({ date, balance }));
}

export function bofaCheckingBalances(buffer, filename) {
  try {
    return bofaCheckingBalancesFromRows(fileToRows(buffer, filename));
  } catch {
    return [];
  }
}
