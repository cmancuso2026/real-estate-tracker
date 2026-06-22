# Quick Start Guide — Real Estate Tracker v2 Deployment

## What's Been Built (Summary)

### Backend (Commit 8055cd6)
✅ **Database**: New `piti_history` table + `payment_status` column on `rent_collections`
✅ **APIs**: 4 new endpoints for PITI upload, save, fetch, and metrics
✅ **Claude Integration**: Mortgage statement PDF parsing

### Frontend (Commit 79c5a2c)
✅ **OverviewTab**: 12-month metrics + insurance card + payment status badges
✅ **EscrowTab**: Escrow history + PITI upload/review/history (new component)

---

## Deploy to Production (5 minutes)

### 1. Pull Latest Code
```bash
cd real-estate-tracker
git pull origin main
```

You'll have both commits:
- `8055cd6` — Backend (database, APIs)
- `79c5a2c` — Frontend (components)

### 2. Initialize Database
```bash
npm run db:init
```

This applies `schema.sql` which adds:
- `piti_history` table
- `payment_status` column to `rent_collections`

### 3. Migrate Existing Rent Data (Optional but Recommended)
Run this SQL on your Railway database to populate `payment_status` for existing records:

```sql
UPDATE rent_collections
SET payment_status = CASE
  WHEN amount_paid IS NULL OR amount_paid = 0 THEN 'outstanding'
  WHEN amount_paid >= amount_due THEN 'paid'
  ELSE 'partial'
END
WHERE payment_status IS NULL;
```

**Note**: All new records auto-populate this field via the API.

### 4. Build & Deploy
```bash
npm run build
# If successful...
git push origin main
```

Railway auto-deploys on push. Wait ~2-3 minutes for the new version to be live.

---

## Testing Checklist (15 minutes)

### Step 1: Verify Backend APIs
```bash
# Test metrics endpoint
curl https://your-app.com/api/v2/metrics/1

# Should return:
{
  "on_time_percent": 92,
  "vacancy_percent": 5,
  "total_rent_collected": 32400,
  ...
}

# Test PITI fetch (should be empty initially)
curl "https://your-app.com/api/v2/piti?propertyId=1"

# Should return:
[]
```

### Step 2: Test Frontend — OverviewTab
1. Open your app and go to a property's Overview tab
2. Look for:
   - ✅ **12-Month Summary cards** (top section)
     - Should show: On-Time %, Vacancy %, Rent Collected, Cash Flow
   - ✅ **Insurance Expiration card** (below metrics)
     - Should show: carrier name, policy type, expiration date, status badge
   - ✅ **Unit table** with "Payment Status" column
     - Should show: ✓ Paid, ⚠ Partial, or ✗ Outstanding badges

**If metrics don't load**:
- Check browser console (F12) for errors
- Verify `/api/v2/metrics/{id}` returns data (Network tab)
- If 404: Schema migration failed; re-run `npm run db:init`

**If insurance doesn't load**:
- Verify you have insurance policies in the database
- Check Network tab: GET `/api/v2/insurance?propertyId=X` should return an array

### Step 3: Test Frontend — EscrowTab
1. Click on the property's "Escrow" tab
2. Look for:
   - ✅ **Escrow History table** (top)
     - Should show: existing escrow statements
   - ✅ **PITI Breakdown section** (bottom)
     - Should have: file upload input + "Parse" button
     - Should have: empty PITI table (no history yet)

3. **Try uploading a mortgage statement PDF**:
   - Click file input
   - Select a PDF of a mortgage statement from your lender
   - Click "Parse"
   - Claude should extract the PITI values in 5-10 seconds
   - A review form should appear with editable fields

4. **Edit and save the extracted data**:
   - Review the extracted Principal, Interest, Taxes, Insurance
   - Click "✓ Save PITI"
   - The form should disappear and the table should update
   - The new PITI record should appear in the history table

**If upload fails**:
- Check browser console for the error
- Verify ANTHROPIC_API_KEY is set in Railway environment
- Test the endpoint directly:
  ```bash
  curl -X POST https://your-app.com/api/v2/piti \
    -F "file=@statement.pdf" \
    -F "property_id=1"
  ```

**If PITI save fails**:
- Verify all required fields (statement_date, principal, interest, taxes, insurance) are filled
- Check Network tab: POST `/api/v2/piti/save` should return 200 with the saved record

---

## Expected Behavior

### Metrics Dashboard
- **On-Time Payment %**: Percentage of rent payments received on time (not late) in the last 12 months
- **Vacancy Rate**: Average percentage of units without tenants (0-100%)
- **Rent Collected**: Total amount of rent received in the last 12 months
- **Cash Flow**: Positive (green) if rent > PITI, negative (red) if PITI > rent

**Color Coding**:
- Green: Vacancy <5%, On-Time >90%, Positive cash flow
- Amber: Vacancy 5-15%, On-Time 70-90%, 30-60 day insurance expiry
- Red: Vacancy >15%, On-Time <70%, Negative cash flow, <30 day insurance expiry

### Insurance Card
- Shows the **earliest-expiring** policy (most urgent)
- Red badge if <30 days to expiration
- Amber badge if <60 days
- Green badge if >60 days or active

### Payment Status Badges
- **✓ Paid**: Amount paid >= amount due (green)
- **⚠ Partial**: 0 < amount paid < amount due (amber, shows amount/$X)
- **✗ Outstanding**: Amount paid = 0 or NULL (red)

### PITI Section
- Accepts PDF uploads from any lender (Wells Fargo, Chase, etc.)
- Claude extracts Principal, Interest, Property Taxes, Escrow Insurance
- User reviews and edits before saving
- All PITI records stored in database with monthly history
- Summary shows average PITI, latest month, and record count

---

## Troubleshooting

### Metrics return 404
**Cause**: Schema migration not applied
**Fix**: Run `npm run db:init` again

### Metrics return all zeros
**Cause**: No rent_collections data for the last 12 months
**Fix**: Add test rent records, or wait for real data to accumulate

### Payment Status column is blank
**Cause**: `payment_status` not populated in rent_collections
**Fix**: Run the SQL migration (see step 3 above)

### Insurance card shows no policy
**Cause**: No insurance policies in the database
**Fix**: Upload an insurance PDF via the Insurance tab first

### PITI upload fails silently
**Cause**: File not selected or API key not set
**Fix**: 
1. Check browser console (F12)
2. Verify file is a PDF
3. Verify ANTHROPIC_API_KEY environment variable is set in Railway

### PITI save returns 400
**Cause**: Required fields missing (statement_date, principal, interest, taxes, insurance)
**Fix**: Ensure all 4 PITI components and statement date are filled in the review form

---

## Next Steps

1. ✅ Deploy the code (both commits)
2. ✅ Run `npm run db:init` to apply schema
3. ✅ Test endpoints with `curl` commands above
4. ✅ Navigate to a property and test Overview tab
5. ✅ Test EscrowTab with a real mortgage PDF
6. 🔄 Monitor for any errors in Railway logs
7. 🔄 Share feedback on metrics display (colors, thresholds, etc.)

---

## File Reference

**Backend**:
- `src/db/schema.sql` — Database schema updates
- `src/dashboard/app/api/v2/piti/route.ts` — PDF upload & parsing
- `src/dashboard/app/api/v2/piti/save/route.ts` — Save extracted PITI
- `src/dashboard/app/api/v2/piti/index/route.ts` — Fetch PITI history
- `src/dashboard/app/api/v2/metrics/[property_id]/route.ts` — Calculate metrics
- `src/dashboard/app/api/v2/rent/route.ts` — Updated to compute payment_status

**Frontend**:
- `src/dashboard/components/OverviewTab.tsx` — Enhanced with metrics/insurance/badges
- `src/dashboard/components/EscrowTab.tsx` — New PITI upload & history component

**Documentation**:
- `IMPLEMENTATION_GUIDE.md` — Full technical details
- `FRONTEND_IMPLEMENTATION.md` — Integration instructions
- `UI_WALKTHROUGH.md` — Visual mockups & user flows

---

## Questions?

If anything isn't working:
1. Check the **browser console** (F12 → Console tab) for errors
2. Check the **Network tab** to see if API calls are succeeding (200 status)
3. Check **Railway logs** for backend errors
4. Share the error message and a screenshot

**Everything is ready to go. Deploy with confidence!**
