// Guards the single shared database: the tracker's schema.sql and the finance
// Knex migrations both create tables in the same `public` schema, so a name
// used by both would silently share (or break) a table. Fails if they overlap.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_SQL = path.join(__dirname, '..', '..', 'db', 'schema.sql');
const MIGRATIONS = path.join(__dirname, '..', 'db', 'migrations');

function trackerTables() {
  const sql = fs.readFileSync(SCHEMA_SQL, 'utf8');
  return new Set([...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/gi)].map((m) => m[1].toLowerCase()));
}

function financeTables() {
  const names = new Set(['knex_migrations', 'knex_migrations_lock']); // created by Knex itself
  for (const f of fs.readdirSync(MIGRATIONS).filter((n) => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
    for (const m of src.matchAll(/createTable(?:IfNotExists)?\(\s*'(\w+)'/g)) names.add(m[1].toLowerCase());
  }
  return names;
}

test('tracker schema.sql and finance migrations create disjoint tables', () => {
  const tracker = trackerTables();
  const finance = financeTables();
  assert.ok(tracker.has('owned_properties') && tracker.has('work_orders'), 'parsed schema.sql');
  assert.ok(finance.has('transactions'), 'parsed finance migrations');
  const overlap = [...finance].filter((t) => tracker.has(t));
  assert.deepStrictEqual(overlap, [], `table name(s) used by both: ${overlap.join(', ')}`);
});

test('finance data tables named in the data-migration runbook exist in the migrations', () => {
  const finance = financeTables();
  for (const t of ['transactions', 'category_overrides', 'upload_log', 'custom_categories', 'knex_migrations']) {
    assert.ok(finance.has(t), `${t} is created by the finance migrations`);
  }
});
