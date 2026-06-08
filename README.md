Real Estate Investment Tracker
A full-stack investment analysis tool that automates property sourcing, scoring, and alerting for Miami-Dade real estate. Built to solve a real problem: evaluating 50+ listings per week across multiple zip codes without a repeatable framework.
What it does: Pulls live for-sale listings and rental comps, scores each property A–F using a weighted investment model, and surfaces the best opportunities via Slack alerts and a web dashboard — without requiring manual spreadsheet work.

Why I Built This
I own three investment duplexes in Miami-Dade and was spending hours each week manually pulling comps, estimating cash flow, and tracking listings across zip codes. I built this tool to make that process systematic and repeatable.
The design decisions reflect real investing constraints:

Cash-on-cash return weighted at 30% — the metric that most directly reflects actual returns on leveraged real estate
Crime weighted at 25% — a leading indicator of rental demand and long-term property value in Miami-Dade
Graceful degradation in scoring — if crime or census data is unavailable, the engine redistributes weight rather than failing or producing misleading grades
Deduplication on (source, source_id) — listings update in place across runs so price/status changes are tracked over time, not duplicated
Crime benchmarked against a live median — no hard-coded baseline; the model recalibrates automatically as more cities are tracked


Architecture & Stack
LayerChoiceRationaleLanguageTypeScript / Node.js (ESM)Type safety for financial calculations; native fetch in Node 20+ removes a dependencyDatabaseSQLiteZero-infrastructure for a solo tool; easy to inspect directly; sufficient for ~10k rowsDashboardNext.js + TailwindFast to build, easy to extend; reads SQLite directly (no API layer needed for local use)Schedulingnode-cronLightweight; runs as a long-lived process under pm2 or systemdNotificationsSlack webhooks + SendGridAlert fatigue matters — Slack for grade-A urgency, email for weekly digest
The project is intentionally phased so each layer is independently useful — data ingestion works without scoring, scoring works without the dashboard.

Project Status
PhaseStatusDescription1 — Data ingestion✅ CompleteZillow (via RapidAPI) + Rentcast; paginated fetching; deduplicated SQLite storage2 — Scoring engine✅ CompleteA–F grading across 5 weighted components; plain-English reasoning per grade3 — Realtor.com🔲 PlannedSecond listing source to reduce Zillow API dependency4 — Gmail parser🔲 PlannedParse MLS alert emails into structured listings5 — Dashboard + alerts✅ CompleteNext.js dashboard with investor buy-box filtering; Slack + weekly email digest

Scoring Model
Each listing is graded A–F across five components:
ComponentWeightData SourceCash-on-cash return30%Computed: price, rent comps, Freddie Mac PMMS rate + 0.75% premiumCrime rate25%FBI Crime Data Explorer; city-level, benchmarked to live medianMonthly cash flow20%Rent − mortgage − tax − insurancePrice/sqft vs. zip median15%Median of stored listings, same beds/bathsRental prevalence10%Census ACS % renter-occupied by zip
Grading: Component scores (A=4 … F=0) are combined by weight and mapped to a final letter (A ≥ 3.5, B ≥ 2.5, C ≥ 1.5, D ≥ 0.5, F < 0.5).
Sample output: "Overall grade C for an SFH: poor cash-on-cash return of 1.8%, with solid monthly cash flow of $340/mo and price/sqft 13.0% below the zip median."
Tradeoffs & limitations:

Rent estimates use whole-property comps — for multi-family, this assumes comps represent total rent, not per-unit
FBI crime data lags 1–2 years; the model uses the most recent available year
Zips policed by Miami-Dade County (e.g. Miami Lakes) have no municipal agency match and skip the crime component


Dashboard
A Next.js + Tailwind app reading SQLite directly at http://localhost:3000. No auth — designed for local use.
Key screens:

Main table — sortable/filterable by zip, type, beds, price range, and grade; color-coded grade badges
Property detail — full scoring breakdown, step-by-step CoC calculation, grade history chart
Investor Profile — save a buy-box (max price, available cash, property types, min CoC); dashboard filters all results against it

Dark mode and mobile-responsive layout included.

Setup
Requires Node.js >= 20.
bashnpm install
cp .env.example .env   # fill in your keys
npm run db:init
Environment Variables
VariableRequiredPurposeRENTCAST_API_KEYyesRentcastRAPIDAPI_KEYyesRapidAPI key for Zillow providerTARGET_ZIP_CODESyesComma-separated zips, e.g. 33012,33016DATABASE_PATHnoSQLite path (default: ./data/tracker.db)FBI_API_KEYnoapi.data.gov — defaults to rate-limited DEMO_KEYCENSUS_API_KEYnocensus.govMANUAL_PMMS_RATEnoOverride 30-yr base rate (skips network fetch)

Usage
Standard weekly flow:
bashnpm run refresh:rate         # pull latest Freddie Mac 30-yr rate (run Thursdays)
npm run fetch:all            # fetch listings + rentals for TARGET_ZIP_CODES
npm run grade                # score all ungraded listings

npm run notify:slack         # Slack alert for any grade-A properties
npm run notify:email:weekly  # weekly digest email
Other commands:
bashnpm run fetch:all 33012 33016    # override zip codes inline
npm run grade 33012              # grade a specific zip only
npm run crime:check              # inspect zip → city → FBI agency mappings
npm run seed:demo                # load sample data for the dashboard
npm run dashboard:dev            # start dashboard at http://localhost:3000
npm run typecheck                # type-check without emitting

Database Schema
Records deduplicate on (source, source_id) — re-runs update existing rows and bump last_seen_at rather than creating duplicates.
TablePurposelistingsFor-sale properties (Zillow)rentalsRental comps (Rentcast)interest_ratesWeekly Freddie Mac PMMS snapshots + investment premiumgradesA–F grades with reasoning, metrics, and full assumptions blobcrime_cachePer-zip crime index (30-day TTL)census_cachePer-zip renter-occupancy (90-day TTL)alerts_sentNotification log for deduplicationinvestor_profileDashboard buy-box settings
bashsqlite3 data/tracker.db
sqlite> SELECT zip_code, COUNT(*), MIN(price), MAX(price) FROM listings GROUP BY zip_c
