// Serves the real Next.js route handlers under src/dashboard/app/api/finance
// over plain Node HTTP, so integration tests can `fetch` them exactly as a
// browser would (multipart uploads, JSON bodies, status codes) without a full
// `next build`. Mirrors App Router matching: one route.ts per folder, `[id]`
// folders are dynamic segments, static segments win over dynamic ones.
//
// Must run under tsx (the handlers are TypeScript and use the dashboard's
// `@/` and `@finance/` path aliases): `tsx --tsconfig src/dashboard/tsconfig.json --test …`
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(here, '..', '..', '..', 'dashboard', 'app');

function findRoutes(dir, segments = []) {
  const routes = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) routes.push(...findRoutes(path.join(dir, entry.name), [...segments, entry.name]));
    else if (entry.name === 'route.ts') routes.push({ segments, file: path.join(dir, entry.name) });
  }
  return routes;
}

function compile({ segments, file }) {
  const names = [];
  const pattern = segments
    .map((s) => {
      const m = /^\[(\w+)\]$/.exec(s);
      if (!m) return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      names.push(m[1]);
      return '([^/]+)';
    })
    .join('/');
  return { regex: new RegExp(`^/${pattern}/?$`), names, file, dynamic: names.length };
}

/**
 * Start an HTTP server for every route.ts under `app/<prefix>` (default
 * api/finance). Resolves to the listening http.Server (port 0 = random).
 */
export async function startRouteServer({ prefix = 'api/finance', port = 0 } = {}) {
  const root = path.join(APP_DIR, ...prefix.split('/'));
  const routes = findRoutes(root, prefix.split('/'))
    .map(compile)
    .sort((a, b) => a.dynamic - b.dynamic); // static before dynamic, like Next
  const modules = new Map();
  const load = (file) => {
    if (!modules.has(file)) modules.set(file, import(pathToFileURL(file).href));
    return modules.get(file);
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const route = routes.find((r) => r.regex.test(url.pathname));
      if (!route) {
        res.writeHead(404).end('no route');
        return;
      }
      const match = route.regex.exec(url.pathname);
      const params = Object.fromEntries(route.names.map((n, i) => [n, decodeURIComponent(match[i + 1])]));
      const mod = await load(route.file);
      const handler = mod[req.method];
      if (typeof handler !== 'function') {
        res.writeHead(405).end('method not allowed');
        return;
      }

      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = new Request(url, {
        method: req.method,
        headers: Object.entries(req.headers).flatMap(([k, v]) =>
          Array.isArray(v) ? v.map((x) => [k, x]) : v == null ? [] : [[k, v]],
        ),
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
      });

      const response = await handler(request, { params: Promise.resolve(params) });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' }).end(String(err && err.stack));
    }
  });

  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return server;
}
