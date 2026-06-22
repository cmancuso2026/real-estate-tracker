# Frontend Components Implementation Summary

## Commits
- **Backend**: `8055cd6` — PITI history table, payment_status column, 4 new API endpoints, metrics calculation
- **Frontend**: `79c5a2c` — Enhanced OverviewTab, new EscrowTab component

## Components Built

### 1. OverviewTab (Enhanced)
**Location**: `src/dashboard/components/OverviewTab.tsx`

**New Features**:
- **12-Month Metrics Dashboard** (top section, "All Units" view only)
  - On-Time Payment % (green)
  - Vacancy Rate % (green/<5%, amber 5-15%, red >15%)
  - Rent Collected vs Expected
  - Monthly Cash Flow (green if positive, red if negative)
  
- **Insurance Expiration Card** (below metrics)
  - Shows primary policy (earliest expiration)
  - Red badge if <30 days
  - Amber badge if <60 days
  - Green if active

- **Updated Rent Table Column**
  - Changed "This Month" → "Payment Status"
  - Displays `PaymentStatusBadge`:
    - ✓ Paid (green)
    - ⚠ Partial (amber, shows amount / due)
    - ✗ Outstanding (red)

**Data Fetching**:
```typescript
// On mount, fetches:
GET /api/v2/metrics/{propertyId}
GET /api/v2/insurance?propertyId={propertyId}
```

**Styling**: Uses existing dark mode CSS variables, Tailwind classes

---

### 2. EscrowTab (New)
**Location**: `src/dashboard/components/EscrowTab.tsx`

**Two-Section Design**:

#### Section A: Escrow History
- Displays all escrow statements from database
- Columns: Statement Date | Period | Property Taxes | Insurance | Shortage/Surplus | New Monthly Escrow
- Link to upload new statements (placeholder: `/properties/{id}?tab=escrow&action=upload`)
- Fetches: `GET /api/v2/escrow?propertyId={propertyId}`

#### Section B: PITI Breakdown
- **Upload Form**: PDF input + "Parse" button
- **Review Form**: Inline edit of extracted fields (appears after upload)
  - Statement Date (date picker)
  - Principal, Interest, Property Taxes, Escrow Insurance (numeric inputs)
  - Confidence Notes (text input)
  - Save/Cancel buttons
- **PITI History Table**: Month | Principal | Interest | Taxes | Insurance | Total Payment
- **Summary Stats**: Average Monthly PITI | Latest Month | Record Count
- Fetches: `GET /api/v2/piti?propertyId={propertyId}`

**Data Flow**:
```
User uploads PDF
  ↓
POST /api/v2/piti → Claude parses
  ↓
Review form shows extracted values
  ↓
User edits and clicks "Save"
  ↓
POST /api/v2/piti/save
  ↓
Reload table from GET /api/v2/piti
```

---

## Integration Checklist

### Step 1: Replace OverviewTab Import
In `src/dashboard/app/properties/[id]/page.tsx`, the `OverviewTab` component already exists and has been updated. No changes needed—it's a drop-in replacement.

**Verify**:
- On "Overview" tab, with "All Units" selected, you should see:
  1. 12-Month Metrics (4 cards)
  2. Insurance Expiration Card
  3. Current Month's Summary (existing cards, relabeled)
  4. Unit table with Payment Status column

### Step 2: Wire Up EscrowTab
The existing properties page has an inline escrow handler. To use the new `EscrowTab` component:

**Option A: Replace inline handler** (recommended)
In `src/dashboard/app/properties/[id]/page.tsx`, find the escrow tab render:
```typescript
else if (tab === 'escrow') {
  // [large inline handler code]
}
```

Replace with:
```typescript
else if (tab === 'escrow') {
  return <EscrowTab id={id} />;
}
```

Then add the import at the top:
```typescript
import { EscrowTab } from '@/components/EscrowTab';
```

**Option B: Keep both**
If you want to preserve the existing inline escrow handler, you can:
- Keep EscrowTab as a standalone component in `src/dashboard/app/properties/[id]/piti/page.tsx` (separate route)
- Or conditionally render it based on a flag

### Step 3: Fix Payment Status Display
The rent table now expects `payment_status` on each unit. The API returns this, but ensure the unit fetch includes it.

In the rent collection query (likely in the properties page), the `payment_status` field should already be coming from the database. Verify the fetch returns:
```json
{
  "id": 1,
  "unit_label": "A",
  "amount_paid": 1500,
  "amount_due": 1500,
  "payment_status": "paid",
  "is_late": false
}
```

### Step 4: Test the Components

#### OverviewTab Test
1. Navigate to a property's Overview tab
2. Verify 12-month metrics load (no console errors)
3. Verify insurance expiration card loads
4. Verify unit table shows "Payment Status" column with proper badges

#### EscrowTab Test
1. Navigate to Escrow tab
2. Verify escrow statements table loads
3. Verify PITI section is empty (if no uploads yet)
4. Try uploading a mortgage statement PDF
5. Verify Claude extracts PITI data
6. Edit extracted values and save
7. Verify PITI record appears in history table

---

## API Integrations (All Ready)

### Metrics Endpoint
```
GET /api/v2/metrics/{propertyId}
→ Returns 12-month stats: on_time_percent, vacancy_percent, 
  total_rent_collected, monthly_net_cash_flow, etc.
```

### PITI Endpoints
```
POST /api/v2/piti
→ Upload mortgage PDF, Claude extracts PITI

POST /api/v2/piti/save
→ Save extracted PITI after review

GET /api/v2/piti?propertyId={id}
→ Fetch PITI history for display
```

### Insurance Endpoint
```
GET /api/v2/insurance?propertyId={id}
→ Fetch all policies; component picks earliest expiration
```

### Escrow Endpoint (existing)
```
GET /api/v2/escrow?propertyId={id}
→ Fetch escrow statements
```

---

## Styling & Colors

All components use:
- **Tailwind CSS** utilities (no custom CSS needed)
- **Dark mode support** via `dark:` classes
- **Consistent spacing**: gap-3 for cards, gap-4 for sections
- **Consistent badges**: green/amber/red based on urgency
- **Rounded corners**: `rounded-xl` for main containers, `rounded-lg` for inputs, `rounded-full` for badges

**Color scheme**:
- **Green**: Healthy metrics (on-time >90%, vacancy <5%, positive cash flow)
- **Amber**: Warning (late, 60-day lease expiry, 30-60 day insurance expiry)
- **Red**: Critical (late payments overdue, <30 day insurance expiry, negative cash flow)

---

## Known Issues & TODOs

1. **Insurance upload form placeholder**
   - EscrowTab links to `/properties/{id}?tab=escrow&action=upload` but this route doesn't exist yet
   - Either build an upload modal or remove the button until escrow upload is ready

2. **Escrow statement upload**
   - EscrowTab assumes escrow statements are available (existing endpoint works)
   - The "Add Statement" button is a placeholder; wire it to your escrow upload flow

3. **PITI average calculation**
   - Currently averages all PITI records regardless of date
   - Consider adding a filter for "last 12 months" if historical PITI data exists

4. **Metrics aggregation**
   - Metrics use `payment_status` from rent_collections
   - Ensure your existing rent records are migrated (see IMPLEMENTATION_GUIDE.md section 7)

---

## Migration Steps (Before Deploying)

1. **Deploy schema changes**:
   ```bash
   npm run db:init
   ```

2. **Migrate existing rent_collections** (add payment_status):
   ```sql
   UPDATE rent_collections
   SET payment_status = CASE
     WHEN amount_paid IS NULL OR amount_paid = 0 THEN 'outstanding'
     WHEN amount_paid >= amount_due THEN 'paid'
     ELSE 'partial'
   END
   WHERE payment_status IS NULL OR payment_status = 'outstanding';
   ```

3. **Test locally**:
   ```bash
   npm run dev
   # Visit http://localhost:3000/properties/[id] and test Overview tab
   ```

4. **Deploy to Railway**:
   ```bash
   git push origin main
   # Railway auto-deploys on push
   ```

---

## File Summary

**Modified**:
- `src/dashboard/components/OverviewTab.tsx` — Enhanced with metrics, insurance, payment badges

**New**:
- `src/dashboard/components/EscrowTab.tsx` — PITI upload & escrow history

**No changes needed**:
- `src/dashboard/app/properties/[id]/page.tsx` — If using OverviewTab as-is, only add EscrowTab import if replacing inline handler

---

## Questions for Cole

Before deploying, confirm:

1. **Insurance card behavior**: Should it link to the insurance tab, or just display as-is?
2. **Escrow upload button**: Do you want to implement PDF upload in this sprint, or defer?
3. **PITI monthly rhythm**: Will you upload statements monthly, or only when needed?
4. **Negative cash flow**: Should the card show "negative" in red text, or use a different indicator?
5. **Metrics time window**: Should metrics always be "last 12 calendar months" or rolling 365 days?

---

**All frontend components are ready for testing. Backend APIs are live.**
