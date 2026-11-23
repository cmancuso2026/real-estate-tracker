/**
 * Drop transactions.property_id / unit_id / work_order_id: every reader now
 * uses transaction_allocations (013 copied them and verified the counts).
 * down() puts the columns back, filled from transactions with exactly one
 * allocation (a split can't be represented by one column).
 */
const COLS = [
  ['property_id', 'owned_properties'],
  ['work_order_id', 'work_orders'],
  ['unit_id', 'units'],
];

export async function up(knex) {
  for (const [col] of COLS) {
    if (await knex.schema.hasColumn('transactions', col)) {
      await knex.raw(`DROP INDEX IF EXISTS idx_transactions_${col}`);
      await knex.schema.alterTable('transactions', (t) => t.dropColumn(col));
    }
  }
}

export async function down(knex) {
  for (const [col, table] of COLS) {
    if (!(await knex.schema.hasColumn('transactions', col))) {
      await knex.schema.alterTable('transactions', (t) => {
        t.integer(col).nullable().references('id').inTable(table).onDelete('SET NULL');
        t.index(col, `idx_transactions_${col}`);
      });
    }
  }
  const singles = await knex('transaction_allocations')
    .select('transaction_id')
    .count({ n: '*' })
    .groupBy('transaction_id');
  const one = new Set(singles.filter((r) => Number(r.n) === 1).map((r) => Number(r.transaction_id)));
  for (const a of await knex('transaction_allocations').select('*')) {
    if (!one.has(Number(a.transaction_id))) continue;
    await knex('transactions').where({ id: a.transaction_id }).update({ property_id: a.property_id, unit_id: a.unit_id, work_order_id: a.work_order_id });
  }
}
