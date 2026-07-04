// Capital One credit-card parser.
// Export columns: Transaction Date, Posted Date, Card No., Description,
//                 Category, Debit, Credit
//   * Debit is a purchase (expense)  -> store as negative
//   * Credit is a refund/return      -> store as positive
//   * dates are YYYY-MM-DD
//   * skip rows whose Category is 'Payment/Credit' — these are card payments
//     (the mirror of SoFi's "CAPITAL ONE" withdrawals), not real spending, so
//     importing them would double-count against the SoFi side.
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
    // Card payment (money moved from a bank account to pay the card) — internal.
    if (/payment\/credit/i.test(rawCategory)) continue;

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
