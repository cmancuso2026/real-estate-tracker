import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getPool, closeDb } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Applies schema.sql to the database. Idempotent (every statement is IF NOT EXISTS). */
export async function initDb(): Promise<void> {
  const schema = readFileSync(join(here, 'schema.sql'), 'utf8');
  await getPool().query(schema);
}

// Allow running directly:  npm run db:init
if (import.meta.url === `file://${process.argv[1]}`) {
  initDb()
    .then(() => console.log('✓ Database schema initialized.'))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
