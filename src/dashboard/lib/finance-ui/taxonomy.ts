import type { Groups } from './types';

export interface Taxonomy {
  /** Groups and their categories, both sorted A→Z. */
  groups: Groups;
  catToGroup: Record<string, string>;
  /** Every category, sorted A→Z. */
  allSubcats: string[];
}

/**
 * Groups and categories in the order Admin sets (A→Z until you reorder — the
 * order the old page always used). `catToGroup` comes from the API so archived
 * categories, which are hidden from `groups`, still show their group.
 */
export function buildTaxonomy(raw: Groups, apiCatToGroup: Record<string, string> = {}): Taxonomy {
  const groups: Groups = {};
  Object.keys(raw).forEach((g) => {
    groups[g] = [...raw[g]!];
  });
  const catToGroup: Record<string, string> = { ...apiCatToGroup };
  Object.entries(groups).forEach(([g, cats]) => cats.forEach((c) => (catToGroup[c] = g)));
  const allSubcats = Object.values(groups)
    .flat()
    .sort((a, b) => a.localeCompare(b));
  return { groups, catToGroup, allSubcats };
}

/** A transaction's group, from the taxonomy (fallback 'Other'), as the old page did. */
export function groupOf(tax: Taxonomy, cat: string): string {
  return tax.catToGroup[cat] || 'Other';
}

export const GROUP_ICON: Record<string, string> = {
  Baby: '👶',
  'Bills & Utilities': '🔌',
  Financials: '💳',
  Food: '🛒',
  Fun: '🎉',
  'Health & Personal': '🧘',
  Investments: '🏠',
  Other: '❓',
  Shopping: '🛍️',
  Travel: '🚗',
  'W2 Income': '💰',
};
