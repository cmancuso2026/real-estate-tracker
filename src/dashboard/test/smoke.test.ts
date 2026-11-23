// Route smoke test: every page in the header nav and the Admin sidebar, the
// property and listing detail pages, and every GET endpoint under /api/finance
// and /api/admin must answer 200 with Basic Auth — against a production build
// (`next build` + `next start`) and a freshly migrated, seeded Postgres.
//
// Needs a throwaway Postgres database in SMOKE_DATABASE_URL. Its public schema
// is DROPPED and rebuilt, so the database name must contain "smoke" or "test"
// (anything else is refused). Without SMOKE_DATABASE_URL the test is skipped
// with a message; `npm run test:smoke` runs it on its own.
//
// The build is reused when .next/BUILD_ID is newer than every source file,
// otherwise `next build` runs first (a few minutes).
import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import net from 'net';
import pg from 'pg';
import { GROUPS } from '../components/NavLinks';
import { ADMIN_SECTIONS } from '../components/admin/AdminNav';

const DASH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.join(DASH, '..', '..');
const URL_ = process.env.SMOKE_DATABASE_URL;
const USER = 'smoke';
const PASS = 'smoke-pass';
const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

function newestMtime(dir: string): number {
  let t = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name === 'test') continue;
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newestMtime(p) : fs.statSync(p).mtimeMs);
  }
  return t;
}

function run(cmd: string, args: string[], cwd: string, env: Record<string, string>) {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 900_000 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer().listen(0, () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });

/** GET routes under app/<dir> → URL templates like /api/finance/rollups/property/[id]. */
function getRoutes(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string, segs: string[]) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(abs, e.name), [...segs, e.name]);
      else if (e.name === 'route.ts' && /export (async )?function GET\b/.test(fs.readFileSync(path.join(abs, e.name), 'utf8'))) {
        out.push('/' + segs.join('/'));
      }
    }
  };
  walk(path.join(DASH, 'app', ...dir.split('/')), dir.split('/'));
  return out.sort();
}

test('smoke: every nav/admin page and finance/admin GET endpoint returns 200', { skip: !URL_ && 'set SMOKE_DATABASE_URL to a throwaway Postgres database (name containing "smoke" or "test") to run the route smoke test', timeout: 1_200_000 }, async () => {
  const dbName = new URL(URL_!).pathname.slice(1);
  assert.match(dbName, /smoke|test/i, `refusing to wipe database "${dbName}": its name must contain "smoke" or "test"`);
  const env = { DATABASE_URL: URL_!, DATABASE_SSL: process.env.DATABASE_SSL ?? 'false' };

  // ── Fresh schema, migrations, seed data ────────────────────────────────
  const db = new pg.Client({ connectionString: URL_ });
  await db.connect();
  let server: ChildProcess | null = null;
  try {
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    run('npx', ['tsx', 'src/db/migrate.ts'], ROOT, env);
    run('npx', ['tsx', 'src/scripts/seed-properties.ts'], ROOT, env);
    run('npx', ['tsx', 'src/scripts/seed-demo.ts'], ROOT, env);
    const units = (await db.query('SELECT id, property_id, unit_label FROM units ORDER BY id')).rows;
    const unit = (label: string) => units.find((u) => u.unit_label === label)!;
    const tenant = (await db.query(`INSERT INTO tenants (unit_id, first_name, last_name) VALUES ($1, 'Ana', 'Ruiz') RETURNING id`, [unit('1205').id])).rows[0];
    await db.query(`INSERT INTO leases (tenant_id, unit_id, start_date, end_date, rent_amount) VALUES ($1, $2, '2026-01-01', '2026-12-31', 1850)`, [tenant.id, unit('1205').id]);
    const vendor = (await db.query(`INSERT INTO vendors (name, trade) VALUES ('Max Appliance', 'appliance') RETURNING id`)).rows[0];
    await db.query(`INSERT INTO work_orders (property_id, vendor_id, project_name, status) VALUES ($1, $2, 'Fridge 1205', 'open')`, [unit('1205').property_id, vendor.id]);
    const [{ id: rentTxn }] = (
      await db.query(
        `INSERT INTO transactions (date, description, amount, source, category, category_group, dedup_hash)
         VALUES ('2026-11-03', 'Zelle payment from SOMEONE NEW Conf# x1', 950, 'Bank of America', '1205 Rent', 'Investments', 'smoke-rent-1') RETURNING id`,
      )
    ).rows;
    // Properties were seeded after the migrations proposed mappings, so map the rent category here.
    await db.query(
      `INSERT INTO property_category_map (category, property_id, role, confirmed) VALUES ('1205 Rent', $1, 'income', true)
       ON CONFLICT (category) DO UPDATE SET property_id = EXCLUDED.property_id, role = 'income', confirmed = true`,
      [unit('1205').property_id],
    );

    // ── Production build + server ──────────────────────────────────────────
    const buildId = path.join(DASH, '.next', 'BUILD_ID');
    if (!fs.existsSync(buildId) || fs.statSync(buildId).mtimeMs < Math.max(newestMtime(DASH), newestMtime(path.join(ROOT, 'src', 'finance')))) {
      run('npx', ['next', 'build'], DASH, env);
    }
    const port = await freePort();
    server = spawn('npx', ['next', 'start', '-p', String(port)], {
      cwd: DASH,
      env: { ...process.env, ...env, AUTH_USER: USER, AUTH_PASSWORD: PASS },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // own process group, so cleanup stops next-server too (not just npx)
    });
    let log = '';
    server.stdout!.on('data', (d) => (log += d));
    server.stderr!.on('data', (d) => (log += d));
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 100; i += 1) {
      try {
        await fetch(base + '/api/health');
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    // Upload real bank files through the API so finance pages have data.
    const fd = new FormData();
    for (const f of ['bankofamerica.csv', 'amex_gold.csv']) {
      fd.append('files', new Blob([fs.readFileSync(path.join(ROOT, 'src', 'finance', 'test', 'fixtures', f))]), f);
    }
    const up = await fetch(base + '/api/finance/upload', { method: 'POST', body: fd, headers: { authorization: AUTH } });
    assert.equal(up.status, 200, `upload: ${await up.clone().text()}`);

    // ── Pages ──────────────────────────────────────────────────────────────
    const propertyId = unit('1205').property_id;
    const listingId = (await db.query('SELECT id FROM listings ORDER BY id LIMIT 1')).rows[0].id;
    const txnId = (await db.query(`SELECT id FROM transactions ORDER BY id LIMIT 1`)).rows[0].id;
    const pages = [
      '/',
      ...GROUPS.flatMap((g) => g.links.map((l) => l.href)),
      '/upload',
      '/admin',
      ...ADMIN_SECTIONS.map((s) => s.href),
      '/finance/categories',
      `/properties/${propertyId}`,
      `/property/${listingId}`,
    ];
    const failures: string[] = [];
    const check = async (p: string) => {
      const r = await fetch(base + p, { headers: { authorization: AUTH } }); // follows /admin → /admin/categories
      if (r.status !== 200) failures.push(`${p} → ${r.status} ${(await r.text()).slice(0, 200)}`);
    };
    for (const p of pages) await check(p);

    // ── GET endpoints ──────────────────────────────────────────────────────
    const params: Record<string, string> = {
      '/api/finance/rollups/property/[id]': `/api/finance/rollups/property/${propertyId}?year=2026`,
      '/api/finance/transactions/[id]/rent': `/api/finance/transactions/${rentTxn}/rent`,
      '/api/finance/transactions/[id]/suggestions': `/api/finance/transactions/${txnId}/suggestions`,
    };
    const apis = [...getRoutes('api/finance'), ...getRoutes('api/admin')];
    assert.ok(apis.length >= 20, `found ${apis.length} GET endpoints`);
    for (const r of apis) {
      if (r.includes('[')) {
        if (!params[r]) {
          failures.push(`${r}: new dynamic GET route — add an example id to the smoke test`);
          continue;
        }
        await check(params[r]);
      } else {
        await check(r);
      }
    }

    // Basic Auth is really on.
    assert.equal((await fetch(base + '/finance')).status, 401);

    assert.deepEqual(failures, [], `non-200 responses:\n${failures.join('\n')}\n\nserver log:\n${log.slice(-3000)}`);
    console.log(`  smoke: ${pages.length} pages and ${apis.length} GET endpoints answered 200`);
  } finally {
    if (server?.pid) {
      try {
        process.kill(-server.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
    await db.end();
  }
});
