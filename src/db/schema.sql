-- Real Estate Tracker — SQLite schema
-- Applied by src/db/init.ts. Safe to run repeatedly (IF NOT EXISTS).

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- listings: for-sale properties (Zillow via RapidAPI, Realtor.com, ...)
-- Deduplicated by (source, source_id): the provider's own property id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source          TEXT    NOT NULL,            -- 'zillow' | 'realtor'
  source_id       TEXT    NOT NULL,            -- provider's property id (zpid, etc.)
  address         TEXT,
  city            TEXT,
  state           TEXT,
  zip_code        TEXT,
  latitude        REAL,
  longitude       REAL,
  price           INTEGER,                     -- list price in whole dollars
  bedrooms        REAL,
  bathrooms       REAL,
  living_area     INTEGER,                     -- finished sqft
  lot_size        INTEGER,                     -- sqft
  year_built      INTEGER,
  property_type   TEXT,
  days_on_market  INTEGER,
  status          TEXT,                        -- 'for_sale', 'pending', ...
  listing_url     TEXT,
  raw_json        TEXT,                        -- original provider payload
  first_seen_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  last_seen_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_listings_zip   ON listings (zip_code);
CREATE INDEX IF NOT EXISTS idx_listings_price ON listings (price);

-- ---------------------------------------------------------------------------
-- rentals: rental comps (Rentcast). Deduplicated by (source, source_id).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rentals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source          TEXT    NOT NULL,            -- 'rentcast'
  source_id       TEXT    NOT NULL,            -- provider's record id
  address         TEXT,
  city            TEXT,
  state           TEXT,
  zip_code        TEXT,
  latitude        REAL,
  longitude       REAL,
  rent            INTEGER,                     -- monthly rent in whole dollars
  bedrooms        REAL,
  bathrooms       REAL,
  living_area     INTEGER,                     -- finished sqft
  property_type   TEXT,
  listed_date     TEXT,
  raw_json        TEXT,
  first_seen_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  last_seen_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_rentals_zip ON rentals (zip_code);

-- ---------------------------------------------------------------------------
-- interest_rates: weekly Freddie Mac PMMS 30-yr fixed rate snapshots.
-- effective_rate = base_rate + premium (investment-property premium).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interest_rates (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source          TEXT    NOT NULL DEFAULT 'freddie_mac_pmms',
  week_date       TEXT,                        -- PMMS survey date (YYYY-MM-DD)
  base_rate       REAL    NOT NULL,            -- 30-yr FRM, annual %
  premium         REAL    NOT NULL,            -- investment premium, annual %
  effective_rate  REAL    NOT NULL,            -- base_rate + premium
  fetched_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source, week_date)
);

-- ---------------------------------------------------------------------------
-- grades: A-F investment grading of listings (Phase 2 scoring engine).
-- One row per grading run; latest row per property_id is the current grade.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grades (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id        INTEGER NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  overall_grade      TEXT    NOT NULL,         -- 'A'..'F'
  overall_score      REAL    NOT NULL,         -- weighted 0-4 GPA-style score
  coc_grade          TEXT,                     -- cash-on-cash component
  cashflow_grade     TEXT,                     -- monthly cash-flow component
  sqft_grade         TEXT,                     -- price/sqft vs zip median
  crime_grade        TEXT,                     -- crime vs county median
  rental_grade       TEXT,                     -- renter-occupied prevalence
  coc_return         REAL,                     -- cash-on-cash return, %
  monthly_cashflow   REAL,                     -- $/month after mortgage+tax+ins
  price_per_sqft     REAL,                     -- $/sqft for this property
  crime_index        REAL,                     -- raw crime index used
  rental_prevalence  REAL,                     -- % renter-occupied (0-100)
  interest_rate_used REAL,                     -- effective rate used, %
  reasoning          TEXT,                     -- plain-English explanation
  assumptions_json   TEXT,                     -- full inputs/assumptions blob
  graded_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_grades_property ON grades (property_id);
CREATE INDEX IF NOT EXISTS idx_grades_graded_at ON grades (graded_at);

-- ---------------------------------------------------------------------------
-- crime_cache / census_cache: memoize slow external lookups so grading a batch
-- of listings doesn't re-hit the APIs per property. Crime is cached per city
-- (the FBI publishes by police agency, not by zip — zips are mapped to cities
-- in src/scoring/zip-cities.ts); census stays per zip.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crime_cache (
  city          TEXT PRIMARY KEY,
  ori           TEXT,                          -- FBI agency ORI for the city
  crime_index   REAL,                          -- city combined crime rate /100k
  fetched_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS census_cache (
  zip_code           TEXT PRIMARY KEY,
  renter_occupied_pct REAL,                    -- 0-100
  total_occupied     INTEGER,
  fetched_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- alerts_sent: dedupe outbound notifications (Phase 5).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alerts_sent (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id      INTEGER NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  channel         TEXT    NOT NULL,            -- 'slack' | 'email'
  alert_type      TEXT    NOT NULL,            -- e.g. 'new_a_grade'
  sent_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (listing_id, channel, alert_type)
);
