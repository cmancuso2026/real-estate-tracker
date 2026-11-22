# Finance UI parity checklist

Every feature of the old single-page finance dashboard (`finance/public/index.html`)
and where it lives in the Next.js app. A box is ticked once the feature is built
**and** verified in a running production build (see "How verified" at the bottom).

Pages: **Overview** `/finance` · **Spending** `/finance/spending` (the old
"Categories" tab) · **Transactions** `/finance/transactions` · **Upload**
`/finance/upload`.

## Data model and shared behavior

- [x] 1. Load **all** transactions once (`GET transactions?limit=100000`) and filter in the browser, so cards, chart, category table and transaction table always come from the same rows
- [x] 2. Taxonomy loaded from `GET categories`; groups and categories sorted A→Z in every dropdown and list
- [x] 3. A transaction's group comes from the taxonomy (`CAT_TO_GROUP[category]`, falling back to "Other"), not the stored `category_group`
- [x] 4. Year multi-select with All/none states; default = current year only (falls back to all years when the current year has no data)
- [x] 5. Month multi-select; default = current month + prior two (3-month window, wraps past January; falls back to all months)
- [x] 6. Year and month options come from the loaded data
- [x] 7. Loading indicator while data loads; error message when loading fails
- [x] 8. Note tooltip: hovering anything with a note shows it instantly, following the cursor
- [x] 9. Money formatting: `+$1,234.56` / `-$1,234.56`; short form `+$1.2k`
- [x] 10. Property groupings: categories whose leading number is a unit (e.g. "1207 Rent") roll up to that unit's property. Old: hardcoded map. New: built from `owned_properties` + `units` in the DB

## Overview (`/finance`)

- [x] 11. KPI card **Income** (+ "N paycheck deposits")
- [x] 12. KPI card **Total Spending** (+ "N expense transactions")
- [x] 13. KPI card **Cash Flow** (green when ≥ 0, red when negative; "Net for period")
- [x] 14. Chart "Income vs. Spending Over Time": income and spending series per bucket
- [x] 15. Chart **Group** filter; picking a group (with no category) switches to one line per subcategory, dropping subcategories with no activity
- [x] 16. Chart **Category** filter, narrowed to the chosen group's categories
- [x] 17. Chart property option "🏠 *property* (net)" (shown for All or Investments): Rent / Costs / dashed Net series
- [x] 18. **View**: daily / weekly (weeks start Sunday) / monthly (default)
- [x] 19. **Chart**: line (default) / bar
- [x] 20. **Bars**: separate (default) / stacked
- [x] 21. Value labels on points/bars (`$1,234`; hidden for zero; centered white when stacked)
- [x] 22. *(code-checked; the tooltip is drawn on the canvas, so the browser checks can't read it)* Tooltip: `Label: $1,234.56` per series, plus "📝 Notes:" with the top 3 largest noted transactions in that bucket
- [x] 23. Empty period → no chart

## Spending (`/finance/spending`, old "Categories" tab)

- [x] 24. **View**: aggregate (one Total column) / by month (one column per month, plus Total when there's more than one month; default)
- [x] 25. **Compare to**: None / any year (full year) / any month in the data; adds the comparison column and a "Δ vs …" column
- [x] 26. Group rows with icons and totals; click to collapse/expand; **all groups collapsed by default**
- [x] 27. **Expand all / Collapse all** toggle, label tracks state
- [x] 28. Property rows inside a group (🏠, net of their categories), collapsed by default, expandable to the nested categories; properties first, then standalone categories
- [x] 29. Only groups/categories with activity in some displayed column are shown
- [x] 30. **Net total** row
- [x] 31. Amount cells: green positive, red negative, "—" for zero; note tooltip on cells/groups with noted transactions (top 3 by size)
- [x] 32. Caption: "One column per selected month" / "Aggregate of selected period" (+ " · vs …")
- [x] 33. Empty state: "No activity for the selected period."

## Transactions (`/finance/transactions`)

- [x] 34. Filters: search (description, category or source), group, category (narrowed by group), source
- [x] 35. "N of M" count
- [x] 36. Sortable columns: Date, Description, Source, Group, Category, Amount; first click = newest/largest first for date/amount, A→Z for text; ▲/▼ indicator; ties newest first
- [x] 37. Row badges: "needs category" (Uncategorized), "⚠ review" (flagged), "📝 note" (hover shows it)
- [x] 38. Income rows styled differently; amounts green/red
- [x] 39. Inline category dropdown per row → `PUT transactions/:id/category`; reverts with an alert on failure; edited rows marked; dropdown options filled lazily (fast with thousands of rows)
- [x] 40. Click a row to expand details: full description, long date, amount, source, category · group, "Manually (edited)" / "Auto"
- [x] 41. Note editor in the details panel (Save → `PUT transactions/:id/note`; empty clears)
- [x] 42. **⚠ Review** toggle (with count of flagged rows in the period): show only possibly-miscategorized rows
- [x] 43. Flag rule 1, "inconsistent": same merchant key (first two significant words, rails/boilerplate removed) under more than one category; cleared rows count toward the category set but are never flagged
- [x] 44. Flag rule 2, "oddgroup": name implies Food / Travel / healthcare but it's filed in another group
- [x] 45. Details panel lists the reasons, plus up to 10 similar transactions (newest first, differing category highlighted)
- [x] 46. "✓ Looks fine — clear" (`PUT transactions/:id/review`), and "Restore to review" on cleared rows
- [x] 47. Row checkboxes + select-all (with indeterminate state)
- [x] 48. Bulk bar: "N selected", set category → "Apply to N" (`PUT bulk-category`), "✓ Mark reviewed" (`PUT bulk-review`), "Clear selection"
- [x] 49. Summary bar: Showing (count), Expenses, Income, ⚠️ Uncategorized count, for the filtered rows
- [x] 50. Empty state: "No transactions match your filters."

## Upload (`/finance/upload`; old modal)

- [x] 51. Choose up to 20 .csv / .xlsx / .xls files; bank detected automatically
- [x] 52. "Please choose at least one file first." when none are chosen
- [x] 53. Result: new / duplicates / parsed / files, per-source breakdown, auto-categorized count, per-file errors
- [x] 54. After an upload, all data reloads (new years/months appear)

## Moved elsewhere (not in Phase 4)

- **"＋ Category" modal** (`POST categories`): moves to the Admin portal in Phase 7, as agreed. Until then the API still accepts it, but there's no button.

## How verified

All on a production build (`next build` + `next start`) against local Postgres 16,
with a 634-transaction dataset covering Jan 2025 – Nov 2026 (rent and PITI per
property, repairs, notes, manual and cleared rows, merchants split across
categories, names that hint at another group).

1. **Side by side with the old page.** The original personal-finances app, with
   `index.html` unchanged, ran on one copy of the data and the new pages on an
   identical copy. A Playwright script set the same controls on both and compared
   what each rendered: **100 comparisons, 0 mismatches.** It covered 5 period
   selections (defaults, all, one year, two months across years, one month),
   each with:
   - KPI cards (values and sub-lines)
   - chart series and labels for 6 setups: monthly, weekly, daily, a group
     breakdown, a property's net view, one category weekly
   - the Spending table (every header, row and cell, plus note tooltips and the
     caption) for 4 setups (aggregate/by month × compare to none/a year/a month),
     with every group and property expanded
   - the Transactions table row by row (date, description and badges, source,
     group, category, amount), plus the "N of M" count, Review count and summary
     bar, for 9 filter/sort setups
   Covers items 1–6, 9–21, 24–32, 34–38.
2. **Actions on the new pages, checked in the database** (28 checks): inline
   category change and its override, lazy dropdown, note save and badge, review
   reasons and similar transactions, clear and restore, select-all with
   indeterminate state, bulk category, bulk mark reviewed, sort indicator, upload
   with an empty selection, a 2-file upload with per-source results, data
   reloading after upload, note tooltip on hover, collapsed defaults and Expand
   all, stacked bar rendering. Covers 8, 26–28, 39–48, 51–54.
3. **Edge cases:** empty period (no chart, $0 KPIs, both empty-state messages), a
   failed category save (error alert, dropdown reverts), and a failed load (error
   with Retry). Covers 7, 23, 33, 39, 50.
4. **Unit tests** (`src/dashboard/test/finance-ui.test.ts`, part of `npm test`)
   pin the default period window, roll-ups, weekly buckets, review rules, sorting,
   filters and totals.
