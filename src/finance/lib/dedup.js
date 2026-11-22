// Deterministic dedup hash for a transaction. Overlapping uploads (e.g.
// re-exporting last month) must never create duplicates, so the hash is stable
// across uploads: same date + description + amount => same hash.
//
// Deliberately SOURCE-AGNOSTIC. A real charge is a single event identified by
// its date, amount, and merchant text; it should dedupe no matter which file or
// account label it arrives under. Keying on source used to let the same charge
// slip in twice when its source was labeled differently across uploads — e.g. a
// Capital One export auto-detected as "Bank of America" (identical headers), or
// an Amex Blue file detected as "Amex Gold". Internal whitespace is also
// collapsed so a re-export that reflows spaces ("NA PA" vs "NA  PA") still
// matches.
const crypto = require('crypto');

/**
 * @param {string} date         ISO date string, e.g. '2026-04-28'
 * @param {string} description  raw merchant string
 * @param {number|string} amount signed amount
 * @returns {string} 32-char hex hash
 */
function dedupHash(date, description, amount) {
  const desc = String(description).trim().toUpperCase().replace(/\s+/g, ' ');
  const str = `${date}|${desc}|${Number(amount).toFixed(2)}`;
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 32);
}

module.exports = { dedupHash };
