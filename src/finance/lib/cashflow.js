// Actual cash flow per property from finance transactions:
//
//   cash flow = rent      (transactions in categories mapped to the property with role 'income')
//             + PITI      (categories mapped with role 'piti'; negative amounts)
//             + expenses  (categories mapped with role 'expense', plus every other
//                          transaction attributed to the property via property_id)
//
// All amounts are signed as stored (income positive, spending negative), so a
// refund on a repair reduces expenses. A transaction in a mapped category counts
// once, for the mapped property, even if it also has a property_id.

const BUCKET = { income: 'rent', piti: 'piti', expense: 'expenses' };
const r2 = (n) => Math.round(n * 100) / 100;
const empty = () => ({ rent: 0, piti: 0, expenses: 0, net: 0, count: 0 });
// 'YYYY-MM-DD' from a DATE value (string from pg with the DATE parser, or a Date).
const ymd = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/**
 * @param {Array<{date: string, amount: number|string, category: string, property_id: number|null}>} txns
 * @param {Array<{category: string, property_id: number|null, role: string}>} mappings
 * @param {{ month: string }} opts  month 'YYYY-MM'; YTD = Jan 1 of that year through the end of that month
 * @returns {Map<number, { month: object, ytd: object }>} per property id
 */
export function propertyCashFlow(txns, mappings, { month }) {
  const byCategory = new Map(mappings.filter((m) => m.property_id != null).map((m) => [m.category, m]));
  const year = month.slice(0, 4);
  const out = new Map();
  const slot = (pid) => {
    if (!out.has(pid)) out.set(pid, { month: empty(), ytd: empty() });
    return out.get(pid);
  };
  for (const t of txns) {
    const d = ymd(t.date);
    if (d.slice(0, 4) !== year || d.slice(0, 7) > month) continue; // outside YTD
    const m = byCategory.get(t.category);
    const pid = m ? Number(m.property_id) : t.property_id != null ? Number(t.property_id) : null;
    if (pid == null) continue;
    const bucket = m ? BUCKET[m.role] || 'expenses' : 'expenses';
    const amt = Number(t.amount);
    const s = slot(pid);
    for (const period of d.slice(0, 7) === month ? [s.month, s.ytd] : [s.ytd]) {
      period[bucket] += amt;
      period.net += amt;
      period.count += 1;
    }
  }
  for (const s of out.values()) {
    for (const p of [s.month, s.ytd]) for (const k of ['rent', 'piti', 'expenses', 'net']) p[k] = r2(p[k]);
  }
  return out;
}
