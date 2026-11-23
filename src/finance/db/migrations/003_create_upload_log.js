/**
 * upload_log — one row per file upload, recording how many rows were parsed,
 * newly inserted, and skipped as duplicates.
 */
export async function up(knex) {
  await knex.schema.createTable('upload_log', (t) => {
    t.increments('id').primary();
    t.text('filename');
    t.text('source');
    t.integer('row_count');
    t.integer('new_rows');
    t.integer('skipped');
    t.timestamp('uploaded_at', { useTz: true }).defaultTo(knex.fn.now());
  });
};

export async function down(knex) {
  await knex.schema.dropTableIfExists('upload_log');
};
