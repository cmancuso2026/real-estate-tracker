# Mancuso Family Spending Tracker

Full-stack spending tracker: **Node/Express + PostgreSQL (Knex)** backend that ingests
CSV/XLSX bank exports, auto-categorizes transactions, deduplicates them, and serves an
interactive **Chart.js dashboard**. Deploys to **Railway**.

## What it does

- Upload CSV (or XLSX) exports from **Bank of America**, **Amex Gold**, **Amex Blue**, and **SoFi**.
- Each row is parsed to a common shape, **auto-categorized** by merchant rules (`lib/categorize.js`),
  and **deduplicated** by a stable hash so re-uploading overlapping statements never creates duplicates.
- Category edits in the UI are persisted to `category_overrides` and **survive re-uploads**.
- Dashboard shows KPIs, income-vs-spending charts, per-category breakdowns, and a filterable
  transaction table — all served from Postgres via a REST API.

> **Capital One** is a *category* (`Financials / Capital One`), not an upload source — matching the spec.
> There is no Capital One parser.

## Project layout

```
server.js               Express entry point (serves API + static dashboard)
knexfile.js             DB connection (DATABASE_URL in prod, PG* vars locally)
railway.toml            Railway build/deploy config (runs migrations then starts)
db/
  knex.js               Shared Knex instance (also pins DATE parsing to strings)
  migrations/           001 transactions · 002 category_overrides · 003 upload_log
routes/                 upload · transactions · summary · categories · years · months
parsers/                index (dispatch) · bankofamerica · amex · sofi · util
lib/                    categorize · dedup · taxonomy (single source of truth)
public/index.html       Dashboard (wired to the API; no hardcoded data)
test/                   unit + pg-mem integration tests, with sample fixtures
```

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/upload` | multipart `{ file, source }` → `{ new_rows, skipped, ... }` |
| GET | `/api/transactions` | filters: `year, months, group, category, source, search, limit, offset` |
| GET | `/api/summary` | totals + `by_group` / `by_category` / `by_month` / `by_source` |
| PUT | `/api/transactions/:id/category` | override a category (persists) |
| GET | `/api/categories` | full taxonomy (`GROUPS`) |
| GET | `/api/years` | years that have data |
| GET | `/api/months?year=YYYY` | months with data in a year |

`source` values: `bankofamerica`, `amex_gold`, `amex_blue`, `sofi`.

## Local development

Requires Node 20+ and a Postgres database.

```bash
npm install
cp .env.example .env          # set DATABASE_URL or the PG* vars
npm run migrate               # create tables
npm run dev                   # nodemon on http://localhost:3000
```

Then open http://localhost:3000, click **⬆ Upload CSV**, pick a source, and upload a bank export.

## Tests

```bash
npm test
```

- `test/categorize.test.js` — merchant rules vs. real April-2026 ground truth
- `test/dedup.test.js` — hash stability/normalization
- `test/parsers.test.js` — each parser against `test/fixtures/*.csv` (sign, skips, dates)
- `test/integration.test.js` — full upload→dedup→transactions→summary→override flow against an
  in-memory Postgres (`pg-mem`) running the **real migrations**

No local Postgres is needed to run the tests — `pg-mem` stands in for it.

## Deploy to Railway

1. Push this repo to GitHub.
2. On [railway.app](https://railway.app): **New Project → Deploy from GitHub** → select this repo.
3. **Add → Database → PostgreSQL.** Railway provisions it and injects `DATABASE_URL`.
4. In the service **Variables**, set `NODE_ENV=production`. (`PORT` and `DATABASE_URL` are injected.)
5. Deploy. `railway.toml`'s start command runs `npm run migrate` and then `node server.js`,
   so the schema is created automatically on first boot.
6. Your app is live at `https://<service>.up.railway.app`.

## Notes / decisions

- **Money** is stored as `NUMERIC(10,2)`; **expenses are negative, income positive** — enforced in every parser.
- **XLSX uploads** use SheetJS pinned to the patched CDN build `xlsx@0.20.3` (npm's 0.18.x has open advisories); `npm audit` is clean.
- The dashboard loads a year's transactions from `/api/transactions` and does month/group/category/source/search
  filtering **client-side**, exactly as the original UI did — so the cards, chart, and table can never disagree.
  `/api/summary` exists and is tested for other API consumers.
- Two categorization rules follow the real ground-truth data over the spec's prose: BoA `NEAT N TIDY`
  → `Uncategorized` (flagged for review), and Amex also matches `WHOLE FOODS` (space) in addition to `WHOLEFDS`.
- The bank sheets in `FY_26_Spending_Updated.xlsx` are your *consolidated* data in a different column layout
  than raw bank CSV exports; the parsers target the **raw export formats**. Upload fresh CSVs downloaded from
  each bank to populate the database.
