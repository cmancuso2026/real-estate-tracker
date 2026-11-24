// Upload: optional source override (Amex Gold vs Blue can't be detected) and the
// summary fields the upload page shows.
process.env.TZ = 'UTC';

import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { newDb } from 'pg-mem';

import { createTrackerStubs } from './helpers/tracker-stubs.js';
import { processUpload } from '../services/upload.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(__dirname, '..', 'db', 'migrations');
const file = (name) => ({ buffer: fs.readFileSync(path.join(__dirname, 'fixtures', name)), originalname: name });

test('upload: source override, summary fields', async () => {
  const knex = newDb({ noAstCoverageCheck: true }).adapters.createKnex();
  try {
    await createTrackerStubs(knex);
    await knex.migrate.latest({ directory: MIGRATIONS });

    await assert.rejects(processUpload(knex, [file('amex_gold.csv')], { sourceKey: 'nope' }), /Unknown source 'nope'/);

    const blue = await processUpload(knex, [file('amex_gold.csv')], { sourceKey: 'amex_blue' });
    assert.deepEqual(blue.by_source.map((s) => s.source), ['Amex Blue']);
    assert.ok(blue.new_rows > 0);
    assert.equal(typeof blue.needs_property, 'number');
    assert.deepEqual(Object.keys(blue.rent).sort(), ['already_recorded', 'matched', 'needs_unit']);

    // Detected (no source): the card is remembered by its account number, so
    // it's still Amex Blue; same rows, so all duplicates.
    const again = await processUpload(knex, [file('amex_gold.csv')]);
    assert.deepEqual(again.by_source.map((s) => s.source), ['Amex Blue']);
    assert.equal(again.new_rows, 0);
    assert.equal(again.skipped, blue.new_rows);
    assert.equal(again.relabeled, 0);
  } finally {
    await knex.destroy();
  }
});

test('upload: rows first labeled Amex Gold are relabeled when the file is uploaded as Amex Blue', async () => {
  const knex = newDb({ noAstCoverageCheck: true }).adapters.createKnex();
  try {
    await createTrackerStubs(knex);
    await knex.migrate.latest({ directory: MIGRATIONS });
    const sources = async () => (await knex('transactions').distinct('source')).map((r) => r.source).sort();

    const first = await processUpload(knex, [file('amex_gold.csv')]); // detected: every Amex file used to be Gold
    assert.deepEqual(await sources(), ['Amex Gold']);

    const asBlue = await processUpload(knex, [file('amex_gold.csv')], { sourceKey: 'amex_blue' });
    assert.equal(asBlue.new_rows, 0);
    assert.equal(asBlue.relabeled, first.new_rows, 'every existing row from the file now says Amex Blue');
    assert.deepEqual(await sources(), ['Amex Blue']);
    assert.deepEqual(await knex('source_accounts').select('account_key', 'source_key'), [{ account_key: 'amex:1-21004', source_key: 'amex_blue' }]);

    // picking Gold again moves them back (you can correct a wrong pick)
    const asGold = await processUpload(knex, [file('amex_gold.csv')], { sourceKey: 'amex_gold' });
    assert.equal(asGold.relabeled, first.new_rows);
    assert.deepEqual(await sources(), ['Amex Gold']);
  } finally {
    await knex.destroy();
  }
});
