# Real Estate Investment Tracker

A full-stack investment analysis tool that automates property sourcing, scoring, and alerting for Miami-Dade real estate. Built to solve a real problem: evaluating 50+ listings per week across multiple zip codes without a repeatable framework.

**What it does:** Pulls live for-sale listings and rental comps, scores each property A–F using a weighted investment model, and surfaces the best opportunities via Slack alerts and a web dashboard — without requiring manual spreadsheet work. Deploys to [Railway](#deployment-railway) as a web dashboard plus a background worker, backed by PostgreSQL.

---

## Why I Built This

I own three investment duplexes in Miami-Dade and was spending hours each week manually pulling comps, estimating cash flow, and tracking listings across zip codes. I built this tool to make that process systematic and repeatable.

The design decisions reflect real investing constraints:
- **Cash-on-cash return weighted at 30%** — the metric that most directly reflects actual returns on leveraged real estate
- **Crime weighted at 25%** — a leading indicator of rental demand and long-term property value in Miami-Dade
- **Graceful degradation in scoring** — if crime or census data is unavailable, the engine redistributes weight rather than failing or producing misleading grades
- **Deduplication on `(source, source_id)`** — listings update in place across runs so price/status changes are tracked over time, not duplicated
- **Crime benchmarked against a live median** — no hard-coded baseline; the model recalibrates automatically as more cities are tracked

---

## Architecture & Stack

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript / Node.js (ESM) | Type safety for financial calculations; native fetch in Node 20+ removes a dependency |
| Database | PostgreSQL (`pg`) | Managed and hosting-friendly (Railway plugin); handles concurrent access from the web dashboard and the worker; one URL, no file to ship |
| Dashboard | Next.js + Tailwind | Fast to build, easy to extend; reads Postgres directly via server components |
| Scheduling | node-cron | Lightweight; runs as a long-lived worker process |
| Notifications | Slack webhooks + SendGrid | Alert fatigue matters — Slack for grade-A urgency, email for weekly digest |
| Hosting | Railway | Two services (web + worker) from one repo, backed by a managed Postgres |

The project is intentionally phased so each layer is independently useful — data ingestion works without scoring, scoring works without the dashboard.

---

## Project Status

| Phase | Status | Description |
|---|---|---|
| 1 — Data ingestion | ✅ Complete | Zillow (via RapidAPI) + Rentcast; paginated fetching; deduplicated Postgres storage |
| 2 — Scoring engine | ✅ Complete | A–F grading across 5 weighted components; plain-English reasoning per grade |
| 3 — Realtor.com | 🔲 Planned | Second listing source to reduce Zillow API dependency |
| 4 — Gmail parser | 🔲 Planned | Parse MLS alert emails into structured listings |
| 5 — Dashboard + alerts | ✅ Complete | Next.js dashboard with investor buy-box filtering; Slack + weekly email digest |
| 6 — Deployment | ✅ Complete | PostgreSQL migration; Railway web + worker; `/api/health` check |

---

## Scoring Model

Each listing is graded A–F across five components:

| Component | Weight | Data Source |
|---|---|---|
| Cash-on-cash return | 30% | Computed: price, rent comps, Freddie Mac PMMS rate + 0.75% premium |
| Crime rate | 25% | FBI Crime Data Explorer; city-level, benchmarked to live median |
| Monthly cash flow | 20% | Rent − mortgage − tax − insurance |
| Price/sqft vs. zip median | 15% | Median of stored listings, same beds/baths |
| Rental prevalence | 10% | Census ACS % renter-occupied by zip |

**Grading:** Component scores (A=4 … F=0) are combined by weight and mapped to a final letter (A ≥ 3.5, B ≥ 2.5, C ≥ 1.5, D ≥ 0.5, F < 0.5).

**Sample output:** *"Overall grade C for an SFH: poor cash-on-cash return of 1.8%, with solid monthly cash flow of $340/mo and price/sqft 13.0% below the zip median."*

**Tradeoffs & limitations:**
- Rent estimates use whole-property comps — for multi-family, this assumes comps represent total rent, not per-unit
- FBI crime data lags 1–2 years; the model uses the most recent available year
- Zips policed by Miami-Dade County (e.g. Miami Lakes) have no municipal agency match and skip the crime component

---

## Dashboard

A Next.js + Tailwind app reading the same PostgreSQL database (`DATABASE_URL`) at `http://localhost:3000`. No auth — designed for trusted/local use.

**Key screens:**
- **Main table** — sortable/filterable by zip, type, beds, price range, and grade; color-coded grade badges
- **Property detail** — full scoring breakdown, step-by-step CoC calculation, grade history chart
- **Investor Profile** — save a buy-box (max price, available cash, property types, min CoC); dashboard filters all results against it

Dark mode and mobile-responsive layout included. A health check is exposed at `/api/health` for Railway.

---

## Setup

Requires **Node.js >= 20** and a **PostgreSQL** database (local or hosted).

```bash
npm install
cp .env.example .env   # set DATABASE_URL and your API keys
npm run db:migrate     # create the tables in Postgres (idempotent)
```

### Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | **yes** | PostgreSQL connection string |
| `DATABASE_SSL` | no | `true`/`false` to force TLS (auto-detected otherwise) |
| `RENTCAST_API_KEY` | yes | [Rentcast](https://www.rentcast.io/api) |
| `RAPIDAPI_KEY` | yes | RapidAPI key for Zillow provider |
| `TARGET_ZIP_CODES` | yes | Comma-separated zips, e.g. `33012,33016` |
| `FBI_API_KEY` | no | [api.data.gov](https://api.data.gov/signup/) — defaults to rate-limited `DEMO_KEY` |
| `CENSUS_API_KEY` | no | [census.gov](https://api.census.gov/data/key_signup.html) |
| `MANUAL_PMMS_RATE` | no | Override 30-yr base rate (skips network fetch) |

See `.env.example` for the complete list, including the Slack/SendGrid notification keys.

---

## Usage

**Standard weekly flow:**

```bash
npm run refresh:rate         # pull latest Freddie Mac 30-yr rate (run Thursdays)
npm run fetch:all            # fetch listings + rentals for TARGET_ZIP_CODES
npm run grade                # score all ungraded listings

npm run notify:slack         # Slack alert for any grade-A properties
npm run notify:email:weekly  # weekly digest email
```

**Other commands:**
```bash
npm run fetch:all 33012 33016    # override zip codes inline
npm run grade 33012              # grade a specific zip only
npm run crime:check              # inspect zip → city → FBI agency mappings
npm run seed:demo                # load sample data for the dashboard
npm run dashboard:dev            # start dashboard at http://localhost:3000
npm run typecheck                # type-check without emitting
```

---

## Deployment (Railway)

The app deploys to [Railway](https://railway.com) as **two services backed by one Postgres database**, both built from this same repo:

- **web** — the Next.js dashboard (`npm run start`), which runs the database migration on boot and then serves the UI. Health-checked at `/api/health`.
- **worker** — the cron scheduler (`npm run worker`), a long-lived process that fires the weekly A-grade digest (Fridays 8 AM ET).

`railway.json` (web defaults) and `Procfile` (`web` / `worker` process types) are committed at the repo root.

### 1. Create the project and add Postgres

1. Push this repo to GitHub.
2. In Railway: **New Project → Deploy from GitHub repo**, and pick this repo. Railway creates a first service from it — this is the **web** service.
3. In the project, click **New → Database → Add PostgreSQL**. This provisions a managed Postgres and exposes `DATABASE_URL` for reference.

### 2. Configure the web service

On the web service's **Variables** tab, reference the database URL (don't paste it — referencing wires Railway's internal, no-SSL connection):

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

Then add the application variables (all keys from `.env.example`):

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | **yes** | `${{Postgres.DATABASE_URL}}` (reference, set above) |
| `RENTCAST_API_KEY` | for rentals | Rentcast API key |
| `RAPIDAPI_KEY` | for listings | RapidAPI key for the Zillow provider |
| `RAPIDAPI_ZILLOW_HOST` | no | defaults to `us-property-market1.p.rapidapi.com` |
| `TARGET_ZIP_CODES` | yes | comma-separated, e.g. `33012,33126` |
| `RENTAL_REFRESH_DAYS` | no | default `7` |
| `INVESTMENT_RATE_PREMIUM` | no | default `0.75` |
| `FREDDIE_MAC_PMMS_CSV_URL` | no | defaults to freddiemac.com |
| `MANUAL_PMMS_RATE` | no | override the base 30-yr rate |
| `FBI_API_KEY` | no | defaults to rate-limited `DEMO_KEY` |
| `CENSUS_API_KEY` | no | ACS allows limited keyless use |
| `SLACK_WEBHOOK_URL` | for Slack alerts | incoming webhook URL |
| `SENDGRID_API_KEY` | for email | SendGrid API key |
| `SENDGRID_FROM_EMAIL` | for email | verified sender |
| `SENDGRID_TO_EMAIL` | for email | recipient(s), comma-separated |
| `REALTOR_API_KEY`, `ANTHROPIC_API_KEY`, `GMAIL_*` | no | placeholders for later phases |
| `DATABASE_SSL` | no | leave unset for the internal URL; `true` for an external/public one |

Railway sets `PORT` automatically; the dashboard binds to it. The web service runs `npm run build` then `npm run start`, and `start` applies the schema migration (`db:migrate`) before launching Next.js — so the database is ready on first boot.

### 3. Add the worker service

1. **New → GitHub Repo** and select this same repo again (a second service).
2. On that service: **Settings → Deploy → Custom Start Command** → `npm run worker`.
3. On its **Variables** tab, set the same variables as the web service (at minimum `DATABASE_URL=${{Postgres.DATABASE_URL}}` plus whichever API keys the scheduled jobs need — SendGrid for the digest). Railway services don't share variables by default.

(If you prefer Railway's Procfile process types over a custom start command, the committed `Procfile` defines both `web` and `worker`.)

### 4. Deploy

Push to your default branch (or click **Deploy**). The web service builds and serves the dashboard at the generated Railway URL; visit `/api/health` to confirm it reports `{"status":"ok","database":"connected"}`. The worker starts the scheduler and stays running.

To run an ad-hoc tracker command against the deployed database, use the Railway CLI: `railway run npm run fetch:all`, `railway run npm run grade`, or `railway run npm run seed:demo`.

---

## Database Schema

Records deduplicate on `(source, source_id)` — re-runs update existing rows and bump `last_seen_at` rather than creating duplicates.

| Table | Purpose |
|---|---|
| `listings` | For-sale properties (Zillow) |
| `rentals` | Rental comps (Rentcast) |
| `interest_rates` | Weekly Freddie Mac PMMS snapshots + investment premium |
| `grades` | A–F grades with reasoning, metrics, and full assumptions blob |
| `crime_zip_cache` | Per-zip Miami-Dade crime index (7-day TTL) |
| `crime_cache` | Legacy FBI-agency cache (kept, no longer written) |
| `census_cache` | Per-zip renter-occupancy (90-day TTL) |
| `alerts_sent` | Notification log for deduplication |
| `investor_profile` | Dashboard buy-box settings |

Timestamp columns are stored as TEXT in UTC `YYYY-MM-DD HH:MM:SS` form. See `src/db/schema.sql` for column-level detail.

```bash
psql "$DATABASE_URL"
=> SELECT zip_code, COUNT(*), MIN(price), MAX(price) FROM listings GROUP BY zip_code;
```
