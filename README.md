# Real Estate Investment Tracker

Fetches for-sale listings and rental comps for target zip codes, stores them in
SQLite (deduplicated), and — in later phases — grades each property A–F with
Claude and sends Slack / email alerts.

This repository currently implements **Phases 1 & 2**.

## Phase 1 — data ingestion

- TypeScript / Node.js project (ESM, `tsx` for running, `tsc` for type-checking).
- SQLite schema (see [Database schema](#database-schema)).
- **Rentcast** integration — rental comps by zip code.
- **Zillow** integration (via RapidAPI) — for-sale listings by zip code, paginated.
- Deduplicated storage keyed on `(source, source_id)` (e.g. Zillow `zpid`),
  refreshing mutable fields and tracking `first_seen_at` / `last_seen_at`.

## Phase 2 — scoring engine (`src/scoring`)

Grades each for-sale listing **A–F** as an investment, combining six weighted
components:

| Component                 | Weight | Source                                            |
| ------------------------- | ------ | ------------------------------------------------- |
| Cash-on-cash return       | 35%    | computed from price, rent comps, interest rate    |
| Monthly cash flow         | 25%    | computed (rent − mortgage − tax − insurance)      |
| Price/sqft vs zip median  | 20%    | median of stored listings (same beds/baths)       |
| Crime rate                | 10%    | SpotCrime index vs Miami-Dade median              |
| Rental prevalence         | 10%    | Census ACS % renter-occupied                      |

- **Interest rate**: pulls the Freddie Mac PMMS 30-yr fixed rate from the
  published [PMMS history CSV](https://www.freddiemac.com/pmms), adds a 0.75%
  investment-property premium, and stores the effective rate in `interest_rates`
  for use in all cash-flow math. Refresh it weekly (Thursdays) via
  `npm run refresh:rate`.
- **Final grade**: each component letter → points (A=4 … F=0), combined by the
  weights above, then mapped to a letter (A ≥ 3.5, B ≥ 2.5, C ≥ 1.5, D ≥ 0.5,
  F < 0.5). The exact thresholds for every component are in the spec and encoded
  in `src/scoring/`.
- **Graceful degradation**: cash-on-cash and cash flow require a rent estimate —
  listings without comparable rents are skipped. Price/sqft, crime, and rental
  prevalence are optional; if their data is unavailable (e.g. no SpotCrime key),
  that component is dropped and its weight is **redistributed** across the rest.
- **Reasoning**: every grade is saved with a plain-English explanation, e.g.
  *"Overall grade C for an SFH: poor cash-on-cash return of 1.8%, with solid
  monthly cash flow of $340/mo and price/sqft 13.0% below the zip median."*

> **Data-source notes.** The Miami-Dade county crime median is configured via
> `MIAMI_DADE_CRIME_MEDIAN` (computing the true county median live is
> impractical); the SpotCrime index is a recent-incident count near the
> property's coordinates. Rent estimates use whole-property comps matched by
> bedroom count — for multi-family this assumes comps represent total property
> rent, not per-unit.

Later phases (scaffolded in the directory layout, not yet implemented): Realtor.com
integration, Gmail email parsing, Slack/email notifications, a daily scheduler,
and a Next.js dashboard.

## Project layout

```
src/
  api/          API integrations (rentcast.ts, zillow.ts, shared http.ts)
  db/           SQLite setup, schema, and repositories
  scripts/      Runnable entry points (fetch-rentals, fetch-listings, fetch-all)
  scoring/      A-F grading engine        (Phase 2)
  email/        Gmail parser              (Phase 4)
  notifications/Slack + email digest      (Phase 5)
  scheduler/    Daily cron jobs           (Phase 6)
  dashboard/    Next.js web app           (Phase 7)
```

## Setup

Requires **Node.js >= 20** (uses the built-in `fetch`).

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# then edit .env and fill in your keys (see below)

# 3. Initialize the database
npm run db:init
```

### Environment variables

All secrets live in `.env` (never committed). See `.env.example` for the full list.

| Variable                | Required for Phase 1 | Purpose                                            |
| ----------------------- | -------------------- | -------------------------------------------------- |
| `DATABASE_PATH`         | no (defaults)        | SQLite file path (default `./data/tracker.db`)     |
| `RENTCAST_API_KEY`      | yes (rentals)        | [Rentcast](https://www.rentcast.io/api) API key    |
| `RAPIDAPI_KEY`          | yes (listings)       | RapidAPI key for a Zillow data provider            |
| `RAPIDAPI_ZILLOW_HOST`  | no (defaults)        | RapidAPI host, e.g. `zillow-com1.p.rapidapi.com`   |
| `TARGET_ZIP_CODES`      | yes                  | Comma-separated zips to track, e.g. `78704,78745`  |

Phase 2 (scoring) variables — all optional, with sensible defaults / fallbacks:

| Variable                   | Purpose                                                       |
| -------------------------- | ------------------------------------------------------------ |
| `INVESTMENT_RATE_PREMIUM`  | Premium added to the PMMS base rate (default `0.75`)         |
| `FREDDIE_MAC_PMMS_CSV_URL` | PMMS history CSV source (default points at freddiemac.com)   |
| `MANUAL_PMMS_RATE`         | Override the base 30-yr rate (skips the network fetch)       |
| `SPOTCRIME_API_KEY`        | Enables the crime component (skipped if unset)               |
| `MIAMI_DADE_CRIME_MEDIAN`  | County crime baseline (required for the crime component)     |
| `CENSUS_API_KEY`           | Census ACS key (ACS allows limited keyless use)              |

To get keys:

- **Rentcast** — sign up at <https://www.rentcast.io/api> and copy your API key.
- **Zillow** — subscribe to a Zillow data API on [RapidAPI](https://rapidapi.com/)
  (e.g. "Zillow.com" by ApiMaker → host `zillow-com1.p.rapidapi.com`), then copy
  the RapidAPI key shown on the endpoint page.
- **SpotCrime** — request an API key from <https://www.spotcrime.com/api>.
- **Census** — request a free key at <https://api.census.gov/data/key_signup.html>.

## Usage

```bash
# Fetch everything (listings + rentals) for TARGET_ZIP_CODES
npm run fetch:all

# Or override the zips on the command line
npm run fetch:all 78704 78745

# Fetch just one source
npm run fetch:listings
npm run fetch:rentals

# Refresh the Freddie Mac interest rate (run weekly, on Thursdays)
npm run refresh:rate

# Grade stored listings A-F (all, or filtered to zips)
npm run grade
npm run grade 78704

# Type-check without emitting
npm run typecheck
```

A typical flow: `npm run refresh:rate` → `npm run fetch:all` → `npm run grade`.

Each run is idempotent: records are deduplicated on `(source, source_id)`, so
re-running updates existing rows (price, status, days-on-market, …) and bumps
`last_seen_at` instead of creating duplicates.

## Inspecting the data

```bash
sqlite3 data/tracker.db
sqlite> SELECT zip_code, COUNT(*), MIN(price), MAX(price) FROM listings GROUP BY zip_code;
sqlite> SELECT zip_code, COUNT(*), AVG(rent) FROM rentals GROUP BY zip_code;
```

## Database schema

| Table            | Purpose                                                   |
| ---------------- | --------------------------------------------------------- |
| `listings`       | For-sale properties (Zillow, later Realtor.com)          |
| `rentals`        | Rental comps (Rentcast)                                  |
| `interest_rates` | Weekly Freddie Mac PMMS snapshots + investment premium   |
| `grades`         | A–F investment grades per listing, with reasoning        |
| `crime_cache`    | Per-zip crime index cache (30-day TTL)                   |
| `census_cache`   | Per-zip renter-occupancy cache (90-day TTL)              |
| `alerts_sent`    | Sent-notification log for de-duping alerts *(Phase 5)*   |

The `grades` table stores, per run: `property_id`, `overall_grade`,
`overall_score`, each component grade (`coc_grade`, `cashflow_grade`,
`sqft_grade`, `crime_grade`, `rental_grade`), the underlying metrics
(`coc_return`, `monthly_cashflow`, `price_per_sqft`, `crime_index`,
`rental_prevalence`), `interest_rate_used`, the `reasoning` string, and a full
`assumptions_json` blob. See `src/db/schema.sql` for column-level detail.
