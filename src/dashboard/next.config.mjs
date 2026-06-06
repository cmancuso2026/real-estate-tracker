/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 is a native (.node) addon — keep it out of the bundler so
  // it's required at runtime from node_modules rather than webpacked.
  serverExternalPackages: ['better-sqlite3'],
  // This app has its own lockfile separate from the tracker root; pin the
  // tracing root here so Next doesn't warn about multiple lockfiles.
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
