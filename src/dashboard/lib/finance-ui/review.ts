import type { Taxonomy } from './taxonomy';
import { groupOf } from './taxonomy';
import type { Txn } from './types';
import { merchantKey } from '@finance/lib/merchantKey.js';

// Two heuristics flag "possibly miscategorized" transactions (ported verbatim
// from the old page):
//   1) inconsistent — the same merchant appears under more than one category.
//   2) oddgroup     — the merchant name strongly implies a group it isn't in.

export { merchantKey };

const NAME_HINTS = [
  { re: /\b(RESTAURANT|CAFE|COFFEE|STARBUCKS|DUNKIN|PIZZA|SUSHI|TACO|BURGER|GRILL|DINER|BAKERY|KITCHEN|CHIPOTLE|MCDONALD|SUBWAY|POPEYES|PANERA|WINGSTOP|DOORDASH|GRUBHUB)\b/, group: 'Food', label: 'looks like dining' },
  { re: /\b(SHELL|CHEVRON|EXXON|MOBIL|MARATHON|SUNOCO|CITGO|FUEL|PARKING|VALET|SUNPASS|JETBLUE|DELTA|AIRLINE|SOUTHWEST AIR|HOTEL|MOTEL|LODGE|CAR RENTAL)\b/, group: 'Travel', label: 'looks like travel' },
  { re: /\b(PHARMACY|WALGREENS|CVS|CLINIC|HOSPITAL|DENTAL|DENTIST|MEDICAL|PEDIATRIC|URGENT CARE)\b/, group: 'Health & Personal', label: 'looks like healthcare' },
];

export type Reason =
  | { type: 'inconsistent'; key: string; cats: string[] }
  | { type: 'oddgroup'; expected: string; label: string; actual: string };

export interface Discrepancies {
  flags: Map<number, Reason[]>;
  byMerchant: Map<string, Txn[]>;
}

/** Runs over ALL transactions (not just the period), as the old page did. */
export function computeDiscrepancies(txns: Txn[], tax: Taxonomy): Discrepancies {
  const byMerchant = new Map<string, Txn[]>();
  txns.forEach((t) => {
    const key = merchantKey(t.desc);
    if (!key) return;
    if (!byMerchant.has(key)) byMerchant.set(key, []);
    byMerchant.get(key)!.push(t);
  });
  const flags = new Map<number, Reason[]>();
  const add = (id: number, r: Reason) => {
    if (!flags.has(id)) flags.set(id, []);
    flags.get(id)!.push(r);
  };
  byMerchant.forEach((list, key) => {
    const cats = [...new Set(list.map((t) => t.cat))];
    if (cats.length > 1) list.forEach((t) => !t.cleared && add(t.id, { type: 'inconsistent', key, cats }));
  });
  txns.forEach((t) => {
    if (t.cleared) return;
    const g = groupOf(tax, t.cat);
    const up = t.desc.toUpperCase();
    for (const h of NAME_HINTS) {
      if (h.re.test(up)) {
        if (g !== h.group) add(t.id, { type: 'oddgroup', expected: h.group, label: h.label, actual: g });
        break;
      }
    }
  });
  return { flags, byMerchant };
}

/** Up to 10 other transactions with the same merchant key, newest first. */
export function similarTxns(d: Discrepancies, t: Txn, key: string): Txn[] {
  return (d.byMerchant.get(key) || [])
    .filter((x) => x.id !== t.id)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);
}
