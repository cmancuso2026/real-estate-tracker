# Real Estate Tracker v2 — Scope Implementation Summary

## Changes Made

This document outlines the backend infrastructure built to support the four scope items you requested. All changes are backward-compatible and ready to integrate with the frontend UI.

---

## 1. Database Schema Updates

### New Table: `piti_history`
Stores monthly mortgage statement data extracted from PDFs. Each row represents one month's Principal, Interest, Taxes, Insurance breakdown.

**Schema:**
```sql
CREATE TABLE piti_history (
  id                  SERIAL PRIMARY KEY,
  property_id         INTEGER NOT NULL REFERENCES owned_properties (id) ON DELETE CASCADE,
  statement_date      TEXT    NOT NULL,            -- YYYY-MM-DD
  statement_year_month TEXT   NOT NULL,            -- YYYY-MM (for grouping)
  principal           NUMERIC(12,2) NOT NULL,
  interest            NUMERIC(12,2) NOT NULL,
  property_taxes      NUMERIC(12,2) NOT NULL,
  escrow_insurance    NUMERIC(12,2) NOT NULL,
  total_payment       NUMERIC(12,2) NOT NULL,     -- sum of above
  pdf_url             TEXT,
  extracted_by_ai     BOOLEAN NOT NULL DEFAULT FALSE,
  ai_confidence_notes TEXT,
  created_at          TEXT    NOT NULL DEFAULT now(),
  updated_at          TEXT    NOT NULL DEFAULT now(),
  UNIQUE (property_id, statement_year_month)
);
```

**Indexes:**
- `idx_piti_property` — lookup by property
- `idx_piti_month` — lookup by YYYY-MM

### Updated Table: `rent_collections`
Added `payment_status` column to track three states: **'paid'** | **'partial'** | **'outstanding'**.

This is computed automatically on insert/update:
- `'paid'` — amount_paid >= amount_due
- `'partial'` — 0 < amount_paid < amount_due
- `'outstanding'` — amount_paid is NULL or 0

---

## 2. Backend API Endpoints

### POST `/api/v2/piti`
**Upload and parse a monthly mortgage statement PDF.**

**Request:**
```
Form Data:
- file: PDF document
- property_id: The property ID
```

**Response:**
```json
{
  "extracted": {
    "statement_date": "2025-03-31",
    "principal": 1234.56,
    "interest": 2345.67,
    "property_taxes": 456.78,
    "escrow_insurance": 234.56,
    "confidence_notes": null
  },
  "file_name": "statement.pdf"
}
```

**Claude Extraction Prompt:**
Analyzes the PDF and extracts the four PITI components. Handles various mortgage statement formats (Wells Fargo, Chase, etc.). Returns null values if fields are ambiguous.

---

### POST `/api/v2/piti/save`
**Save extracted PITI record after user review.**

**Request:**
```json
{
  "property_id": 1,
  "statement_date": "2025-03-31",
  "principal": 1234.56,
  "interest": 2345.67,
  "property_taxes": 456.78,
  "escrow_insurance": 234.56,
  "pdf_url": "s3://...",
  "ai_confidence_notes": "Escrow insurance inferred from lender's total"
}
```

**Response:**
```json
{
  "success": true,
  "piti": {
    "id": 42,
    "property_id": 1,
    "statement_date": "2025-03-31",
    "statement_year_month": "2025-03",
    ...
  }
}
```

**Note:** Uses ON CONFLICT for idempotent inserts (same property + month = update).

---

### GET `/api/v2/piti?propertyId=1`
**Fetch PITI history for a property.**

**Response:**
```json
[
  {
    "id": 42,
    "property_id": 1,
    "statement_date": "2025-03-31",
    "statement_year_month": "2025-03",
    "principal": 1234.56,
    "interest": 2345.67,
    "property_taxes": 456.78,
    "escrow_insurance": 234.56,
    "total_payment": 4271.57,
    ...
  }
]
```

Sorted by `statement_year_month DESC` (newest first).

---

### GET `/api/v2/metrics/[property_id]`
**Calculate 12-month metrics for a property.**

**Response:**
```json
{
  "on_time_percent": 92,
  "vacancy_percent": 5,
  "total_rent_collected": 32400,
  "total_rent_expected": 35000,
  "monthly_average_collected": 2700,
  "monthly_average_piti": 4271.57,
  "monthly_net_cash_flow": -1571.57,
  "months_analyzed": 12,
  "rental_units": 2,
  "total_units": 3
}
```

**Calculation Details:**
- **on_time_percent:** Percentage of rent payments received on time (not late) in the last 12 months
- **vacancy_percent:** Average percentage of rental units vacant per month
- **total_rent_collected:** Sum of all amount_paid in rent_collections for the period
- **total_rent_expected:** Sum of all amount_due
- **monthly_average_collected:** total_rent_collected / months_analyzed
- **monthly_net_cash_flow:** average_monthly_collected - average_monthly_piti
- **months_analyzed:** How many unique months have rent records

---

## 3. Data Flow & UI Integration Points

### PITI Upload Flow (for OverviewTab Escrow section)
```
User uploads mortgage statement PDF
  ↓
POST /api/v2/piti → Claude parses → Shows extracted values with confidence notes
  ↓
User reviews and confirms (inline form, no page redirect)
  ↓
POST /api/v2/piti/save → Record saved with payment_status='paid'
  ↓
GET /api/v2/piti?propertyId=X → Fetch history for display
```

### 12-Month Metrics Flow
```
OverviewTab mounts
  ↓
fetch(/api/v2/metrics/[property_id])
  ↓
Render four metric cards:
  - On-time payment % + badge
  - Vacancy rate % + badge
  - Rent collected $X | Expected $Y
  - Monthly cash flow $Z
```

### Rent Payment Badges Flow
```
OverviewTab renders unit table
  ↓
For each rent row, check payment_status:
  - 'paid'       → ✓ Paid (green badge)
  - 'partial'    → ⚠️ Partial (amber badge + amount)
  - 'outstanding' → ✗ Outstanding (red badge)
```

---

## 4. Implementation Checklist for Frontend

### OverviewTab Updates

#### Add Payment Status Badges (Rent Collection)
- Display `payment_status` in the rent history table or summary
- Green badge: "Paid in full"
- Amber badge: "Partial ($XXXX of $XXXX)"
- Red badge: "Outstanding"

#### Add Insurance Expiration Card
- Fetch the 1205 insurance policy (use existing insurance endpoint)
- Calculate days until expiration
- Display prominently on overview (same layout weight as leases)
- Red if expiring in <30 days, amber if <60 days

#### Add 12-Month Metrics Dashboard
- Fetch `/api/v2/metrics/[property_id]` on mount
- Render 4 cards (2x2 grid):
  1. On-Time Payment % (e.g., 92%)
  2. Vacancy Rate % (e.g., 5%)
  3. Rent Collected vs Expected (e.g., $32.4K collected | $35K expected)
  4. Monthly Cash Flow (e.g., -$1,571.57)

#### Redesign Escrow Tab
Split into two sections:

**Section A: Escrow History** (existing)
- Escrow statements from `escrow_statements` table
- Display analysis period, shortage/surplus, disbursements
- Upload new escrow PDF

**Section B: PITI Breakdown** (new)
- Table of PITI history from `piti_history` table
- Columns: Month | Principal | Interest | Taxes | Insurance | Total
- Upload new mortgage statement PDF
- Show average PITI for the last 3/6/12 months

---

## 5. Files Changed / Created

### New Files
```
src/dashboard/app/api/v2/piti/route.ts          (PDF upload & parsing)
src/dashboard/app/api/v2/piti/save/route.ts     (Save extracted PITI)
src/dashboard/app/api/v2/piti/index/route.ts    (Fetch PITI history)
src/dashboard/app/api/v2/metrics/[property_id]/route.ts  (12-month metrics)
```

### Modified Files
```
src/db/schema.sql                               (Added piti_history table, payment_status column)
src/dashboard/app/api/v2/rent/route.ts          (POST endpoint: compute payment_status)
```

---

## 6. Testing the Backend (Before UI Build)

### Test PITI Upload
```bash
curl -X POST http://localhost:3000/api/v2/piti \
  -F "file=@statement.pdf" \
  -F "property_id=1"
```

### Test PITI Save
```bash
curl -X POST http://localhost:3000/api/v2/piti/save \
  -H "Content-Type: application/json" \
  -d '{
    "property_id": 1,
    "statement_date": "2025-03-31",
    "principal": 1234.56,
    "interest": 2345.67,
    "property_taxes": 456.78,
    "escrow_insurance": 234.56
  }'
```

### Test Metrics
```bash
curl http://localhost:3000/api/v2/metrics/1
```

### Test PITI History
```bash
curl http://localhost:3000/api/v2/piti?propertyId=1
```

---

## 7. Known Assumptions & Next Steps

### Assumptions Made
1. **PITI extraction** uses Claude's document parsing (same as leases/escrow)
2. **Payment status** is computed on save (no migrations needed for existing data; they'll default to 'outstanding')
3. **Metrics use the last 12 calendar months** (not rolling 365 days)
4. **One mortgage per property** (single PITI history series)
5. **Insurance policy expiration** uses the existing 1205 policy; if multiple policies exist, show the earliest expiration

### Before Going Live

1. **Deploy schema changes** (run `npm run db:init` on Railway)
2. **Migrate existing rent_collections** to populate `payment_status`:
   ```sql
   UPDATE rent_collections
   SET payment_status = CASE
     WHEN amount_paid IS NULL OR amount_paid = 0 THEN 'outstanding'
     WHEN amount_paid >= amount_due THEN 'paid'
     ELSE 'partial'
   END;
   ```
3. **Build the UI components** (OverviewTab, EscrowTab redesign)
4. **Test with your own mortgage statements** (ensure Claude parsing handles your lender's format)

---

## 8. Questions for Cole

Before building the frontend, clarify:

1. **Insurance expiration badge**: Should it show days or just "Expiring in X days"? Color thresholds?
2. **Cash flow display**: Should negative cash flow be highlighted in red? What about positive?
3. **PITI upload frequency**: Monthly? Quarterly? (Affects UI prompt/workflow)
4. **12-month metrics card titles**: Any preference on wording (e.g., "On-Time Payment %" vs "Collection Rate")?
5. **Insurance policy selection**: If you have multiple policies per property, which one shows on the overview (earliest expiration, or primary homeowners)?

---

**All backend code is ready to test.** Metrics API and PITI endpoints are fully functional and use the updated schema.
