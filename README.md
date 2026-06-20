# Real Estate Tracker

A full-stack tool for sourcing investment properties **and** managing the ones you already own. Built for a portfolio of three duplexes in Miami-Dade.

---

## What It Does

**Acquisition side (v1)** — Pulls live for-sale listings and rental comps, scores each property A–F using a weighted investment model, and surfaces the best opportunities via Slack alerts and a web dashboard.

**Property management side (v2)** — Tracks tenants, leases, rent collection, work orders, vendors, escrow, and insurance across your owned properties. Uses Claude to parse PDFs (leases, contractor invoices, escrow statements, insurance policies) and answer natural language questions via a Slack bot.

---

## Architecture & Stack

| Layer | Choice |
|---|---|
| Language | TypeScript / Node.js (ESM) |
| Database | PostgreSQL (raw SQL, no ORM) |
| Dashboard | Next.js 15 + Tailwind CSS |
| Scheduling | node-cron (long-lived worker) |
| Notifications | Slack webhooks + SendGrid |
| AI | Anthropic Claude (PDF parsing, NLQ, monthly recaps) |
| Hosting | Railway (web + worker services, managed Postgres) |

---

## Project Status

| Phase | Status | Description |
|---|---|---|
| 1 — Data ingestion | ✅ Complete | Zillow + Rentcast; deduplicated Postgres storage |
| 2 — Scoring engine | ✅ Complete | A–F grading across 5 weighted components |
| 5 — Dashboard + alerts | ✅ Complete | Next.js dashboard; Slack + weekly email digest |
| 6 — Deployment | ✅ Complete | Railway web + worker; `/api/health` check |
| v2 — Property management | ✅ Complete | Tenants, leases, rent, work orders, vendors, escrow, insurance |

---

## V2 Feature Summary

### Data tracked
- **Owned properties + units** — three duplexes, each unit independently tracked
- **Tenants** — contact info, active status, payment method (Zelle)
- **Leases** — full renewal history; PDF upload → Claude extracts dates, rent, utilities, equipment, deposits
- **Rent collection** — monthly expected vs actual; BofA CSV import + manual entry; partial payments and late fees
- **Work orders** — status flow: `received` (got quote, declined) → `open` (approved) → `complete`; one vendor per WO; PDF/email/manual entry
- **Vendors** — trade, contact info, Google Places rating + review count, manual rating
- **Escrow** — one account per property per lender; annual escrow analysis PDF → Claude extracts projected vs actual, disbursements, shortage/surplus, new monthly payment
- **Insurance policies** — PDF upload → Claude extracts carrier, dates, premium, deductible, coverage; queryable via Slack bot

### Agent layer
- **Monthly recap** — Claude-generated summary of rent collection, work orders, leases, escrow, insurance; sent via Slack + email on the 1st of each month
- **Proactive alerts** — daily check for leases expiring within 60 days, unrated completed work orders, insurance expiring within 60 days
- **Slack bot NLQ** — answer natural language questions: "who fixed my AC last time?", "what's my deductible on Maple St?", "which vendor have I spent the most with?"

### API routes (all under `/api/v2/`)
| Route | Methods | Purpose |
|---|---|---|
| `/properties` | GET, POST | Owned properties |
| `/units` | GET, POST | Units within a property |
| `/leases` | GET, POST | Lease history |
| `/rent` | GET, POST, PUT | Rent collections + BofA CSV import |
| `/vendors` | GET, POST | Vendors + Google Places lookup |
| `/work-orders` | GET, POST | Work orders |
| `/escrow` | GET, POST | Escrow accounts + latest statement |
| `/insurance` | GET, POST | Insurance policies |
| `/upload` | POST | PDF parsing (lease/work_order/escrow/insurance) |
| `/query` | POST | Natural language query against all data |

---

## Scoring Model (Acquisition)

Each listing is graded A–F across five components:

| Component | Weight | Data Source |
|---|---|---|
| Cash-on-cash return | 30% | Computed: price, rent comps, Freddie Mac PMMS + 0.75% premium |
| Crime rate | 25% | Miami-Dade Open Data, benchmarked to live median |
| Monthly cash flow | 20% | Rent − mortgage − tax − insurance |
| Price/sqft vs. zip median | 15% | Median of stored listings |
| Rental prevalence | 10% | Census ACS % renter-occupied by zip |

---

## Setup

Requires **Node.js >= 20** and a **PostgreSQL** database.

```bash
npm install
cp .env.example .env   # set DATABASE_URL and API keys
npm run db:migrate     # create all tables (idempotent)
npm run dashboard:dev  # start dashboard at http://localhost:3000
```

---

## Environment Variables

### Required
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | Claude PDF parsing, NLQ, monthly recaps |

### Authentication
| Variable | Purpose |
|---|---|
| `AUTH_USER` | Dashboard username (Basic Auth) |
| `AUTH_PASSWORD` | Dashboard password (Basic Auth) |

### Acquisition features
| Variable | Purpose |
|---|---|
| `RENTCAST_API_KEY` | Rental comps |
| `RAPIDAPI_KEY` | Zillow listings via RapidAPI |
| `TARGET_ZIP_CODES` | Comma-separated zip codes to track |
| `FBI_API_KEY` | Crime data (defaults to rate-limited DEMO_KEY) |
| `CENSUS_API_KEY` | Renter-occupancy data |
| `MANUAL_PMMS_RATE` | Override Freddie Mac 30-yr rate |

### Notifications
| Variable | Purpose |
|---|---|
| `SLACK_WEBHOOK_URL` | Incoming webhook for alerts + recaps |
| `SENDGRID_API_KEY` | Email delivery |
| `SENDGRID_FROM_EMAIL` | Verified sender address |
| `SENDGRID_TO_EMAIL` | Recipient(s), comma-separated |
| `NOTIFY_EMAIL` | V2 monthly recap recipient |
| `NOTIFY_FROM_EMAIL` | V2 recap sender address |

### Optional
| Variable | Purpose |
|---|---|
| `GOOGLE_PLACES_API_KEY` | Vendor Google rating lookup |
| `DATABASE_SSL` | `true`/`false` to force TLS |

---

## Deployment (Railway)

Two services from one repo, backed by one managed Postgres:

- **web** — Next.js dashboard (`npm run start`). Runs `db:migrate` on boot, then serves the UI. Health check at `/api/health`.
- **worker** — Cron scheduler (`npm run worker`). Long-lived process; fires daily alerts and monthly recaps.

### Cron schedule (UTC)
| Job | Schedule | Description |
|---|---|---|
| fetch-listings | `0 10 * * *` | Pull Zillow + Rentcast |
| grade-properties | `30 10 * * *` | Score ungraded listings |
| daily-notifications | `0 11 * * *` | Slack alerts for A-grade listings |
| weekly-digest | `0 11 * * 5` | Friday email digest |
| v2-daily-alerts | `0 12 * * *` | Lease expiry, unrated WOs, insurance alerts |
| v2-monthly-recap | `0 13 1 * *` | Claude-generated monthly property recap |

### Deploy steps
1. Push repo to GitHub
2. Railway → New Project → Deploy from GitHub
3. Add PostgreSQL plugin; set `DATABASE_URL=${{Postgres.DATABASE_URL}}`
4. Add all required env vars (see table above)
5. Add second service from same repo; set start command to `npm run worker`
6. Push to main → Railway auto-deploys both services

---

## Database Schema

### V1 — Acquisition
| Table | Purpose |
|---|---|
| `listings` | For-sale properties (Zillow) |
| `rentals` | Rental comps (Rentcast) |
| `interest_rates` | Freddie Mac PMMS weekly snapshots |
| `grades` | A–F grades with reasoning and metrics |
| `crime_zip_cache` | Per-zip Miami-Dade crime index |
| `census_cache` | Per-zip renter-occupancy |
| `alerts_sent` | Notification deduplication log |
| `investor_profile` | Dashboard buy-box settings |

### V2 — Property Management
| Table | Purpose |
|---|---|
| `owned_properties` | Your duplexes |
| `units` | Individual rentable units |
| `tenants` | Tenant contact info and status |
| `leases` | Full lease history per unit |
| `rent_collections` | Monthly expected vs actual payments |
| `vendors` | Contractors with Google + manual ratings |
| `work_orders` | Maintenance jobs (received/open/complete) |
| `escrow_accounts` | One per property per lender |
| `escrow_statements` | Annual escrow analysis PDFs, parsed |
| `insurance_policies` | Policies per property, parsed from PDF |

All timestamps stored as TEXT in UTC `YYYY-MM-DD HH:MM:SS` format.
