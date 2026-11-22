import type { Groups } from './types';

export interface Taxonomy {
  /** Groups and their categories, both sorted A→Z. */
  groups: Groups;
  catToGroup: Record<string, string>;
  /** Every category, sorted A→Z. */
  allSubcats: string[];
}

/** Same as the old page's rebuildTaxonomy(): sort everything alphabetically. */
export function buildTaxonomy(raw: Groups): Taxonomy {
  const groups: Groups = {};
  Object.keys(raw)
    .sort((a, b) => a.localeCompare(b))
    .forEach((g) => {
      groups[g] = [...raw[g]!].sort((a, b) => a.localeCompare(b));
    });
  const catToGroup: Record<string, string> = {};
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
  Financials: '💳',
  Food: '🛒',
  Investments: '🏠',
  Living: '🏡',
  Other: '🎭',
  Travel: '🚗',
  'W2 Income': '💰',
};
