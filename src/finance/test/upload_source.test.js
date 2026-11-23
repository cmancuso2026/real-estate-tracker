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

    // Detected (no source): same rows, so all duplicates regardless of the label.
    const again = await processUpload(knex, [file('amex_gold.csv')]);
    assert.deepEqual(again.by_source.map((s) => s.source), ['Amex Gold']);
    assert.equal(again.new_rows, 0);
    assert.equal(again.skipped, blue.new_rows);
  } finally {
    await knex.destroy();
  }
});
