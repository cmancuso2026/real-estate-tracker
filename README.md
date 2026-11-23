# Mancuso HQ

One app for personal finances, the rental properties you own, and the ones you might buy. It started as two projects (this real-estate tracker and a separate personal-finance app), merged into one Next.js app on one Postgres database.

---

## What it does

- **Overview (`/`)** — this month and year-to-date for personal finance (income, spending, cash flow, top spending groups, latest data per bank) next to the real-estate picture (properties, units, occupancy, rent roll, rent collected vs outstanding, leases and insurance ending within 60 days), plus actual cash flow per property.
- **Finances (`/finance/…`)** — upload Bank of America, Amex Gold/Blue, SoFi and Capital One exports (CSV or XLSX; the bank is detected from the headers). Transactions are categorized automatically, deduplicated across overlapping statements, and shown on the Overview, Spending (categories × months) and Transactions pages, with one set of filters shared by every page.
- **Property attribution** — spending in categories that need a property (Repairs, Lawn Care, Home Depot by default; set per category in Admin) is tied to an owned property, and optionally a unit and a project. A **Needs Property** queue with suggestions and bulk tools clears the backlog; the property page shows repairs and spend, the Projects tab shows actual spend against the quote, and the Vendors page shows actual spend next to quotes.
- **Properties (`/properties`, `/rent`, `/vendors`)** — tenants, leases, rent collection (BofA CSV import + manual entry), projects with vendor quotes, vendors, escrow and insurance. Claude parses lease, quote, escrow and insurance PDFs and answers questions via a Slack bot.
- **Investing (`/tracker`, `/grade`)** — pulls for-sale listings and rental comps, grades each property A–F with a weighted investment model, and sends alerts.
- **Admin (`/admin`)** — categories and groups (add, rename, move, merge, archive, reorder; per-category property rules), property mapping, merchant rules, attribution, data and uploads (history, re-categorization, CSV export), investor profile, and a change log. Every destructive or bulk action shows how many rows will change and waits for you to confirm.

---

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript / Node.js 20+ (ESM); the finance core in `src/finance` is plain JS |
| Database | PostgreSQL — raw SQL (`pg`) for the tracker, Knex for finance |
| App | Next.js 15 (App Router) + Tailwind CSS, light mode |
| Charts | Chart.js 4 via react-chartjs-2 |
| Scheduling | node-cron (long-lived worker) |
| Notifications | Slack webhooks + SendGrid |
| AI | Anthropic Claude (PDF parsing, questions, monthly recaps) |
| Hosting | Railway: one web service + one worker, one managed Postgres |

### Code map

| Path | What |
|---|---|
| `src/dashboard` | The Next.js app: pages, API routes (`app/api/v2` tracker, `app/api/finance`, `app/api/admin`), components |
| `src/finance` | Finance core: bank parsers, categorization, dedup, Knex migrations, services behind the finance/admin API, tests |
| `src/db` | Tracker schema (`schema.sql`) and `db:migrate` |
| `src/scheduler`, `src/scripts`, `src/scoring`, `src/notifications` | Worker jobs, CLI scripts, grading, alerts |
| `scripts/migrate-finance-data.md` | One-time copy of data from the old finance database |
| `docs/finance-ui-parity.md` | Every feature of the old finance page and how it was verified |

---

## Setup and deploy

### Run it locally

Requires **Node.js 20+** and **PostgreSQL**.

```bash
npm install                     # root: tracker, finance core, tests
npm run dashboard:install       # the Next.js app
cp .env.example .env            # at least DATABASE_URL
npm run db:migrate              # tracker schema + finance migrations (idempotent)
npm run dashboard:dev           # http://localhost:3000
```

Open `/finance/upload` and upload a few statements to get started.

### Environment variables

See `.env.example` for every variable with comments. The ones that matter most:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | **Required.** The one Postgres database for everything |
| `DATABASE_SSL` | `true`/`false` to force TLS (needed for Railway's public URL) |
| `AUTH_USER`, `AUTH_PASSWORD` | Basic Auth for every page and API route. Leave unset only for local dev |
| `ANTHROPIC_API_KEY` | PDF parsing, questions, monthly recaps |
| `PG_POOL_MAX`, `FINANCE_POOL_MAX` | Connection pool sizes per process (app default 5, worker/scripts 10; finance 3) |
| `RENTCAST_API_KEY`, `RAPIDAPI_KEY`, `TARGET_ZIP_CODES`, … | Investing data sources |
| `SLACK_WEBHOOK_URL`, `SENDGRID_*` | Alerts and digests |

### Database migrations

`npm run db:migrate` runs on every boot of both services and is safe to repeat:

1. `src/db/schema.sql` — every tracker table (`CREATE … IF NOT EXISTS`).
2. The finance Knex migrations in `src/finance/db/migrations` (tracked in `knex_migrations`); they run second because some reference tracker tables.
3. Two catch-up steps that only add missing rows: new categories (for example after a data copy) join the Admin category list, and per-property categories like "1205 Rent" get a proposed property mapping for you to confirm.

The whole run holds a Postgres advisory lock, so the web service and the worker never migrate at the same time.

### Deploy to Railway

One repository, two services, one Postgres:

| Service | Start command | Does |
|---|---|---|
| **web** | `npm run db:migrate && npm --prefix src/dashboard run start` (Procfile `web`) | Migrates, then serves the app |
| **worker** | `npm run worker` (Procfile `worker`) | Migrates, then runs the cron scheduler |

1. Railway → New Project → Deploy from GitHub → this repository. The build command (`npm run build`, from `railway.json`) installs and builds the app.
2. Add a PostgreSQL database and set `DATABASE_URL=${{Postgres.DATABASE_URL}}` on both services.
3. Set `AUTH_USER` and `AUTH_PASSWORD` on the web service, and the other variables you use.
4. Add a second service from the same repository with the start command `npm run worker`.
5. Deploy. Both services migrate the database on boot.

Coming from the separate finance app? Copy its data with `scripts/migrate-finance-data.md` after the first deploy, then redeploy (or run `npm run db:migrate`) so copied custom categories join the category list.

### Cron schedule (worker, UTC)

| Job | Schedule | Description |
|---|---|---|
| fetch-listings | `0 10 * * *` | Pull Zillow + Rentcast |
| grade-properties | `30 10 * * *` | Score ungraded listings |
| daily-notifications | `0 11 * * *` | Slack alerts for A-grade listings |
| weekly-digest | `0 11 * * 5` | Friday email digest |
| v2-daily-alerts | `0 12 * * *` | Lease expiry, unrated work orders, insurance alerts |
| v2-monthly-recap | `0 13 1 * *` | Claude-generated monthly property recap |

### Checks

```bash
npm run typecheck                                   # tracker (root)
(cd src/dashboard && npx tsc --noEmit -p .)         # app
npm test                                            # finance + app tests (node --test via tsx, pg-mem)
npm run build                                       # production build
```

The tests need no database: integration tests run the real migrations against an in-memory Postgres (pg-mem) and call the real Next.js route handlers.

---

## How categorization works

For each uploaded transaction, the first of these that applies wins:

1. **A saved override** — you changed this exact transaction before (survives re-uploads).
2. **Your merchant rules** (Admin → Merchant rules), lowest priority number first. A rule with a property also assigns the property.
3. **History vote** — similar past transactions vote, weighted toward ones you categorized by hand; used only when confident.
4. **Built-in rules** in `src/finance/lib/categorize.js`, per bank.

Renamed or merged categories keep working: their old names point to the new category. "Admin → Merchant rules → Test a description" shows which step wins for any description.

---

## Scoring model (investing)

| Component | Weight | Data source |
|---|---|---|
| Cash-on-cash return | 30% | Price, rent comps, Freddie Mac PMMS + 0.75% premium |
| Crime rate | 25% | Miami-Dade Open Data, benchmarked to live median |
| Monthly cash flow | 20% | Rent − mortgage − tax − insurance |
| Price/sqft vs. zip median | 15% | Median of stored listings |
| Rental prevalence | 10% | Census ACS % renter-occupied by zip |

---

## Database

### Tracker (`src/db/schema.sql`)
| Table | Purpose |
|---|---|
| `listings`, `rentals`, `interest_rates`, `grades`, `crime_zip_cache`, `census_cache`, `alerts_sent` | Investing |
| `investor_profile` | Buy-box settings (Admin → Investor profile) |
| `owned_properties`, `units`, `tenants`, `leases`, `rent_collections` | Owned properties and rent |
| `vendors`, `work_orders` (projects), `project_quotes`, `project_units`, `recurring_costs` | Projects and vendors |
| `escrow_accounts`, `escrow_statements`, `piti_history`, `insurance_policies` | Escrow and insurance |

Tracker timestamps are TEXT in UTC `YYYY-MM-DD HH:MM:SS`.

### Finance (`src/finance/db/migrations`)
| Table | Purpose |
|---|---|
| `transactions` | One row per bank transaction (expenses negative), with `property_id` / `unit_id` / `work_order_id` attribution |
| `category_overrides`, `attribution_overrides` | Your category and property edits, keyed by dedup hash so they survive re-uploads |
| `upload_log` | One row per uploaded file |
| `category_groups`, `categories`, `category_aliases` | The category list (seeded from `lib/taxonomy.js`); aliases keep renamed/merged names working |
| `custom_categories` | Categories added in the old finance app (kept as a seed source) |
| `category_settings` | Per category: requires a property, allows project tags, default property |
| `property_category_map` | Per-property categories ("1205 Rent") → property and role (rent / PITI / expense) |
| `merchant_rules` | Your categorization rules |
| `admin_audit` | Change log of Admin actions |

---

## Later (not built yet)

- **One upload for rent and finances.** `/rent` imports Bank of America CSVs for rent collections, and the finance upload parses Bank of America CSVs too. Eventually one upload should feed both.
- **Splitting a transaction across properties.** A `transaction_allocations` table (transaction, property, share) so one Home Depot receipt can be divided between properties instead of assigned to one.
