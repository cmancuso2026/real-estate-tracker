import { MON_SHORT } from './format';
import { propertyOfCat, topNotes } from './period';
import { noteTitle } from './notes';
import type { Taxonomy } from './taxonomy';
import type { PropertyGroup, Txn } from './types';

export type CatView = 'aggregate' | 'monthly';
export type ColClass = '' | 'total' | 'cmp' | 'delta';

export interface Col {
  label: string;
  cls: ColClass;
}

/** One amount cell: value + note tooltip text ('' when none). */
export interface Cell {
  v: number;
  note: string;
}

export interface CatRow {
  cat: string;
  cells: Cell[];
  /** Inside a property: 'income' rows are listed first, then 'expense'. */
  side?: 'income' | 'expense';
}

export interface PropBlock {
  prop: PropertyGroup;
  cells: Cell[];
  cats: CatRow[];
}

export interface GroupBlock {
  group: string;
  cells: Cell[];
  props: PropBlock[];
  standalone: CatRow[];
}

export interface CategoryTable {
  cols: Col[];
  groups: GroupBlock[];
  /** Net total row (no notes). */
  totals: number[];
  caption: string;
}

const ymOf = (t: Txn) => t.date.slice(0, 7);
const catOf = (k: string) => (k.includes('::') ? k.slice(k.indexOf('::') + 2) : k);
export function ymLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return MON_SHORT[parseInt(m!, 10)] + ' ' + y;
}
/** A compare value is 'YYYY' (full year) or 'YYYY-MM' (one month). */
export function cmpLabel(v: string): string {
  return v.length === 4 ? v : ymLabel(v);
}
const matchesCompare = (t: Txn, v: string) => (v.length === 4 ? t.date.slice(0, 4) === v : ymOf(t) === v);

/** "Compare to" options: every year ('2026 (full year)'), then every month, newest first. */
export function compareOptions(txns: Txn[]): { value: string; label: string }[] {
  const years = [...new Set(txns.map((t) => t.date.slice(0, 4)))].sort((a, b) => b.localeCompare(a));
  const yms = [...new Set(txns.map(ymOf))].sort((a, b) => b.localeCompare(a));
  return [
    ...years.map((y) => ({ value: y, label: `${y} (full year)` })),
    ...yms.map((ym) => ({ value: ym, label: ymLabel(ym) })),
  ];
}

/**
 * Where an amount lands in the table: a property's block or the group's own
 * rows. A category mapped to a property (property_category_map, "1205 Rent")
 * goes to that property in full. Otherwise each share the transaction was
 * assigned to a property (transaction_allocations — e.g. Lawn Care, or a split)
 * goes to that property, and whatever isn't assigned stays in the category's
 * own row. Keys: 'cat' or '<propertyId>::cat'.
 */
const SEP = '::';
const keyOf = (pid: number | null, cat: string) => (pid == null ? cat : `${pid}${SEP}${cat}`);
function sharesOf(t: Txn, props: PropertyGroup[]): [string, number][] {
  const mapped = propertyOfCat(t.cat, props);
  if (mapped) return [[keyOf(mapped.id, t.cat), t.amt]];
  const allocs = t.allocations ?? [];
  if (!allocs.length) return [[t.cat, t.amt]];
  const out: [string, number][] = allocs.map((a) => [keyOf(a.property_id, t.cat), a.amount]);
  const rest = Math.round((t.amt - allocs.reduce((sum, a) => sum + a.amount, 0)) * 100) / 100;
  if (Math.abs(rest) >= 0.01) out.push([t.cat, rest]);
  return out;
}

interface DataCol extends Col {
  bycat?: Record<string, number>;
  rows?: Txn[];
  delta?: boolean;
  notedByCat?: Record<string, Txn[]>;
}

/**
 * The Spending table, built as the old updateCategoryTab() did.
 * `rows`: the selected period with the global filters applied.
 * `comparePool`: every transaction with the global filters applied (no period),
 * which the "Compare to" column draws from so both sides use the same filters.
 */
export function buildCategoryTable(
  rows: Txn[],
  comparePool: Txn[],
  tax: Taxonomy,
  props: PropertyGroup[],
  view: CatView,
  compare: string,
  /** Categories to leave out entirely (card payments / transfers, which are netted out). */
  skipCat: (cat: string) => boolean = () => false,
): CategoryTable {
  rows = rows.filter((t) => !skipCat(t.cat));
  comparePool = comparePool.filter((t) => !skipCat(t.cat));
  const mkBycat = (rs: Txn[]) => {
    const m: Record<string, number> = {};
    rs.forEach((t) => sharesOf(t, props).forEach(([k, v]) => (m[k] = (m[k] || 0) + v)));
    return m;
  };
  const curBycat = mkBycat(rows);
  const cols: DataCol[] = [];

  if (view === 'monthly') {
    const yms = [...new Set(rows.map(ymOf))].sort();
    yms.forEach((ym) => {
      const r = rows.filter((t) => ymOf(t) === ym);
      cols.push({ label: ymLabel(ym), cls: '', bycat: mkBycat(r), rows: r });
    });
    if (yms.length !== 1) cols.push({ label: 'Total', cls: 'total', bycat: curBycat, rows });
  } else {
    cols.push({ label: 'Total', cls: '', bycat: curBycat, rows });
  }

  let cmpBycat: Record<string, number> | null = null;
  if (compare) {
    const cmpRows = comparePool.filter((t) => matchesCompare(t, compare));
    cmpBycat = mkBycat(cmpRows);
    cols.push({ label: cmpLabel(compare), cls: 'cmp', bycat: cmpBycat, rows: cmpRows });
    cols.push({ label: 'Δ vs ' + cmpLabel(compare), cls: 'delta', delta: true });
  }

  const colVal = (c: DataCol, cat: string) =>
    c.delta ? (curBycat[cat] || 0) - (cmpBycat![cat] || 0) : c.bycat![cat] || 0;

  cols.forEach((c) => {
    if (!c.rows) return;
    c.notedByCat = {};
    c.rows.forEach((t) => {
      if (t.note && t.note.trim()) for (const [k] of sharesOf(t, props)) (c.notedByCat![k] = c.notedByCat![k] || []).push(t);
    });
  });
  const cellNote = (c: DataCol, cat: string) => (c.notedByCat ? noteTitle(topNotes(c.notedByCat[cat] || [])) : '');
  const grpNote = (c: DataCol, cats: string[]) =>
    c.notedByCat ? noteTitle(topNotes(cats.flatMap((cat) => c.notedByCat![cat] || []))) : '';

  const anyVal = (cat: string) => cols.some((c) => Math.abs(colVal(c, cat)) >= 0.01);
  const totals = cols.map(() => 0);
  const groups: GroupBlock[] = [];

  // Every key that has a value somewhere, so property blocks can be found per group.
  const allKeys = new Set<string>();
  cols.forEach((c) => c.bycat && Object.keys(c.bycat).forEach((k) => allKeys.add(k)));
  const propById = new Map(props.map((p) => [p.id, p]));

  Object.entries(tax.groups).forEach(([grp, cats]) => {
    const inGroup = new Set(cats);
    const keys = [...allKeys].filter((k) => inGroup.has(k.includes(SEP) ? k.slice(k.indexOf(SEP) + SEP.length) : k));
    const liveKeys = keys.filter(anyVal);
    if (!liveKeys.length) return;
    const grpTotals = cols.map((c) => keys.reduce((s, k) => s + colVal(c, k), 0));
    grpTotals.forEach((v, i) => (totals[i]! += v));

    const propKeys = new Map<number, string[]>();
    const standaloneCats: string[] = [];
    // categories in their taxonomy order, then each property's keys in that order
    const order = new Map(cats.map((c, i) => [c, i]));
    liveKeys
      .sort((x, y) => (order.get(catOf(x)) ?? 0) - (order.get(catOf(y)) ?? 0))
      .forEach((k) => {
        if (!k.includes(SEP)) return void standaloneCats.push(k);
        const pid = Number(k.slice(0, k.indexOf(SEP)));
        if (!propKeys.has(pid)) propKeys.set(pid, []);
        propKeys.get(pid)!.push(k);
      });
    // Properties in their declared order (as the old PROPERTIES map did).
    const propOrder = [...propKeys.keys()]
      .map((id) => propById.get(id) ?? { id, name: `Property ${id}`, units: [], categories: [] })
      .sort((x, y) => props.findIndex((p) => p.id === x.id) - props.findIndex((p) => p.id === y.id));

    const catRow = (k: string): CatRow => ({
      cat: catOf(k),
      cells: cols.map((c) => ({ v: colVal(c, k), note: cellNote(c, k) })),
    });
    // Inside a property: money in (rent) first, then expenses.
    const totalIdx = cols.length - 1 - (compare ? 2 : 0);
    const propRows = (ks: string[]) => {
      const rowsP = ks.map((k) => {
        const r = catRow(k);
        const net = r.cells[Math.max(totalIdx, 0)]?.v ?? 0;
        return { ...r, side: (net > 0 ? 'income' : 'expense') as 'income' | 'expense' };
      });
      return [...rowsP.filter((r) => r.side === 'income'), ...rowsP.filter((r) => r.side === 'expense')];
    };

    groups.push({
      group: grp,
      cells: grpTotals.map((v, i) => ({ v, note: grpNote(cols[i]!, keys) })),
      props: propOrder.map((p) => {
        const pk = propKeys.get(p.id)!;
        return {
          prop: p,
          cells: cols.map((c) => ({ v: pk.reduce((s, k) => s + colVal(c, k), 0), note: grpNote(c, pk) })),
          cats: propRows(pk),
        };
      }),
      standalone: standaloneCats.map(catRow),
    });
  });

  let caption = view === 'monthly' ? 'One column per selected month' : 'Aggregate of selected period';
  if (compare) caption += ` · vs ${cmpLabel(compare)}`;

  return { cols: cols.map(({ label, cls }) => ({ label, cls })), groups, totals, caption };
}
