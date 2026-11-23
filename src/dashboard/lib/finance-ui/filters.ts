import { propertyOfCat } from './period';
import type { Taxonomy } from './taxonomy';
import { groupOf } from './taxonomy';
import { touchesProject, touchesProperty, type PropertyGroup, type Txn } from './types';

/** Value of the Category filter that selects a property's roll-up instead of one category. */
export const PROP_PREFIX = 'prop:';

/**
 * The global finance filters. They apply to every /finance page — KPI cards,
 * chart, Spending table and Transactions table — on top of the year/month
 * selection, so every view always shows the same rows.
 */
export interface GlobalFilters {
  group: string;
  /** '' (all), a category name, or 'prop:<propertyId>' for a property's categories. */
  category: string;
  source: string;
  /** Case-insensitive match on description, category or source. */
  search: string;
  /** Transactions linked to this property / project (set by links such as the Projects tab). */
  linkedPropertyId?: number | null;
  linkedProjectId?: number | null;
}

export const EMPTY_FILTERS: GlobalFilters = { group: '', category: '', source: '', search: '', linkedPropertyId: null, linkedProjectId: null };

export function hasActiveFilters(f: GlobalFilters): boolean {
  return !!(f.group || f.category || f.source || f.search || f.linkedPropertyId || f.linkedProjectId);
}

/** Rows matching the non-period filters (group, category/property, source, search). */
export function applyGlobalFilters(
  rows: Txn[],
  f: GlobalFilters,
  tax: Taxonomy,
  props: PropertyGroup[],
): Txn[] {
  if (!hasActiveFilters(f)) return rows;
  const search = f.search.trim().toLowerCase();
  const propId = f.category.startsWith(PROP_PREFIX) ? f.category.slice(PROP_PREFIX.length) : null;
  return rows.filter((t) => {
    if (f.group && groupOf(tax, t.cat) !== f.group) return false;
    if (propId !== null) {
      if (String(propertyOfCat(t.cat, props)?.id) !== propId) return false;
    } else if (f.category && t.cat !== f.category) return false;
    if (f.source && t.src !== f.source) return false;
    if (f.linkedPropertyId && !touchesProperty(t, f.linkedPropertyId)) return false;
    if (f.linkedProjectId && !touchesProject(t, f.linkedProjectId)) return false;
    if (
      search &&
      !t.desc.toLowerCase().includes(search) &&
      !t.cat.toLowerCase().includes(search) &&
      !t.src.toLowerCase().includes(search)
    )
      return false;
    return true;
  });
}

/** The group that holds rent, mortgage / PITI and property costs. */
export const INVESTMENTS_GROUP = 'Investments';

/**
 * "Exclude investments": leave out everything to do with the rental
 * properties — the Investments group (rent, PITI, repairs, lawn care…), any
 * category mapped to a property (e.g. a loan like Figure Lending), and any
 * transaction you assigned to a property, whatever its category. What remains
 * is personal spending and income.
 */
export function isInvestmentRelated(t: Txn, tax: Taxonomy, props: PropertyGroup[]): boolean {
  if (groupOf(tax, t.cat) === INVESTMENTS_GROUP) return true;
  if (propertyOfCat(t.cat, props)) return true;
  return (t.allocations ?? []).length > 0;
}

export function withoutInvestments(rows: Txn[], tax: Taxonomy, props: PropertyGroup[]): Txn[] {
  return rows.filter((t) => !isInvestmentRelated(t, tax, props));
}
