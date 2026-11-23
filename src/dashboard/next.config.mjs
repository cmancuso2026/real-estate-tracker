/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep `pg` out of the bundler so it's required at runtime from node_modules
  // (it pulls in optional native deps the bundler shouldn't try to trace).
  // Knex is external for the same reason: it lazy-requires every SQL dialect
  // driver (mysql, sqlite3, oracledb, …), which the bundler would try to resolve.
  serverExternalPackages: ['pg', 'knex'],
  // The finance logic lives outside this app in src/finance (shared with the
  // tests and db:migrate); allow importing it via the @finance/* alias.
  experimental: { externalDir: true },
  // The investor profile moved into the Admin portal (Phase 7). Import Rent was
  // retired: rent is recorded from bank uploads (see src/finance/lib/rentSync.js).
  async redirects() {
    return [
      { source: '/settings', destination: '/admin/investor-profile', permanent: true },
      { source: '/rent', destination: '/properties', permanent: false },
      { source: '/finance/upload', destination: '/upload', permanent: true },
      // The category table lives at /finance/categories; Overview is the Finances main page.
      { source: '/finance/spending', destination: '/finance/categories', permanent: false },
      { source: '/finance/overview', destination: '/finance', permanent: false },
    ];
  },
  // This app has its own lockfile separate from the tracker root; pin the
  // tracing root here so Next doesn't warn about multiple lockfiles.
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
