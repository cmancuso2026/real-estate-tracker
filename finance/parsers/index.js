// Parser registry + dispatcher. Given an uploaded file and a source key, turn
// it into normalized transaction rows:
//   { date, description, rawDescription, amount, rawCategory, source }
// Categorization and dedup happen downstream in the upload route.
const { fileToRows } = require('./util');
const bankofamerica = require('./bankofamerica');
const amex = require('./amex');
const sofi = require('./sofi');

// Valid `source` values accepted by POST /api/upload -> display label + parser.
const SOURCES = {
  bankofamerica: { display: 'Bank of America', parse: (rows) => bankofamerica.parseRows(rows) },
  amex_gold: { display: 'Amex Gold', parse: (rows) => amex.parseRows(rows, 'Amex Gold') },
  amex_blue: { display: 'Amex Blue', parse: (rows) => amex.parseRows(rows, 'Amex Blue') },
  sofi: { display: 'SoFi', parse: (rows) => sofi.parseRows(rows) },
};

function displayFor(sourceKey) {
  return SOURCES[sourceKey] ? SOURCES[sourceKey].display : sourceKey;
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

module.exports = { parseFile, SOURCES, displayFor };
