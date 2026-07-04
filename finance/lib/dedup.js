// Deterministic dedup hash for a transaction. Overlapping CSV uploads (e.g.
// re-exporting last month) must never create duplicates, so the hash is stable
// across uploads: same date + description + amount + source => same hash.
const crypto = require('crypto');

/**
 * @param {string} date         ISO date string, e.g. '2026-04-28'
 * @param {string} description  raw merchant string
 * @param {number|string} amount signed amount
 * @param {string} source       normalized source label
 * @returns {string} 32-char hex hash
 */
function dedupHash(date, description, amount, source) {
  const str = `${date}|${String(description).trim().toUpperCase()}|${Number(amount).toFixed(2)}|${source}`;
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 32);
}

module.exports = { dedupHash };
