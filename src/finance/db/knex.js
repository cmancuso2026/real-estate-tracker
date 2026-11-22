// Shared Knex instance used by every route. Import this rather than creating
// new connections per-module so we reuse a single pool.
import knexFactory from 'knex';
import pg from 'pg';
import config from '../knexfile.js';

// node-postgres parses DATE (OID 1082) into a JS Date at local midnight, which
// shifts the day in non-UTC zones. Keep DATE as the raw 'YYYY-MM-DD' string.
pg.types.setTypeParser(1082, (v) => v);

const env = process.env.NODE_ENV === 'production' ? 'production' : 'development';
const knex = knexFactory(config[env]);

export default knex;
