// Bank of America parser.
//
// BoA exports come in two shapes, and this parser auto-detects which it's given:
//
//   1. Credit-card / activity export:
//        Transaction Date, Posted Date, Card No., Description, Category, Debit, Credit
//      amount = -Debit for expenses, +Credit for credits.
//
//   2. Checking / deposit-account statement (what you download from a bank
//      account's Activity → Download):
//        Date, Description, Amount, Running Bal.
//      preceded by a summary block (Beginning/Total/Ending balance rows).
//      `Amount` is already signed (deposits positive, debits negative), and the
//      "Beginning/Ending balance as of …" rows carry no amount, so they drop out.
//
// Both skip Capital One payments that appear as *credits* (those inflows are
// captured on the SoFi side, so importing them here would double-count).
// Dates are MM/DD/YYYY.
const { toISODate, parseAmount, findHeaderRow, columnMap } = require('./util');

const SOURCE = 'Bank of America';

// Format 1: separate Debit / Credit columns.
function parseCreditCard(rows, headerIdx) {
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

    if (hasCredit && /CAPITAL ONE/i.test(description)) continue;

    let amount;
    if (hasCredit) amount = credit;
    else if (!Number.isNaN(debit)) amount = -Math.abs(debit);
    else continue;

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

// Format 2: single signed Amount column (checking statement).
function parseChecking(rows, headerIdx) {
  const col = columnMap(rows[headerIdx]);
  const cDate = col.date;
  const cDesc = col.description;
  const cAmount = col.amount;

  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const description = String(row[cDesc] ?? '').trim();
    const date = toISODate(row[cDate]);
    if (!date || !description) continue;

    // Summary / balance rows ("Beginning balance as of …") have no amount.
    if (/balance as of/i.test(description)) continue;

    const amount = parseAmount(row[cAmount]);
    if (Number.isNaN(amount)) continue; // rows without an amount aren't transactions

    // A Capital One *credit* (refund/inflow) is tracked on the SoFi side.
    if (amount > 0 && /CAPITAL ONE/i.test(description)) continue;

    out.push({
      date,
      description,
      rawDescription: description,
      amount, // already signed
      rawCategory: '',
      source: SOURCE,
    });
  }
  return out;
}

function parseRows(rows) {
  // Prefer the credit-card layout (its header names 'Transaction Date').
  const ccIdx = findHeaderRow(rows, ['Transaction Date', 'Description']);
  if (ccIdx !== -1) return parseCreditCard(rows, ccIdx);

  // Otherwise fall back to the checking-statement layout.
  const chkIdx = findHeaderRow(rows, ['Date', 'Description', 'Amount']);
  if (chkIdx !== -1) return parseChecking(rows, chkIdx);

  return [];
}

module.exports = { parseRows, SOURCE };
