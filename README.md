# Mancuso HQ

One app for personal finances, the rental properties you own, and the ones you might buy. It started as two projects (this real-estate tracker and a separate personal-finance app), merged into one Next.js app on one Postgres database.

---

## What it does

- **Overview (`/`)** — this month and year-to-date for personal finance (income, spending and cash flow as defined below, top spending groups, latest data per bank) next to the real-estate picture (properties, units, occupancy, rent roll, rent collected vs outstanding, leases and insurance ending within 60 days), plus actual cash flow per property.
- **Finances (`/finance/…`)** — upload Bank of America, Amex Gold/Blue, SoFi and Capital One exports (CSV or XLSX; the bank is detected from the headers). Transactions are categorized automatically, deduplicated across overlapping statements, and shown on Overview (the main Finances page, `/finance`: totals and the Sankey / Bar chart), Categories (`/finance/categories`: categories × months, with each property's income and expenses under Investments) and Transactions, with one set of filters shared by every page. Needs Property lists expenses waiting for a property; select several to assign them to one property or split them all the same way (% for any mix, $ when the amounts match).
- **Property attribution** — spending in categories that need a property (Repairs, Lawn Care, Home Depot by default; set per category in Admin) is tied to an owned property, and optionally a unit and a project. A **Needs Property** queue with suggestions and bulk tools clears the backlog; the property page shows repairs and spend, the Projects tab shows actual spend against the quote, and the Vendors page shows actual spend next to quotes.
- **Properties (`/properties`, `/vendors`)** — tenants, leases, rent collection (from bank uploads + manual entry), projects with vendor quotes, vendors, escrow and insurance. Claude parses lease, quote, escrow and insurance PDFs and answers questions via a Slack bot.
- **Investing (`/tracker`, `/grade`)** — pulls for-sale listings and rental comps, grades each property A–F with a weighted investment model, and sends alerts.
- **Admin (`/admin`)** — categories and groups (add, rename, move, merge, archive, reorder; per-category property rules), property mapping, merchant rules, attribution, rent from uploads (catch-up), investor profile, and a change log. Every destructive or bulk action shows how many rows will change and waits for you to confirm.

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
SMOKE_DATABASE_URL=postgresql://localhost/hq_smoke_test npm test   # also runs the route smoke test
```

The tests need no database: integration tests run the real migrations against an in-memory Postgres (pg-mem) and call the real Next.js route handlers.

**Route smoke test** (`src/dashboard/test/smoke.test.ts`, also `npm run test:smoke`): builds the app if the build is stale, starts it with Basic Auth on, and requests every header nav and Admin sidebar page, the property and listing detail pages, and every GET endpoint under `/api/finance` and `/api/admin` (found by walking the app folder, so new endpoints are checked automatically); anything but 200 fails. It needs a throwaway Postgres in `SMOKE_DATABASE_URL`: the database is wiped, migrated and seeded (demo listings, the three properties, a tenant and lease, a project, two bank files uploaded through the API). It refuses any database whose name doesn't contain "smoke" or "test", so it can't touch production. Without `SMOKE_DATABASE_URL` it is skipped with a message.

---

## How categorization works

For each uploaded transaction, the first of these that applies wins:

1. **A saved override** — you changed this exact transaction before (survives re-uploads).
2. **Your merchant rules** (Admin → Merchant rules), lowest priority number first. A rule with a property also assigns the property.
3. **History vote** — similar past transactions vote, weighted toward ones you categorized by hand; used only when confident.
4. **Built-in rules** in `src/finance/lib/categorize.js`, per bank.

Renamed or merged categories keep working: their old names point to the new category. "Admin → Merchant rules → Test a description" shows which step wins for any description.

## Splitting a transaction across properties

A transaction's property attribution lives in `transaction_allocations`: one row per property (with an optional unit and project) and an amount with the transaction's sign. Picking one property saves a single 100% row. **Split** (in the property picker on Transactions and Needs Property) divides it by percentages or by dollar amounts:

- Percentages must total 100% and dollar amounts must total the transaction. Amounts are rounded to cents and the last row takes the remainder, so the rows always add up exactly. Save stays disabled until they balance, and the API (`PUT /api/finance/transactions/:id/allocations`) rejects anything else with a 400.
- A transaction counts as attributed only when it is fully allocated. A partly allocated row stays in Needs Property and shows how much is unallocated.
- A unit or project must belong to the row's property.
- Splits survive re-uploads: like category overrides, they are remembered by the bank row's hash.
- The old `transactions.property_id` / `unit_id` / `work_order_id` columns are still in the database but unused: an untouched copy of the attributions from before splits, kept as a safety net. `src/finance/db/later/014_drop_transaction_property_columns.js` removes them; move it into `src/finance/db/migrations` in a later release once splits have been checked.
- Roll-ups use each property's share: per-property cash flow on the Overview, a property's Repairs and spend tab, project actual spend, and vendor spend.

## How income, spending and cash flow are counted

One definition, in `src/finance/lib/metrics.js`, used by the landing page, the /finance cards and chart, and `GET /api/finance/summary` (the browser loads the same rules from `GET /api/finance/metrics`). Each card has an (i) with the same wording.

- **Transfers are left out.** Categories in the Financials group (Amex, Capital One, Venmo) are card payments and moves between your own accounts. Counting them would add a card payment once as spending (out of checking) and once as income (the credit on the card).
- **Income** is money in to an income category: the W2 Income group, any category mapped to a property as rent (Admin, Property mapping), and uncategorized deposits.
- **Spending** is everything else, net of refunds (a refund in Groceries reduces Groceries). Money out of an income category, such as taxes owed, is spending. Mortgage / PITI and property costs count as spending.
- **Cash flow** is income minus spending, which equals the sum of every amount except transfers.

The landing page shows one calendar month and the year to date; /finance opens on the current month and the two before it. For the same months they show the same numbers (`src/dashboard/test/metrics-parity.test.ts`). The group names are constants in `metrics.js` (`TRANSFER_GROUPS`, `INCOME_GROUPS`): if you rename the Financials or W2 Income group in Admin, update them there.

## Cash position

Bank of America **checking** exports (CSV) carry a running balance on every row. On upload, the closing balance of each day is saved in `account_balances` (one row per account and day; a later upload of the same day replaces it), read by `src/finance/parsers/balances.js` separately from the transaction parser. Finances → Overview charts the balance over the selected months (now, change over the period, low point); the home page shows the latest balance, its change over 30 days and this year, and a 12-month trend. Balances only exist for statements uploaded since this was added: re-upload older checking statements to fill in the history (their transactions are skipped as duplicates).

## How rent is recorded

A transaction is a rent payment when it is money in and its category is mapped to a property as rent (Admin → Property mapping, role "income"). Whenever an upload, a category change, a merchant rule or a re-categorization produces one, it is written to `rent_collections` (`source = 'finance_upload'`, linked by `transaction_id`). The unit is found with the rules the old Import Rent page used (`src/finance/lib/rentMatch.js`), in this order: the property's only unit; the tenant's name in the description ("Zelle payment from …"); a category naming the unit ("1207 Rent"); the amount equal to exactly one unit's lease rent. The rent month, late flag and late fee come from the lease in force on the payment date (last 5 days of a month count toward the next month).

- Payments without a clear unit wait under **Needs Property → Rent needs a unit**; picking one records it and later syncs keep your pick.
- Rows you entered by hand or with the old CSV import are never changed. A transaction they already cover (same unit, paid date and amount; or same unit, rent month and amount paid within 7 days) creates nothing.
- Recategorizing a payment away from rent removes its row; deleting the transaction unlinks it, and uploading the same bank row again links it back.
- Past transactions: **Admin → Rent from uploads** previews what would be recorded, what is already recorded and what needs a unit; **Apply** writes it (safe to repeat). From a terminal: `npm run rent:backfill` (preview) and `npm run rent:backfill -- --apply`.

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
| `transactions` | One row per bank transaction (expenses negative); property attribution is in `transaction_allocations` (the old `property_id` / `unit_id` / `work_order_id` columns are unused, kept for now) |
| `category_overrides`, `attribution_overrides` | Your category and property edits, keyed by dedup hash so they survive re-uploads |
| `upload_log` | One row per uploaded file |
| `category_groups`, `categories`, `category_aliases` | The category list (seeded from `lib/taxonomy.js`); aliases keep renamed/merged names working |
| `custom_categories` | Categories added in the old finance app (kept as a seed source) |
| `category_settings` | Per category: requires a property, allows project tags, default property |
| `account_balances` | Daily closing balance per bank account (Bank of America checking), for the cash position chart |
| `transaction_allocations` | A transaction's share per property (and unit / project); see Splitting above |
| `property_category_map` | Per-property categories ("1205 Rent") → property and role (rent / PITI / expense) |
| `merchant_rules` | Your categorization rules |
| `admin_audit` | Change log of Admin actions |

---

## Later (not built yet)

- **Split templates on merchant rules.** A merchant rule with a property gives matching transactions 100% to that property. A rule can't yet carry a split (for example Home Depot 50/50 between two properties); splits are made per transaction.
