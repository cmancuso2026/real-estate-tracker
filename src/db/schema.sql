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
  property_types      TEXT,                    -- JSON: ["SFH","Triplex","Quad","Multi"]
  min_beds            INTEGER,                 -- minimum bedrooms
  min_coc_return      DOUBLE PRECISION,        -- minimum cash-on-cash return (%)
  updated_at          TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

-- ===========================================================================
-- V2: PROPERTY MANAGEMENT TABLES
-- All timestamps follow the existing TEXT / 'YYYY-MM-DD HH24:MI:SS' UTC convention.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- owned_properties: the duplexes / rentals you own (distinct from `listings`
-- which are for-sale comps scraped from Zillow/Realtor).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS owned_properties (
  id            SERIAL PRIMARY KEY,
  address       TEXT    NOT NULL,
  city          TEXT    NOT NULL,
  state         TEXT    NOT NULL,
  zip_code      TEXT,
  property_type TEXT    NOT NULL DEFAULT 'duplex',  -- duplex | sfh | triplex | quad
  unit_count    INTEGER NOT NULL DEFAULT 2,
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

-- ---------------------------------------------------------------------------
-- units: individual rentable units within an owned_property.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS units (
  id           SERIAL PRIMARY KEY,
  property_id  INTEGER NOT NULL REFERENCES owned_properties (id) ON DELETE CASCADE,
  unit_label   TEXT    NOT NULL,   -- '1A', '1B', 'Upper', 'Lower', etc.
  bedrooms     INTEGER,
  bathrooms    DOUBLE PRECISION,
  sqft         INTEGER,
  notes        TEXT,
  created_at   TEXT    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE (property_id, unit_label)
);

CREATE INDEX IF NOT EXISTS idx_units_property ON units (property_id);

-- ---------------------------------------------------------------------------
-- tenants: one row per person; a tenant may have multiple leases over time.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id              SERIAL PRIMARY KEY,
  unit_id         INTEGER NOT NULL REFERENCES units (id) ON DELETE SET NULL,
  first_name      TEXT    NOT NULL,
  last_name       TEXT    NOT NULL,
  email           TEXT,
  phone           TEXT,
  payment_method  TEXT    NOT NULL DEFAULT 'zelle',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,   -- FALSE once fully moved out
  notes           TEXT,
  created_at      TEXT    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE INDEX IF NOT EXISTS idx_tenants_unit ON tenants (unit_id);

-- ---------------------------------------------------------------------------
-- leases: full renewal history — one row per lease term per tenant.
-- PDF is stored (S3/R2/local) and Claude extracts all structured fields.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leases (
  id                    SERIAL PRIMARY KEY,
  tenant_id             INTEGER NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  unit_id               INTEGER NOT NULL REFERENCES units (id) ON DELETE CASCADE,

  -- Term
  start_date            TEXT    NOT NULL,          -- YYYY-MM-DD
  end_date              TEXT    NOT NULL,          -- YYYY-MM-DD

  -- Financials
  rent_amount           INTEGER NOT NULL,          -- monthly rent in whole dollars
  security_deposit      INTEGER,                   -- whole dollars
  late_fee_amount       INTEGER,                   -- flat late fee in whole dollars
  late_fee_grace_days   INTEGER,                   -- days after due before fee applies

  -- Utilities (who pays what)
  utilities_landlord    TEXT,                      -- JSON array: ["water","trash","sewer"]
  utilities_tenant      TEXT,                      -- JSON array: ["electric","gas","internet"]

  -- Equipment / appliances included
  equipment_included    TEXT,                      -- JSON array: ["refrigerator","washer","HVAC","dryer"]

  -- Source
  pdf_url               TEXT,                      -- stored PDF path/URL
  extracted_by_ai       BOOLEAN NOT NULL DEFAULT FALSE,
  ai_confidence_notes   TEXT,                      -- any fields Claude flagged as uncertain

  created_at            TEXT    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at            TEXT    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE INDEX IF NOT EXISTS idx_leases_tenant  ON leases (tenant_id);
CREATE INDEX IF NOT EXISTS idx_leases_unit    ON leases (unit_id);
CREATE INDEX IF NOT EXISTS idx_leases_end     ON leases (end_date);   -- for expiry alerts

-- ---------------------------------------------------------------------------
-- rent_collections: monthly rent payment records — expected vs actual.
-- Supports partial payments, late fees, CSV import, and manual entry.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rent_collections (
  id               SERIAL PRIMARY KEY,
  unit_id          INTEGER NOT NULL REFERENCES units (id) ON DELETE CASCADE,
  lease_id         INTEGER REFERENCES leases (id) ON DELETE SET NULL,

  -- Expected
  due_date         TEXT    NOT NULL,               -- YYYY-MM-DD (1st of month typically)
  amount_due       INTEGER NOT NULL,               -- from lease at time of collection

  -- Actual
  paid_date        TEXT,                           -- YYYY-MM-DD; NULL = unpaid
  amount_paid      INTEGER,                        -- NULL if unpaid; may be < amount_due

  -- Late / partial flags
  is_partial       BOOLEAN NOT NULL DEFAULT FALSE,
  is_late          BOOLEAN NOT NULL DEFAULT FALSE,
  late_fee_charged INTEGER,                        -- whole dollars; NULL if not charged
  late_fee_paid    INTEGER,                        -- whole dollars; NULL if not paid

  -- Source
  source           TEXT    NOT NULL DEFAULT 'manual',  -- 'manual' | 'csv_import'
  import_batch_id  TEXT,                           -- ties rows to a specific CSV upload
  notes            TEXT,

  created_at       TEXT    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at       TEXT    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE INDEX IF NOT EXISTS idx_rent_collections_unit     ON rent_collections (unit_id);
CREATE INDEX IF NOT EXISTS idx_rent_collections_due_date ON rent_collections (due_date);

-- ---------------------------------------------------------------------------
-- vendors: contractors and service providers used across properties.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendors (
  id                    SERIAL PRIMARY KEY,
  name                  TEXT    NOT NULL,
  trade                 TEXT    NOT NULL,    -- plumbing | hvac | electrical | roofing | general | landscaping | other
  phone                 TEXT,
  email                 TEXT,
  website               TEXT,

  -- Google Places
  google_place_id       TEXT,               -- stable Places API identifier
  google_rating         DOUBLE PRECISION,   -- aggregate star rating (1.0–5.0)
  google_review_count   INTEGER,
  google_last_refreshed TEXT,               -- last time we hit the Places API

  -- Manual rating
  manual_rating         INTEGER CHECK (manual_rating BETWEEN 1 AND 5),
  manual_notes          TEXT,

  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TEXT    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at            TEXT    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

-- ---------------------------------------------------------------------------
-- work_orders: one row per job, one vendor per job.
-- Status flow: received → open → complete
-- 'received' means: got a quote but chose NOT to use this vendor.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_orders (
  id              SERIAL PRIMARY KEY,
  property_id     INTEGER NOT NULL REFERENCES owned_properties (id) ON DELETE CASCADE,
  unit_id         INTEGER REFERENCES units (id) ON DELETE SET NULL,   -- NULL = whole-building job
  vendor_id       INTEGER NOT NULL REFERENCES vendors (id) ON DELETE RESTRICT,

  -- Classification
  category        TEXT    NOT NULL,   -- plumbing | hvac | electrical | roofing | appliance | general | other
  description     TEXT    NOT NULL,

  -- Status & dates
  status          TEXT    NOT NULL DEFAULT 'received'  -- received | open | complete
                  CHECK (status IN ('received', 'open', 'complete')),
  date_received   TEXT    NOT NULL,   -- YYYY-MM-DD
  date_started    TEXT,               -- YYYY-MM-DD; set when opened
  date_completed  TEXT,               -- YYYY-MM-DD; set when complete

  -- Financials
  quoted_cost     INTEGER,            -- estimate in whole dollars
  actual_cost     INTEGER,            -- final invoice amount

  -- Review (filled in after completion)
  rating          INTEGER CHECK (rating BETWEEN 1 AND 5),
  review_notes    TEXT,

  -- Attachment
  source          TEXT    NOT NULL DEFAULT 'manual',   -- manual | pdf | email_forward
  attachment_url  TEXT,                                -- stored file path/URL

  created_at      TEXT    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at      TEXT    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE INDEX IF NOT EXISTS idx_work_orders_property  ON work_orders (property_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_vendor    ON work_orders (vendor_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_status    ON work_orders (status);

-- ---------------------------------------------------------------------------
-- escrow_accounts: one account per property per lender.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS escrow_accounts (
  id            SERIAL PRIMARY KEY,
  property_id   INTEGER NOT NULL REFERENCES owned_properties (id) ON DELETE CASCADE,
  lender_name   TEXT    NOT NULL,
  loan_number   TEXT,
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE (property_id, loan_number)
);

-- ---------------------------------------------------------------------------
-- escrow_statements: one row per annual escrow analysis PDF.
-- Claude extracts all fields from the lender's escrow analysis statement.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS escrow_statements (
  id                        SERIAL PRIMARY KEY,
  escrow_account_id         INTEGER NOT NULL REFERENCES escrow_accounts (id) ON DELETE CASCADE,

  -- Analysis period
  statement_date            TEXT    NOT NULL,   -- YYYY-MM-DD (date of the statement)
  analysis_period_start     TEXT    NOT NULL,   -- YYYY-MM-DD
  analysis_period_end       TEXT    NOT NULL,   -- YYYY-MM-DD

  -- Projected vs actual
  projected_requirement     INTEGER,            -- what lender projected you'd owe (whole $)
  actual_disbursements      INTEGER,            -- what they actually paid out (whole $)
  shortage_surplus_amount   INTEGER,            -- positive = surplus, negative = shortage

  -- New payment going forward
  new_monthly_escrow        INTEGER,            -- new monthly escrow portion after reconciliation

  -- Itemized disbursements (JSON arrays of {date, payee, amount})
  tax_disbursements         TEXT,               -- JSON
  insurance_disbursements   TEXT,               -- JSON

  -- Source
  pdf_url                   TEXT,
  extracted_by_ai           BOOLEAN NOT NULL DEFAULT FALSE,
  ai_confidence_notes       TEXT,

  created_at                TEXT    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE INDEX IF NOT EXISTS idx_escrow_statements_account ON escrow_statements (escrow_account_id);

-- ---------------------------------------------------------------------------
-- insurance_policies: one row per policy upload.
-- Claude extracts all fields; policies are queryable via Slack bot.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS insurance_policies (
  id                  SERIAL PRIMARY KEY,
  property_id         INTEGER NOT NULL REFERENCES owned_properties (id) ON DELETE CASCADE,

  carrier             TEXT    NOT NULL,
  policy_number       TEXT,
  policy_type         TEXT,                    -- homeowners | landlord | liability | flood | umbrella

  -- Dates
  effective_date      TEXT    NOT NULL,        -- YYYY-MM-DD
  expiration_date     TEXT    NOT NULL,        -- YYYY-MM-DD
  renewal_period_days INTEGER,                 -- typically 365

  -- Financials
  annual_premium      INTEGER,                 -- whole dollars
  deductible          INTEGER,                 -- whole dollars
  coverage_limit      INTEGER,                 -- dwelling coverage limit, whole dollars

  -- Free-form coverage notes (extracted by Claude, also used for NLQ)
  coverage_notes      TEXT,                    -- "includes loss of rent up to 12 months", etc.

  -- Source
  pdf_url             TEXT,
  extracted_by_ai     BOOLEAN NOT NULL DEFAULT FALSE,
  ai_confidence_notes TEXT,

  created_at          TEXT    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at          TEXT    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE INDEX IF NOT EXISTS idx_insurance_property   ON insurance_policies (property_id);
CREATE INDEX IF NOT EXISTS idx_insurance_expiration ON insurance_policies (expiration_date);  -- for renewal alerts

-- Prevent duplicate lease submissions: same tenant + unit + start date = same lease
CREATE UNIQUE INDEX IF NOT EXISTS idx_leases_unique_term
  ON leases (tenant_id, unit_id, start_date);

-- Prevent duplicate tenants: same name in same unit
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_unique_name_unit
  ON tenants (unit_id, lower(first_name), lower(last_name));

-- Owner-occupied unit flag
ALTER TABLE units ADD COLUMN IF NOT EXISTS is_owner_unit BOOLEAN NOT NULL DEFAULT FALSE;

-- Track payment status: 'paid' | 'partial' | 'outstanding'
ALTER TABLE rent_collections ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'outstanding';

-- Expanded insurance coverage fields
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS dwelling_coverage INTEGER;
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS other_structures_coverage INTEGER;
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS personal_property_coverage INTEGER;
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS loss_of_use_coverage INTEGER;
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS liability_coverage INTEGER;
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS medical_payments_coverage INTEGER;
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS hurricane_deductible INTEGER;
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS wind_hail_deductible INTEGER;
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS flood_coverage INTEGER;
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS loss_of_rent_coverage INTEGER;
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS loss_of_rent_months INTEGER;

-- Track when a late fee was applicable but not charged
ALTER TABLE rent_collections ADD COLUMN IF NOT EXISTS late_fee_applicable BOOLEAN NOT NULL DEFAULT FALSE;

-- Expanded escrow statement fields
ALTER TABLE escrow_statements ADD COLUMN IF NOT EXISTS total_property_taxes NUMERIC(10,2);
ALTER TABLE escrow_statements ADD COLUMN IF NOT EXISTS total_insurance NUMERIC(10,2);

-- Escrow statements carry cents (e.g. shortage -930.96, new monthly escrow 1577.78),
-- but these columns were originally INTEGER, so saving a real statement failed with
-- "invalid input syntax for type integer". Widen them to NUMERIC. Guarded so it is a
-- no-op once converted (safe to run on every boot).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='escrow_statements' AND column_name='shortage_surplus_amount' AND data_type='integer') THEN
    ALTER TABLE escrow_statements ALTER COLUMN shortage_surplus_amount TYPE NUMERIC(12,2);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='escrow_statements' AND column_name='new_monthly_escrow' AND data_type='integer') THEN
    ALTER TABLE escrow_statements ALTER COLUMN new_monthly_escrow TYPE NUMERIC(12,2);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='escrow_statements' AND column_name='projected_requirement' AND data_type='integer') THEN
    ALTER TABLE escrow_statements ALTER COLUMN projected_requirement TYPE NUMERIC(12,2);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='escrow_statements' AND column_name='actual_disbursements' AND data_type='integer') THEN
    ALTER TABLE escrow_statements ALTER COLUMN actual_disbursements TYPE NUMERIC(12,2);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- piti_history: monthly PITI breakdown from mortgage statements
-- Claude extracts Principal, Interest, Taxes, Insurance from monthly PDFs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS piti_history (
  id                  SERIAL PRIMARY KEY,
  property_id         INTEGER NOT NULL REFERENCES owned_properties (id) ON DELETE CASCADE,
  
  -- Statement period
  statement_date      TEXT    NOT NULL,            -- YYYY-MM-DD (the statement month)
  statement_year_month TEXT   NOT NULL,            -- YYYY-MM format for easy grouping
  
  -- Breakdown
  principal           NUMERIC(12,2) NOT NULL,     -- monthly principal payment
  interest            NUMERIC(12,2) NOT NULL,     -- monthly interest payment
  property_taxes      NUMERIC(12,2) NOT NULL,     -- monthly property tax portion
  escrow_insurance    NUMERIC(12,2) NOT NULL,     -- monthly insurance (escrow portion)
  
  -- Total for the month
  total_payment       NUMERIC(12,2) NOT NULL,     -- principal + interest + taxes + insurance
  
  -- Source
  pdf_url             TEXT,
  extracted_by_ai     BOOLEAN NOT NULL DEFAULT FALSE,
  ai_confidence_notes TEXT,
  
  created_at          TEXT    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at          TEXT    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  
  UNIQUE (property_id, statement_year_month)
);

CREATE INDEX IF NOT EXISTS idx_piti_property ON piti_history (property_id);
CREATE INDEX IF NOT EXISTS idx_piti_month ON piti_history (statement_year_month);

-- ===========================================================================
-- V2.1: PROJECTS (renamed work_orders), multi-vendor quotes, recurring costs
-- work_orders is now conceptually the "projects" table: a project has a name,
-- can span multiple units, has a status flow, and collects quotes from one or
-- more vendors (project_quotes). The legacy single-vendor work-order columns are
-- kept for backwards compatibility but relaxed to nullable.
-- ===========================================================================

-- New project-level columns on work_orders.
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS project_name TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT FALSE;
-- (property_id and status already exist on work_orders.)

-- The legacy model made these NOT NULL, but a project is created from just a name
-- + status, so relax them. DROP NOT NULL is a no-op if already nullable.
ALTER TABLE work_orders ALTER COLUMN vendor_id     DROP NOT NULL;
ALTER TABLE work_orders ALTER COLUMN category      DROP NOT NULL;
ALTER TABLE work_orders ALTER COLUMN description   DROP NOT NULL;
ALTER TABLE work_orders ALTER COLUMN date_received DROP NOT NULL;

-- Status vocabulary changed 'complete' -> 'completed'. Migrate existing rows and
-- swap the CHECK constraint. Guarded so it is a no-op once applied.
DO $$
BEGIN
  UPDATE work_orders SET status = 'completed' WHERE status = 'complete';
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_orders_status_check') THEN
    ALTER TABLE work_orders DROP CONSTRAINT work_orders_status_check;
  END IF;
  ALTER TABLE work_orders ADD CONSTRAINT work_orders_status_check
    CHECK (status IN ('received', 'open', 'completed'));
END $$;

-- Make sure vendor contact columns exist (email/trade already in CREATE above).
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS trade TEXT;

-- ---------------------------------------------------------------------------
-- project_quotes: one row per vendor's quote on a project. Replaces the
-- single-vendor work-order model with multi-vendor quotes.
-- ---------------------------------------------------------------------------
-- Earlier design used project_id; the column is now work_order_id. Rename if present.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_quotes' AND column_name='project_id') THEN
    ALTER TABLE project_quotes RENAME COLUMN project_id TO work_order_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_units' AND column_name='project_id') THEN
    ALTER TABLE project_units RENAME COLUMN project_id TO work_order_id;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS project_quotes (
  id            SERIAL PRIMARY KEY,
  work_order_id INTEGER NOT NULL REFERENCES work_orders (id) ON DELETE CASCADE,
  vendor_id     INTEGER NOT NULL REFERENCES vendors (id),
  quoted_cost   NUMERIC(12,2),
  final_cost    NUMERIC(12,2),
  is_selected   BOOLEAN NOT NULL DEFAULT FALSE,   -- the winning quote
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE (work_order_id, vendor_id)
);

CREATE INDEX IF NOT EXISTS idx_project_quotes_project ON project_quotes (work_order_id);
CREATE INDEX IF NOT EXISTS idx_project_quotes_vendor  ON project_quotes (vendor_id);

-- ---------------------------------------------------------------------------
-- project_units: links a project to one or more units with optional cost split.
-- cost_share is a percentage 0-100; NULL means "split evenly".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_units (
  id            SERIAL PRIMARY KEY,
  work_order_id INTEGER NOT NULL REFERENCES work_orders (id) ON DELETE CASCADE,
  unit_id       INTEGER NOT NULL REFERENCES units (id),
  cost_share    NUMERIC(5,2),                       -- 0-100, NULL = split evenly
  UNIQUE (work_order_id, unit_id)
);

CREATE INDEX IF NOT EXISTS idx_project_units_project ON project_units (work_order_id);

-- ---------------------------------------------------------------------------
-- recurring_costs: standing monthly costs tied to a vendor, shown in cash flow.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recurring_costs (
  id             SERIAL PRIMARY KEY,
  property_id    INTEGER NOT NULL REFERENCES owned_properties (id),
  vendor_id      INTEGER REFERENCES vendors (id),
  description    TEXT NOT NULL,                    -- e.g. "Lawn Care", "Pest Control"
  monthly_amount NUMERIC(12,2) NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE INDEX IF NOT EXISTS idx_recurring_costs_property ON recurring_costs (property_id);
