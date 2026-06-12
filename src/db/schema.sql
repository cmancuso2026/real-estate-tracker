-- Real Estate Tracker — PostgreSQL schema
-- Applied by src/db/init.ts / src/db/migrate.ts. Safe to run repeatedly
-- (IF NOT EXISTS everywhere). Timestamp columns are TEXT holding a UTC
-- "YYYY-MM-DD HH24:MI:SS" string (the same shape SQLite's datetime('now')
-- produced) so the app's date parsing, sorting, and formatting are unchanged.

-- ---------------------------------------------------------------------------
-- listings: for-sale properties (Zillow via RapidAPI, Realtor.com, ...)
-- Deduplicated by (source, source_id): the provider's own property id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listings (
  id              SERIAL PRIMARY KEY,
  source          TEXT    NOT NULL,            -- 'zillow' | 'realtor'
  source_id       TEXT    NOT NULL,            -- provider's property id (zpid, etc.)
  address         TEXT,
  city            TEXT,
  state           TEXT,
  zip_code        TEXT,
  latitude        DOUBLE PRECISION,
  longitude       DOUBLE PRECISION,
  price           INTEGER,                     -- list price in whole dollars
  bedrooms        DOUBLE PRECISION,
  bathrooms       DOUBLE PRECISION,
  living_area     INTEGER,                     -- finished sqft
  lot_size        INTEGER,                     -- sqft
  year_built      INTEGER,
  property_type   TEXT,
  days_on_market  INTEGER,
  status          TEXT,                        -- 'for_sale', 'pending', ...
  listing_url     TEXT,
  raw_json        TEXT,                        -- original provider payload
  first_seen_at   TEXT    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  last_seen_at    TEXT    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at      TEXT    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_listings_zip   ON listings (zip_code);
CREATE INDEX IF NOT EXISTS idx_listings_price ON listings (price);

-- ---------------------------------------------------------------------------
-- rentals: rental comps (Rentcast). Deduplicated by (source, source_id).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rentals (
  id              SERIAL PRIMARY KEY,
  source          TEXT    NOT NULL,            -- 'rentcast'
  source_id       TEXT    NOT NULL,            -- provider's record id
  address         TEXT,
  city            TEXT,
  state           TEXT,
  zip_code        TEXT,
  latitude        DOUBLE PRECISION,
  longitude       DOUBLE PRECISION,
  rent            INTEGER,                     -- monthly rent in whole dollars
  bedrooms        DOUBLE PRECISION,
  bathrooms       DOUBLE PRECISION,
  living_area     INTEGER,                     -- finished sqft
  property_type   TEXT,
  listed_date     TEXT,
  raw_json        TEXT,
  first_seen_at   TEXT    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  last_seen_at    TEXT    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_rentals_zip ON rentals (zip_code);

-- ---------------------------------------------------------------------------
-- interest_rates: weekly Freddie Mac PMMS 30-yr fixed rate snapshots.
-- effective_rate = base_rate + premium (investment-property premium).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interest_rates (
  id              SERIAL PRIMARY KEY,
  source          TEXT    NOT NULL DEFAULT 'freddie_mac_pmms',
  week_date       TEXT,                        -- PMMS survey date (YYYY-MM-DD)
  base_rate       DOUBLE PRECISION NOT NULL,   -- 30-yr FRM, annual %
  premium         DOUBLE PRECISION NOT NULL,   -- investment premium, annual %
  effective_rate  DOUBLE PRECISION NOT NULL,   -- base_rate + premium
  fetched_at      TEXT    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE (source, week_date)
);

-- ---------------------------------------------------------------------------
-- grades: A-F investment grading of listings (Phase 2 scoring engine).
-- One row per grading run; latest row per property_id is the current grade.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grades (
  id                 SERIAL PRIMARY KEY,
  property_id        INTEGER NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  overall_grade      TEXT    NOT NULL,         -- 'A'..'F'
  overall_score      DOUBLE PRECISION NOT NULL,-- weighted 0-4 GPA-style score
  coc_grade          TEXT,                     -- cash-on-cash component
  cashflow_grade     TEXT,                     -- monthly cash-flow component
  sqft_grade         TEXT,                     -- price/sqft vs zip median
  crime_grade        TEXT,                     -- crime vs county median
  rental_grade       TEXT,                     -- renter-occupied prevalence
  coc_return         DOUBLE PRECISION,         -- cash-on-cash return, %
  monthly_cashflow   DOUBLE PRECISION,         -- $/month after mortgage+tax+ins
  price_per_sqft     DOUBLE PRECISION,         -- $/sqft for this property
  crime_index        DOUBLE PRECISION,         -- raw crime index used
  rental_prevalence  DOUBLE PRECISION,         -- % renter-occupied (0-100)
  interest_rate_used DOUBLE PRECISION,         -- effective rate used, %
  reasoning          TEXT,                     -- plain-English explanation
  assumptions_json   TEXT,                     -- full inputs/assumptions blob
  graded_at          TEXT    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE INDEX IF NOT EXISTS idx_grades_property ON grades (property_id);
CREATE INDEX IF NOT EXISTS idx_grades_graded_at ON grades (graded_at);

-- ---------------------------------------------------------------------------
-- crime_cache: legacy table from the prior FBI-agency approach, kept only so
-- existing databases don't error; it's no longer written. Crime is now cached
-- per zip in crime_zip_cache (Miami-Dade Open Data); census stays per zip.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crime_cache (
  city          TEXT PRIMARY KEY,
  ori           TEXT,
  crime_index   DOUBLE PRECISION,
  fetched_at    TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

-- Per-zip crime index from Miami-Dade Open Data (opendata.miamidade.gov), the
-- Esri crime-index-by-neighborhood layer averaged within a radius of each zip's
-- centroid. baseline = Miami-Dade median index. Refreshed weekly.
CREATE TABLE IF NOT EXISTS crime_zip_cache (
  zip_code      TEXT PRIMARY KEY,
  crime_index   DOUBLE PRECISION,              -- avg neighborhood crime index near the zip
  baseline      DOUBLE PRECISION,              -- Miami-Dade median crime index
  neighborhoods INTEGER,                        -- count backing the index (0 = fell back to median)
  source        TEXT NOT NULL DEFAULT 'miami_dade_open_data',
  fetched_at    TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS census_cache (
  zip_code            TEXT PRIMARY KEY,
  renter_occupied_pct DOUBLE PRECISION,        -- 0-100
  total_occupied      INTEGER,
  fetched_at          TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

-- ---------------------------------------------------------------------------
-- alerts_sent: dedupe outbound notifications (Phase 5).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alerts_sent (
  id              SERIAL PRIMARY KEY,
  listing_id      INTEGER NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  channel         TEXT    NOT NULL,            -- 'slack' | 'email'
  alert_type      TEXT    NOT NULL,            -- e.g. 'new_a_grade'
  sent_at         TEXT    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE (listing_id, channel, alert_type)
);

-- ---------------------------------------------------------------------------
-- investor_profile: a single saved buy-box (one row, id = 1) that the dashboard
-- uses to filter listings/grades down to deals that fit the investor's budget
-- and targets. NULL columns mean "no constraint"; an empty property_types list
-- means "any type". Written by the dashboard's settings page.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS investor_profile (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  min_purchase_price  DOUBLE PRECISION,        -- floor on list price
  max_purchase_price  DOUBLE PRECISION,        -- cap on list price
  available_cash      DOUBLE PRECISION,        -- cash for down payment + closing
  property_types      TEXT,                    -- JSON: ["SFH","Duplex","Triplex","Quad"]
  min_beds            INTEGER,                 -- minimum bedrooms
  min_coc_return      DOUBLE PRECISION,        -- minimum cash-on-cash return (%)
  updated_at          TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
