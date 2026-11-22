// Knex configuration.
//
// On Railway a Postgres plugin injects DATABASE_URL. Locally you can set
// DATABASE_URL in a .env file (see .env.example). SSL is enabled in production
// because Railway's managed Postgres requires it.
require('dotenv').config();

const connection = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      // Railway's managed PG uses a self-signed cert; relax verification in prod.
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    }
  : {
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT) || 5432,
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
      database: process.env.PGDATABASE || 'mancuso_tracker',
    };

const shared = {
  client: 'pg',
  connection,
  pool: { min: 0, max: 10 },
  migrations: {
    directory: './db/migrations',
    tableName: 'knex_migrations',
  },
};

module.exports = {
  development: shared,
  production: shared,
};
