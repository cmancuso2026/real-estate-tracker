// Change log for admin actions (admin_audit). Every admin write goes through
// writeAudit inside the same DB transaction as the change itself.

/**
 * @param {import('knex').Knex} trx
 * @param {string} action   e.g. 'category.rename', 'rule.create', 'settings.update'
 * @param {string} summary  one human-readable line
 * @param {unknown} before  state before (JSON-serializable), or null
 * @param {unknown} after   state after, or null
 */
export async function writeAudit(trx, action, summary, before, after) {
  await trx('admin_audit').insert({
    action,
    summary,
    before: before == null ? null : JSON.stringify(before),
    after: after == null ? null : JSON.stringify(after),
  });
}

/** Most recent first. */
export async function listAudit(knex, { limit = 200 } = {}) {
  const rows = await knex('admin_audit').select('*').orderBy('id', 'desc').limit(Math.min(Number(limit) || 200, 1000));
  const parse = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);
  return rows.map((r) => ({ ...r, before: parse(r.before), after: parse(r.after) }));
}
