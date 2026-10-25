// Parser registry + dispatcher. Given an uploaded file and a source key, turn
// it into normalized transaction rows:
//   { date, description, rawDescription, amount, rawCategory, source }
// Categorization and dedup happen downstream in the upload route.
const { fileToRows, findHeaderRow } = require('./util');
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
 * header exactly (same column names; only the date FORMAT differs), so they
 * resolve to 'bankofamerica' here. Auto-detection is scoped to the three
 * statement formats actually uploaded (BoA, Amex, SoFi); Capital One can still
 * be parsed explicitly via parseFile(buffer, filename, 'capitalone').
 *
 * @param {Array<Array>} rows  2D array of raw cells (from fileToRows)
 * @returns {string|null} a SOURCES key, or null if undetected
 */
function detectSource(rows) {
  // SoFi — only SoFi pairs Date/Description/Amount with a 'Type' column.
  if (findHeaderRow(rows, ['Date', 'Description', 'Type', 'Amount']) !== -1) return 'sofi';
  // Amex — the 'Card Member' column is unique to Amex statements.
  if (findHeaderRow(rows, ['Date', 'Description', 'Amount', 'Card Member']) !== -1) return 'amex_gold';
  // Bank of America credit-card layout (also matches Capital One; see note).
  if (findHeaderRow(rows, ['Transaction Date', 'Description', 'Debit', 'Credit']) !== -1) {
    return 'bankofamerica';
  }
  // Bank of America checking-statement layout.
  if (findHeaderRow(rows, ['Date', 'Description', 'Amount', 'Running Bal.']) !== -1) {
    return 'bankofamerica';
  }
  return null;
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
