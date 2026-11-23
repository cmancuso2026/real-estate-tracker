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
  // The investor profile moved into the Admin portal (Phase 7).
  async redirects() {
    return [{ source: '/settings', destination: '/admin/investor-profile', permanent: true }];
  },
  // This app has its own lockfile separate from the tracker root; pin the
  // tracing root here so Next doesn't warn about multiple lockfiles.
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
