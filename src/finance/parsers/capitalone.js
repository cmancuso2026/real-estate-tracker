// Capital One credit-card parser.
// Export columns: Transaction Date, Posted Date, Card No., Description,
//                 Category, Debit, Credit
//   * Debit is a purchase (expense)  -> store as negative
//   * Credit is a refund/return      -> store as positive
//   * dates are YYYY-MM-DD
//   * 'Payment/Credit' rows are the card-side of a bill payment; they land in
//     the Credit column (positive) and are KEPT, categorized into the 'Capital
//     One' wash category. They offset the negative bank-side payment (the
//     SoFi/BofA "CAPITAL ONE" outflow) so the category nets to ~zero. Dropping
//     them would leave the bank-side payment double-counting the real charges.
// The bank-provided Category column is passed through as rawCategory so
// categorize() can lean on it.
const { toISODate, parseAmount, findHeaderRow, columnMap } = require('./util');

const SOURCE = 'Capital One';

function parseRows(rows) {
  const headerIdx = findHeaderRow(rows, ['Transaction Date', 'Description', 'Debit', 'Credit']);
  if (headerIdx === -1) return [];
  const col = columnMap(rows[headerIdx]);

  const cDate = col['transaction date'];
  const cDesc = col.description;
  const cCat = col.category;
  const cDebit = col.debit;
  const cCredit = col.credit;

  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const description = String(row[cDesc] ?? '').trim();
    const date = toISODate(row[cDate]);
    if (!date || !description) continue;

    const rawCategory = cCat != null ? String(row[cCat] ?? '').trim() : '';

    const debit = parseAmount(row[cDebit]);
    const credit = parseAmount(row[cCredit]);
    let amount;
    if (!Number.isNaN(debit)) amount = -Math.abs(debit); // purchase -> negative
    else if (!Number.isNaN(credit)) amount = Math.abs(credit); // refund -> positive
    else continue;

    out.push({
      date,
      description,
      rawDescription: description,
      amount,
      rawCategory,
      source: SOURCE,
    });
  }
  return out;
}

module.exports = { parseRows, SOURCE };
