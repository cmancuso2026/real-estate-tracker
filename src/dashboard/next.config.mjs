/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep `pg` out of the bundler so it's required at runtime from node_modules
  // (it pulls in optional native deps the bundler shouldn't try to trace).
  serverExternalPackages: ['pg'],
  // This app has its own lockfile separate from the tracker root; pin the
  // tracing root here so Next doesn't warn about multiple lockfiles.
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
