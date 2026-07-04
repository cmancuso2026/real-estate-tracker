// Bank of America parser.
// Columns: Transaction Date, Posted Date, Card No., Description, Category, Debit, Credit
//   * amount = -Debit for expenses, +Credit for credits
//   * skip Capital One payments that appear as credits (tracked in SoFi instead)
//   * dates are MM/DD/YYYY
const { toISODate, parseAmount, findHeaderRow, columnMap } = require('./util');

const SOURCE = 'Bank of America';

function parseRows(rows) {
  const headerIdx = findHeaderRow(rows, ['Transaction Date', 'Description']);
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

    const debit = parseAmount(row[cDebit]);
    const credit = parseAmount(row[cCredit]);
    const hasCredit = !Number.isNaN(credit);

    // Skip Capital One payments that show up as credits — those are captured
    // on the SoFi side, so importing them here would double-count.
    if (hasCredit && /CAPITAL ONE/i.test(description)) continue;

    let amount;
    if (hasCredit) amount = credit; // credits are already positive
    else if (!Number.isNaN(debit)) amount = -Math.abs(debit); // debits -> negative
    else continue; // neither column populated

    out.push({
      date,
      description,
      rawDescription: description,
      amount,
      rawCategory: cCat != null ? String(row[cCat] ?? '').trim() : '',
      source: SOURCE,
    });
  }
  return out;
}

module.exports = { parseRows, SOURCE };
