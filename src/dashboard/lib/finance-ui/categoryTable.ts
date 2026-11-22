import { MON_SHORT } from './format';
import { filterByPeriod, propertyOfCat, topNotes } from './period';
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

interface DataCol extends Col {
  bycat?: Record<string, number>;
  rows?: Txn[];
  delta?: boolean;
  notedByCat?: Record<string, Txn[]>;
}

/** The Spending table, exactly as the old updateCategoryTab() built it. */
export function buildCategoryTable(
  txns: Txn[],
  years: ReadonlySet<string>,
  months: ReadonlySet<string>,
  tax: Taxonomy,
  props: PropertyGroup[],
  view: CatView,
  compare: string,
): CategoryTable {
  const rows = filterByPeriod(txns, years, months, tax);
  const mkBycat = (rs: Txn[]) => {
    const m: Record<string, number> = {};
    rs.forEach((t) => (m[t.cat] = (m[t.cat] || 0) + t.amt));
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
    const cmpRows = txns.filter((t) => matchesCompare(t, compare));
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
      if (t.note && t.note.trim()) (c.notedByCat![t.cat] = c.notedByCat![t.cat] || []).push(t);
    });
  });
  const cellNote = (c: DataCol, cat: string) => (c.notedByCat ? noteTitle(topNotes(c.notedByCat[cat] || [])) : '');
  const grpNote = (c: DataCol, cats: string[]) =>
    c.notedByCat ? noteTitle(topNotes(cats.flatMap((cat) => c.notedByCat![cat] || []))) : '';

  const anyVal = (cat: string) => cols.some((c) => Math.abs(colVal(c, cat)) >= 0.01);
  const totals = cols.map(() => 0);
  const groups: GroupBlock[] = [];

  Object.entries(tax.groups).forEach(([grp, cats]) => {
    const liveCats = cats.filter(anyVal);
    if (!liveCats.length) return;
    const grpTotals = cols.map((c) => cats.reduce((s, cat) => s + colVal(c, cat), 0));
    grpTotals.forEach((v, i) => (totals[i]! += v));

    const propOrder: PropertyGroup[] = [];
    const propCats = new Map<number, string[]>();
    const standaloneCats: string[] = [];
    liveCats.forEach((cat) => {
      const p = propertyOfCat(cat, props);
      if (p) {
        if (!propCats.has(p.id)) {
          propCats.set(p.id, []);
          propOrder.push(p);
        }
        propCats.get(p.id)!.push(cat);
      } else standaloneCats.push(cat);
    });
    // Properties in their declared order (as the old PROPERTIES map did).
    propOrder.sort((a, b) => props.indexOf(a) - props.indexOf(b));

    const catRow = (cat: string): CatRow => ({
      cat,
      cells: cols.map((c) => ({ v: colVal(c, cat), note: cellNote(c, cat) })),
    });

    groups.push({
      group: grp,
      cells: grpTotals.map((v, i) => ({ v, note: grpNote(cols[i]!, cats) })),
      props: propOrder.map((p) => {
        const pcats = propCats.get(p.id)!;
        return {
          prop: p,
          cells: cols.map((c) => ({ v: pcats.reduce((s, cat) => s + colVal(c, cat), 0), note: grpNote(c, pcats) })),
          cats: pcats.map(catRow),
        };
      }),
      standalone: standaloneCats.map(catRow),
    });
  });

  let caption = view === 'monthly' ? 'One column per selected month' : 'Aggregate of selected period';
  if (compare) caption += ` · vs ${cmpLabel(compare)}`;

  return { cols: cols.map(({ label, cls }) => ({ label, cls })), groups, totals, caption };
}
