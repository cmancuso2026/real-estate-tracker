// Parser registry + dispatcher. Given an uploaded file and a source key, turn
// it into normalized transaction rows:
//   { date, description, rawDescription, amount, rawCategory, source }
// Categorization and dedup happen downstream in the upload route.
const { fileToRows, findHeaderRow, columnMap } = require('./util');
const bankofamerica = require('./bankofamerica');
const amex = require('./amex');
const sofi = require('./sofi');
const capitalone = require('./capitalone');

// Valid `source` values accepted by POST /api/upload -> display label + parser.
const SOURCES = {
  bankofamerica: { display: 'Bank of America', parse: (rows) => bankofamerica.parseRows(rows) },
  amex_gold: { display: 'Amex Gold', parse: (rows) => amex.parseRows(rows, 'Amex Gold') },
  amex_blue: { display: 'Amex Blue', parse: (rows) => amex.parseRows(rows, 'Amex Blue') },
  sofi: { display: 'SoFi', parse: (rows) => sofi.parseRows(rows) },
  capitalone: { display: 'Capital One', parse: (rows) => capitalone.parseRows(rows) },
};

function displayFor(sourceKey) {
  return SOURCES[sourceKey] ? SOURCES[sourceKey].display : sourceKey;
}

/**
 * Infer the source format from a file's column headers, so the user never has to
 * pick one. Returns a SOURCES key or null when nothing matches.
 *
 * Each format is distinguished by a column that only it carries:
 *   - SoFi            — a 'Type' column (Direct Deposit / Withdrawal / …)
 *   - Amex            — a 'Card Member' column
 *   - Bank of America — credit-card: 'Transaction Date' + 'Debit'/'Credit';
 *                       checking:    'Date' + 'Amount' + 'Running Bal.'
 *
 * Note: Capital One credit-card exports share Bank of America's credit-card
 * header EXACTLY (same column names); they're told apart by the Transaction Date
 * format — Capital One writes ISO (YYYY-MM-DD), Bank of America writes US
 * (MM/DD/YYYY). Getting this right matters: a Capital One file mis-labeled "Bank
 * of America" is parsed by the wrong ruleset and (historically) dodged dedup.
 *
 * @param {Array<Array>} rows  2D array of raw cells (from fileToRows)
 * @returns {string|null} a SOURCES key, or null if undetected
 */
function detectSource(rows) {
  // SoFi — only SoFi pairs Date/Description/Amount with a 'Type' column.
  if (findHeaderRow(rows, ['Date', 'Description', 'Type', 'Amount']) !== -1) return 'sofi';
  // Amex — the 'Card Member' column is unique to Amex statements.
  if (findHeaderRow(rows, ['Date', 'Description', 'Amount', 'Card Member']) !== -1) return 'amex_gold';
  // Credit-card layout shared by Bank of America and Capital One — disambiguate
  // by the date format in the data rows.
  const ccIdx = findHeaderRow(rows, ['Transaction Date', 'Description', 'Debit', 'Credit']);
  if (ccIdx !== -1) return creditCardSourceByDateFormat(rows, ccIdx);
  // Bank of America checking-statement layout.
  if (findHeaderRow(rows, ['Date', 'Description', 'Amount', 'Running Bal.']) !== -1) {
    return 'bankofamerica';
  }
  return null;
}

// BoA credit-card vs Capital One: both export the same header, so look at the
// first Transaction Date value. ISO (2026-06-21) -> Capital One; US (06/21/2026)
// -> Bank of America. Defaults to Bank of America when it can't tell.
function creditCardSourceByDateFormat(rows, headerIdx) {
  const col = columnMap(rows[headerIdx]);
  const cDate = col['transaction date'];
  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const v = String((rows[i] || [])[cDate] ?? '').trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return 'capitalone';
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(v)) return 'bankofamerica';
  }
  return 'bankofamerica';
}

/**
 * Parse an uploaded file WITHOUT being told its source: detect the format from
 * the headers, then parse. Throws a 422 when the format can't be recognized.
 *
 * @param {Buffer} buffer    uploaded file contents
 * @param {string} filename  original filename (used to detect CSV vs XLSX)
 * @returns {{ sourceKey: string, source: string, transactions: Array }}
 */
function parseFileAuto(buffer, filename) {
  const rows = fileToRows(buffer, filename);
  const sourceKey = detectSource(rows);
  if (!sourceKey) {
    const err = new Error(
      `Could not auto-detect the source of '${filename}'. ` +
        'Expected Bank of America, Amex, or SoFi column headers.'
    );
    err.status = 422;
    throw err;
  }
  const entry = SOURCES[sourceKey];
  const transactions = entry.parse(rows);
  return { sourceKey, source: entry.display, transactions };
}

/**
 * @param {Buffer} buffer     uploaded file contents
 * @param {string} filename   original filename (used to detect CSV vs XLSX)
 * @param {string} sourceKey  one of the SOURCES keys
 * @returns {{ source: string, transactions: Array }}
 */
function parseFile(buffer, filename, sourceKey) {
  const entry = SOURCES[sourceKey];
  if (!entry) {
    const err = new Error(
      `Unknown source '${sourceKey}'. Expected one of: ${Object.keys(SOURCES).join(', ')}`
    );
    err.status = 400;
    throw err;
  }
  const rows = fileToRows(buffer, filename);
  const transactions = entry.parse(rows);
  return { source: entry.display, transactions };
}

module.exports = { parseFile, parseFileAuto, detectSource, SOURCES, displayFor };
