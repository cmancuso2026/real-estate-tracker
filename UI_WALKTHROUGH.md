# Frontend Component UI Walkthrough

## OverviewTab — New Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ 12-Month Summary                                                │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  │ On-Time Payment% │  │  Vacancy Rate    │  │  Rent Collected  │
│  │       92%        │  │       5%         │  │   $32.4k / $35k  │
│  │ of 12 months     │  │ 2 rental units   │  │ of 12 months     │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘
│  
│  ┌──────────────────┐
│  │ Monthly Cash Flo │
│  │    -$1,571.57    │
│  │   (negative)     │
│  └──────────────────┘
│
├─────────────────────────────────────────────────────────────────┤
│ Insurance & Renewals                                            │
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ State Farm                                    [Renews in 23d] │ │
│ │ Homeowners • Expires 07/15/2025                              │ │
│ │ Premium: $2,400/year                                         │ │
│ └─────────────────────────────────────────────────────────────┘ │
│
├─────────────────────────────────────────────────────────────────┤
│ Units                                                           │
│ [All Units] [Unit A] [Unit B] [Unit C]                         │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  │ This Month's Rent│  │Rent Collected(MT)│  │  Occupied Units  │
│  │    $3,000        │  │  $3,000 (100%)   │  │    3 / 3         │
│  │   due today      │  │                  │  │                  │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘
│
├─────────────────────────────────────────────────────────────────┤
│ Unit │ Tenant        │ Rent/mo │ Payment Status   │ Lease ... │
├─────────────────────────────────────────────────────────────────┤
│ A    │ John Smith    │ $1,000  │ ✓ Paid $1,000    │ Active ... │
│ B    │ Jane Doe      │ $1,000  │ ⚠ Partial $500/  │ Active ... │
│      │               │         │   $1,000         │            │
│ C    │ Vacant        │ $1,000  │ ✗ Outstanding    │ No lease..│
│      │               │         │                  │            │
└─────────────────────────────────────────────────────────────────┘
```

### Key Changes
1. **Metrics cards** appear at the top when "All Units" is selected
2. **Insurance card** shows primary policy expiration
3. **"This Month's Rent" cards** relabeled for clarity
4. **Payment Status column** replaces "This Month" with visual badges:
   - Green ✓ with full amount
   - Amber ⚠ with partial amounts
   - Red ✗ for outstanding

---

## EscrowTab — Two-Section Design

```
┌──────────────────────────────────────────────────────────────────┐
│ Escrow History                                   [+ Add Statement]│
├──────────────────────────────────────────────────────────────────┤
│ Statement │ Period          │ Taxes │ Insurance │ Short/Surplus  │
│ Date      │                 │       │           │ New Monthly Es.│
├──────────────────────────────────────────────────────────────────┤
│ 03/31/25  │ 03/24-02/25     │$4,800│ $1,200   │ -$930.96 | $450│
│ 03/31/24  │ 03/23-02/24     │$4,650│ $1,100   │ +$250.00 | $430│
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ Mortgage PITI Breakdown                                          │
├──────────────────────────────────────────────────────────────────┤
│ Upload Mortgage Statement                                        │
│ ┌──────────────────────────────┐  ┌──────────┐                  │
│ │ Select PDF...                │  │  Parse   │                  │
│ └──────────────────────────────┘  └──────────┘                  │
│ Upload a PDF mortgage statement. Claude will extract...         │
│
├──────────────────────────────────────────────────────────────────┤
│ Review Extracted Data                                           │[Amber bg]
│ ┌─────────────┐  ┌──────────┐  ┌─────────┐  ┌─────────────────┐│
│ │Statement    │  │Principal │  │Interest │  │Property Taxes   ││
│ │Date: ▼      │  │$1,234.56 │  │$2,345.67│  │$456.78          ││
│ │2025-03-31   │  │          │  │         │  │                 ││
│ └─────────────┘  └──────────┘  └─────────┘  └─────────────────┘│
│ ┌───────────────────┐  ┌────────────────────────────────────┐  │
│ │Escrow Insurance   │  │Confidence Notes                    │  │
│ │$234.56            │  │Escrow insurance inferred from...   │  │
│ └───────────────────┘  └────────────────────────────────────┘  │
│ [✓ Save PITI] [Cancel]                                          │
│
├──────────────────────────────────────────────────────────────────┤
│ Month     │ Principal │ Interest  │ Taxes   │ Insurance │ Total  │
├──────────────────────────────────────────────────────────────────┤
│ 2025-03   │ $1,234.56 │ $2,345.67 │ $456.78 │ $234.56  │$4,271.57│
│ 2025-02   │ $1,240.12 │ $2,340.10 │ $450.00 │ $235.00  │$4,265.22│
│ 2025-01   │ $1,245.89 │ $2,334.45 │ $455.50 │ $234.16  │$4,270.00│
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ ┌──────────────────────┐ ┌──────────┐ ┌──────────────┐           │
│ │ Avg Monthly PITI     │ │Latest    │ │ Records      │           │
│ │ $4,269.26            │ │ 2025-03  │ │ 3            │           │
│ └──────────────────────┘ └──────────┘ └──────────────┘           │
└──────────────────────────────────────────────────────────────────┘
```

### Key Features

**Section A: Escrow History**
- Shows lender's annual escrow analysis
- Displays tax/insurance disbursements
- Shows shortage/surplus (red if shortage, green if surplus)
- Historical data only

**Section B: PITI Breakdown**
- Upload mortgage statement PDFs (Claude-powered)
- Inline review form (no page navigation)
- Edit extracted Principal, Interest, Taxes, Insurance
- Save to database with confidence notes
- Historical PITI table with trend data
- Summary statistics at bottom

---

## Data Validation & Error States

### Upload Error (No File Selected)
```
┌─────────────────────────────────────────────────┐
│ Upload Mortgage Statement                      │
│ ┌────────────────────────────────────┐  ┌─────┐│
│ │ Select PDF...                      │  │Parse││ (disabled)
│ └────────────────────────────────────┘  └─────┘│
```

### Parsing (Loading State)
```
┌─────────────────────────────────────────────────┐
│ ┌────────────────────────────────────┐  ┌──────┐│
│ │ statement.pdf                      │  │Parsing...││
│ └────────────────────────────────────┘  └──────┘│
```

### Review Form (Extracted Data)
```
[Amber box - requires review before save]
✓ Save PITI (enabled only if statement_date + principal are set)
Cancel
```

### Empty States
```
┌──────────────────────────────────────────────────┐
│ No escrow statements on file                     │
└──────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────┐
│ No mortgage statements uploaded yet              │
└──────────────────────────────────────────────────┘
```

---

## Responsive Behavior

### Desktop (1024px+)
- 4-column metrics grid
- 2-column form inputs
- Full-width tables

### Tablet (768-1023px)
- 2-column metrics grid (metrics change to 2 rows)
- 2-column form inputs
- Scrollable tables

### Mobile (< 768px)
- 1-column metrics (single column)
- 1-column form inputs (stacked)
- Scrollable tables with overflow

All components use Tailwind's `sm:`, `lg:` breakpoints.

---

## Dark Mode Support

All components fully support dark mode via `dark:` Tailwind classes:
- Cards: `dark:border-gray-800 dark:bg-gray-900`
- Text: `dark:text-gray-300 dark:text-gray-400`
- Badges: `dark:bg-green-900/30 dark:text-green-400`
- Inputs: `dark:border-gray-700 dark:bg-gray-800`

No special configuration needed—works with your existing dark mode setup.

---

## Accessibility

- Semantic HTML (`<table>`, `<thead>`, `<label>`)
- Form inputs have `<label>` or aria attributes
- Buttons have clear text ("Parse", "✓ Save PITI", "Cancel")
- Color not the only indicator (badges use icons + text)
- Loading states use "..." suffix or "Parsing..." text
- Tab order is logical (left-to-right, top-to-bottom)

---

## Animation & Transitions

**Subtle animations**:
- Button hover: background color transition (0.15s)
- Loading spinner: Not implemented (uses text "Parsing...")
- Empty states: Fade in (implicit via React mounting)

No heavy animations—focus on clarity and usability.

---

## Integration Testing Checklist

- [ ] OverviewTab metrics load correctly
- [ ] Insurance card displays with proper colors
- [ ] Payment status badges show correct states (paid/partial/outstanding)
- [ ] Unit table scrolls on mobile without breaking layout
- [ ] EscrowTab PDF upload works (Chrome/Firefox/Safari)
- [ ] Claude parsing extracts PITI values correctly
- [ ] Review form allows editing extracted values
- [ ] Saving PITI updates table immediately
- [ ] Dark mode toggles all colors correctly
- [ ] No console errors in browser DevTools
- [ ] API calls succeed (Network tab shows 200/201 responses)

---

**All UI components match your existing design system and dark mode setup.**
