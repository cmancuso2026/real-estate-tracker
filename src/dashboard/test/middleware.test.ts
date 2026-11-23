// Basic Auth must cover every /finance and /admin page and every /api/finance
// and /api/admin route. Walks the app directory so new routes are covered
// automatically.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { NextRequest } from 'next/server';
import { config, middleware } from '../middleware';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');

/** URL paths for every page.tsx / route.ts under app/<dir> ([param] → 1). */
function routesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string, segs: string[]) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(abs, e.name), [...segs, e.name]);
      else if (e.name === 'page.tsx' || e.name === 'route.ts') {
        out.push('/' + segs.map((s) => (/^\[.+\]$/.test(s) ? '1' : s)).join('/'));
      }
    }
  };
  walk(path.join(APP, ...dir.split('/')), dir.split('/'));
  return [...new Set(out)];
}

const PROTECTED = ['finance', 'admin', 'api/finance', 'api/admin'].flatMap(routesUnder);
const matcher = new RegExp(`^${config.matcher[0]}$`);
const basic = (u: string, p: string) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
const run = (p: string, auth?: string) =>
  middleware(new NextRequest(`http://localhost${p}`, { headers: auth ? { authorization: auth } : {} }));

test('found the finance and admin routes to check', () => {
  assert.ok(PROTECTED.length >= 40, `${PROTECTED.length} routes`);
  for (const p of ['/finance', '/finance/attribution', '/admin/categories', '/api/finance/upload', '/api/admin/categories']) {
    assert.ok(PROTECTED.includes(p), p);
  }
});

test('every finance/admin page and API route requires Basic Auth', () => {
  const prev = { u: process.env.AUTH_USER, p: process.env.AUTH_PASSWORD };
  process.env.AUTH_USER = 'cole';
  process.env.AUTH_PASSWORD = 's3cret:with-colon';
  try {
    for (const p of [...PROTECTED, '/']) {
      assert.ok(matcher.test(p), `middleware matcher covers ${p}`);
      assert.equal(run(p).status, 401, `${p} without credentials`);
      assert.equal(run(p, basic('cole', 'wrong')).status, 401, `${p} with a wrong password`);
      const ok = run(p, basic('cole', 's3cret:with-colon'));
      assert.equal(ok.headers.get('x-middleware-next'), '1', `${p} with the right credentials`);
    }
    assert.match(run('/finance').headers.get('www-authenticate') ?? '', /Basic realm="Mancuso HQ"/);
  } finally {
    process.env.AUTH_USER = prev.u;
    process.env.AUTH_PASSWORD = prev.p;
  }
});
