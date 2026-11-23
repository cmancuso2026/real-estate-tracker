// Knex CLI configuration (e.g. `npx knex --knexfile src/finance/knexfile.js migrate:status`).
// Uses the same single DATABASE_URL as the rest of the app; see db/connection.js.
import 'dotenv/config';
import { financeKnexConfig } from './db/connection.js';

const shared = financeKnexConfig();

export default {
  development: shared,
  production: shared,
};
