// SoFi parser.
// Columns: Date, Description, Type, Amount, Current balance, Status
//   * Amount is already signed (negative = withdrawal, positive = deposit)
//   * dates may be YYYY-MM-DD or MM/DD/YYYY
//   * skip internal SoFi<->SoFi transfers (Type contains 'Transfer')
// The `Type` column is passed through as rawCategory so categorize() can tell a
// Franchise World *deposit* (Paycheck) apart from other activity.
const { toISODate, parseAmount, findHeaderRow, columnMap } = require('./util');

const SOURCE = 'SoFi';

function parseRows(rows) {
  const headerIdx = findHeaderRow(rows, ['Date', 'Description', 'Amount']);
  if (headerIdx === -1) return [];
  const col = columnMap(rows[headerIdx]);

  const cDate = col.date;
  const cDesc = col.description;
  const cType = col.type;
  const cAmount = col.amount;

  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const description = String(row[cDesc] ?? '').trim();
    const date = toISODate(row[cDate]);
    if (!date || !description) continue;

    const type = cType != null ? String(row[cType] ?? '').trim() : '';
    // Skip internal transfers between SoFi accounts.
    if (/transfer/i.test(type)) continue;

    const amount = parseAmount(row[cAmount]);
    if (Number.isNaN(amount)) continue;

    out.push({
      date,
      description,
      rawDescription: description,
      amount, // already signed
      rawCategory: type,
      source: SOURCE,
    });
  }
  return out;
}

module.exports = { parseRows, SOURCE };
