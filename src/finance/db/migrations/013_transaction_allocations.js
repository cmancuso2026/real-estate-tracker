/**
 * transaction_allocations: one transaction split across properties.
 *
 * Each row gives part of a transaction (amount, same sign as the transaction)
 * to a property, optionally a unit and a project. A transaction is attributed
 * when its rows add up to its amount. percent / input_mode record how the split
 * was entered (percentages or dollar amounts).
 *
 * Existing single attributions (transactions.property_id) become one 100% row
 * each; the migration checks the counts and stops if they differ. The old
 * columns are left in place (nothing reads or writes them any more) as a
 * copy of the original attributions; src/finance/db/later/014_… drops them
 * in a later release, once splits have been checked in production.
 *
 * attribution_overrides.allocations_json remembers a split by dedup_hash so a
 * re-uploaded row gets it back (like category_overrides).
 *
 * property_id cascades on delete: deleting a property sends its transactions
 * back to Needs Property, as the old ON DELETE SET NULL column did.
 */
export async function up(knex) {
  if (!(await knex.schema.hasTable('transaction_allocations'))) {
    await knex.schema.createTable('transaction_allocations', (t) => {
      t.increments('id').primary();
      t.integer('transaction_id').notNullable().references('id').inTable('transactions').onDelete('CASCADE');
      t.integer('property_id').notNullable().references('id').inTable('owned_properties').onDelete('CASCADE');
      t.integer('unit_id').nullable().references('id').inTable('units').onDelete('SET NULL');
      t.integer('work_order_id').nullable().references('id').inTable('work_orders').onDelete('SET NULL');
      t.decimal('amount', 10, 2).notNullable();
      t.decimal('percent', 6, 3).nullable();
      t.text('input_mode').nullable();
      t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      t.index('transaction_id', 'idx_transaction_allocations_transaction');
      t.index('property_id', 'idx_transaction_allocations_property');
      t.index('work_order_id', 'idx_transaction_allocations_work_order');
    });
    await knex.raw(
      "ALTER TABLE transaction_allocations ADD CONSTRAINT transaction_allocations_input_mode_check CHECK (input_mode IN ('percent', 'amount'))",
    );
  }
  if (!(await knex.schema.hasColumn('attribution_overrides', 'allocations_json'))) {
    await knex.schema.alterTable('attribution_overrides', (t) => t.text('allocations_json').nullable());
  }

  // Copy single attributions → one 100% allocation each (only rows that have none yet).
  if (await knex.schema.hasColumn('transactions', 'property_id')) {
    const have = new Set((await knex('transaction_allocations').distinct('transaction_id')).map((r) => Number(r.transaction_id)));
    const rows = (await knex('transactions').whereNotNull('property_id').select('id', 'amount', 'property_id', 'unit_id', 'work_order_id'))
      .filter((r) => r.property_id != null && !have.has(Number(r.id)));
    for (let i = 0; i < rows.length; i += 500) {
      await knex('transaction_allocations').insert(
        rows.slice(i, i + 500).map((r) => ({
          transaction_id: r.id,
          property_id: r.property_id,
          unit_id: r.unit_id ?? null,
          work_order_id: r.work_order_id ?? null,
          amount: r.amount,
          percent: 100,
          input_mode: 'percent',
        })),
      );
    }
    // Verify: every attributed transaction has exactly one allocation for its full amount.
    const attributed = (await knex('transactions').whereNotNull('property_id').select('id', 'amount', 'property_id')).filter((r) => r.property_id != null);
    const allocs = await knex('transaction_allocations').select('transaction_id', 'amount', 'property_id');
    const byTxn = new Map();
    for (const a of allocs) byTxn.set(Number(a.transaction_id), [...(byTxn.get(Number(a.transaction_id)) || []), a]);
    const bad = attributed.filter((t) => {
      const list = byTxn.get(Number(t.id)) || [];
      const sum = list.reduce((s, a) => s + Math.round(Number(a.amount) * 100), 0);
      return sum !== Math.round(Number(t.amount) * 100);
    });
    if (bad.length) {
      throw new Error(`transaction_allocations check failed: ${bad.length} of ${attributed.length} attributed transactions don't match (e.g. id ${bad[0].id}). Nothing was dropped.`);
    }
    console.log(`  ✓ transaction_allocations: ${attributed.length} attributed transactions copied as 100% allocations`);
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('attribution_overrides', 'allocations_json')) {
    await knex.schema.alterTable('attribution_overrides', (t) => t.dropColumn('allocations_json'));
  }
  await knex.schema.dropTableIfExists('transaction_allocations');
}
