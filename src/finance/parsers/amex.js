// Amex parser (Gold + Blue Cash — the variant is chosen by the upload `source`).
// Amex exports carry metadata rows above the real header, so we locate the
// header dynamically (the row whose first cell is 'Date').
// Columns: Date, Description, Card Member, Account #, Amount, [Extended Details,
//          Appears On Statement, Address, City/State, Zip, Country, Reference, Category]
//   * Amount is positive for a charge (expense) -> flip sign to negative
//   * "Payment - Thank You" rows are the card-side of a bill payment; their
//     Amount is negative -> flips to positive. They are KEPT and land in the
//     'Amex' wash category, offsetting the negative bank-side payment (the
//     BofA/SoFi outflow) so the category nets to ~zero. Skipping them would
//     leave the bank-side payment double-counting against the real charges.
//   * dates are MM/DD/YYYY
import { toISODate, parseAmount, findHeaderRow, columnMap } from './util.js';

// source is the display label ('Amex Gold' | 'Amex Blue').
function parseRows(rows, source = 'Amex Gold') {
  const headerIdx = findHeaderRow(rows, ['Date', 'Description', 'Amount']);
  if (headerIdx === -1) return [];
  const col = columnMap(rows[headerIdx]);

  const cDate = col.date;
  const cDesc = col.description;
  const cAmount = col.amount;
  const cCat = col.category;

  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const description = String(row[cDesc] ?? '').trim();
    const date = toISODate(row[cDate]);
    if (!date || !description) continue;

    const raw = parseAmount(row[cAmount]);
    if (Number.isNaN(raw)) continue;
    // Amex charges are positive; store expenses as negative.
    const amount = -raw;

    out.push({
      date,
      description,
      rawDescription: description,
      amount,
      rawCategory: cCat != null ? String(row[cCat] ?? '').trim() : '',
      source,
    });
  }
  return out;
}

export { parseRows };
