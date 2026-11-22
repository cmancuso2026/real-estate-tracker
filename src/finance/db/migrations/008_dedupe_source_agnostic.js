/**
 * Make dedup source-agnostic and purge the duplicates that the old
 * source-scoped hash let through.
 *
 * The dedup hash used to include `source`, so the same real charge imported under
 * two different source labels (a Capital One file auto-detected as "Bank of
 * America"; an Amex Blue file detected as "Amex Gold") produced two different
 * hashes and slipped past dedup. It also didn't collapse internal whitespace, so
 * re-exports that reflowed spaces ("NA PA" vs "NA  PA") duplicated too.
 *
 * This migration:
 *   1. Groups rows by the new canonical key (date + collapsed-uppercase
 *      raw/description + amount, NO source) and deletes all but one per group —
 *      keeping a manually-categorized row if present, else the earliest (lowest
 *      id), so user edits and the original source label survive.
 *   2. Recomputes dedup_hash for every remaining row with the new formula, so the
 *      UNIQUE(dedup_hash) index enforces source-agnostic dedup from here on.
 *
 * Irreversible (deletes data); `down` is a no-op.
 */
import crypto from 'crypto';

function fmtDate(d) {
  if (d == null) return '';
  if (d instanceof Date) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
      d.getUTCDate(),
    ).padStart(2, '0')}`;
  }
  return String(d).slice(0, 10);
}

function canonicalKey(row) {
  const desc = String(row.raw_description || row.description || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  return `${fmtDate(row.date)}|${desc}|${Number(row.amount).toFixed(2)}`;
}

function hashOf(key) {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
}

export async function up(knex) {
  const rows = await knex('transactions').select(
    'id',
    'date',
    'amount',
    'description',
    'raw_description',
    'is_manual',
  );

  const groups = new Map();
  for (const r of rows) {
    const k = canonicalKey(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }

  const toDelete = [];
  for (const rs of groups.values()) {
    if (rs.length < 2) continue;
    // Keep a manual row if any, else the lowest id.
    rs.sort((a, b) => Number(!!b.is_manual) - Number(!!a.is_manual) || a.id - b.id);
    for (let i = 1; i < rs.length; i += 1) toDelete.push(rs[i].id);
  }

  for (let i = 0; i < toDelete.length; i += 500) {
    await knex('transactions').whereIn('id', toDelete.slice(i, i + 500)).del();
  }

  // Recompute dedup_hash for all remaining rows (dups removed -> no collisions).
  const remaining = await knex('transactions').select(
    'id',
    'date',
    'amount',
    'description',
    'raw_description',
  );
  for (const r of remaining) {
    await knex('transactions').where({ id: r.id }).update({ dedup_hash: hashOf(canonicalKey(r)) });
  }
};

export async function down() {
  // Deleted duplicates can't be restored; nothing to do.
};
