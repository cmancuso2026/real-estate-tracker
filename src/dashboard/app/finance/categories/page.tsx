'use client';

import { useEffect, useMemo, useState } from 'react';
import { useFinance } from '@/components/finance/FinanceData';
import { Card, Field, btnSecondary, selectCls } from '@/components/finance/ui';
import {
  buildCategoryTable,
  compareOptions,
  type Cell,
  type ColClass,
  type CatView,
} from '@/lib/finance-ui/categoryTable';
import { fmt } from '@/lib/finance-ui/format';
import { GROUP_ICON } from '@/lib/finance-ui/taxonomy';
import { merchantLabel, transfersLeftOut } from '@/lib/finance-ui/sankey';
import { categoryKind } from '@finance/lib/metrics.js';
import { TransfersNote } from '@/components/finance/TransfersNote';

const colBg: Record<ColClass, string> = {
  '': '',
  total: 'bg-gray-50 font-semibold',
  cmp: 'bg-blue-50/60',
  delta: 'bg-amber-50/60',
};

function AmountCell({ cell, cls, bold = false }: { cell: Cell; cls: ColClass; bold?: boolean }) {
  const zero = Math.abs(cell.v) < 0.01;
  const color = zero ? 'text-gray-300' : cell.v > 0 ? 'text-green-700' : 'text-red-600';
  return (
    <td
      data-note={cell.note || undefined}
      className={`whitespace-nowrap px-3 py-1.5 text-right tabular ${color} ${colBg[cls]} ${bold ? 'font-semibold' : ''} ${
        cell.note ? 'cursor-help underline decoration-dotted underline-offset-2' : ''
      }`}
    >
      {zero ? '—' : fmt(cell.v)}
    </td>
  );
}

export default function FinanceSpendingPage() {
  const { txns, filteredTxns, comparePool, tax, props, metricsCtx } = useFinance();
  const [view, setView] = useState<CatView>('monthly');
  const [compare, setCompare] = useState('');
  // Groups and properties start collapsed (as on the old page).
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [openProps, setOpenProps] = useState<Set<number>>(new Set());
  // Category rows you clicked open to see their merchants ('<propertyId|>::<cat>').
  const [openCats, setOpenCats] = useState<Set<string>>(new Set());

  const table = useMemo(
    () => buildCategoryTable(filteredTxns, comparePool, tax, props, view, compare, (c) => categoryKind(c, metricsCtx) === 'transfer'),
    [filteredTxns, comparePool, tax, props, view, compare, metricsCtx],
  );
  const options = useMemo(() => compareOptions(txns), [txns]);
  useEffect(() => {
    if (compare && !options.some((o) => o.value === compare)) setCompare('');
  }, [options, compare]);

  /** Merchants behind one row for the selected period: largest first. */
  const merchantsOf = (cat: string, propertyId: number | null) => {
    const m = new Map<string, { total: number; count: number }>();
    for (const t of filteredTxns) {
      if (t.cat !== cat) continue;
      let amt = t.amt;
      if (propertyId != null) {
        const mapped = props.find((p) => p.id === propertyId)?.categories.includes(cat);
        const share = t.allocations.filter((a) => a.property_id === propertyId).reduce((s, a) => s + a.amount, 0);
        if (!mapped && !share) continue;
        if (!mapped) amt = share;
      } else if (props.some((p) => p.categories.includes(cat))) {
        continue;
      } else if (t.allocations.length) {
        amt = t.amt - t.allocations.reduce((s, a) => s + a.amount, 0); // the part not assigned to a property
        if (Math.abs(amt) < 0.005) continue;
      }
      const k = merchantLabel(t.desc);
      const e = m.get(k) ?? { total: 0, count: 0 };
      e.total += amt;
      e.count += 1;
      m.set(k, e);
    }
    return [...m.entries()].sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total));
  };
  const catKey = (cat: string, pid: number | null) => `${pid ?? ''}::${cat}`;
  const drillRow = (cat: string, pid: number | null, indent: string) => {
    const list = merchantsOf(cat, pid);
    return (
      <tr className="bg-gray-50/60" data-testid="merchant-drill">
        <td colSpan={table.cols.length + 1} className={`py-2 ${indent} pr-4`}>
          {list.length === 0 ? (
            <span className="text-xs text-gray-400">No transactions in the selected period.</span>
          ) : (
            <div className="grid max-w-2xl grid-cols-[1fr_auto_auto] gap-x-6 gap-y-0.5 text-xs">
              {list.slice(0, 15).map(([name, e]) => (
                <FragmentRows key={name}>
                  <span className="truncate text-gray-700">{name}</span>
                  <span className="text-right text-gray-400">{e.count}×</span>
                  <span className={`text-right tabular ${e.total < 0 ? 'text-red-600' : 'text-green-700'}`}>{fmt(e.total)}</span>
                </FragmentRows>
              ))}
              {list.length > 15 && <span className="col-span-3 text-gray-400">…and {list.length - 15} more</span>}
            </div>
          )}
        </td>
      </tr>
    );
  };

  const groupNames = Object.keys(tax.groups);
  const allCollapsed = groupNames.length > 0 && groupNames.every((g) => !openGroups.has(g));
  const toggle = <T,>(set: Set<T>, v: T) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    return n;
  };

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-gray-100 px-4 py-3">
        <Field label="View:">
          <select aria-label="Table view" className={selectCls} value={view} onChange={(e) => setView(e.target.value as CatView)}>
            <option value="aggregate">Aggregate</option>
            <option value="monthly">By month (columns)</option>
          </select>
        </Field>
        <Field label="Compare to:">
          <select aria-label="Compare to" className={selectCls} value={compare} onChange={(e) => setCompare(e.target.value)}>
            <option value="">None</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <button
          className={btnSecondary}
          onClick={() => {
            setOpenGroups(allCollapsed ? new Set(groupNames) : new Set());
            setOpenProps(allCollapsed ? new Set(table.groups.flatMap((g) => g.props.map((p) => p.prop.id))) : new Set());
          }}
        >
          {allCollapsed ? 'Expand all' : 'Collapse all'}
        </button>
        <span className="text-xs text-gray-400" data-testid="spending-caption">
          {table.caption}
        </span>
      </div>

      {table.groups.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-gray-400">No activity for the selected period.</div>
      ) : (
        <div className="max-h-[70vh] overflow-auto">
          <table className="min-w-full text-sm" data-testid="spending-table">
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2 text-left font-medium">Category</th>
                {table.cols.map((c, i) => (
                  <th key={i} className={`whitespace-nowrap px-3 py-2 text-right font-medium ${colBg[c.cls]}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.groups.map((g) => {
                const open = openGroups.has(g.group);
                return (
                  <FragmentRows key={g.group}>
                    <tr
                      className="cursor-pointer border-t border-gray-200 bg-gray-50/70 font-semibold hover:bg-gray-100"
                      onClick={() => setOpenGroups((s) => toggle(s, g.group))}
                    >
                      <td className="px-4 py-2">
                        <span className="mr-1.5 inline-block w-3 text-gray-400">{open ? '▾' : '▸'}</span>
                        {GROUP_ICON[g.group] || ''} {g.group}
                      </td>
                      {g.cells.map((c, i) => (
                        <AmountCell key={i} cell={c} cls={table.cols[i]!.cls} bold />
                      ))}
                    </tr>
                    {open &&
                      g.props.map((p) => {
                        const pOpen = openProps.has(p.prop.id);
                        return (
                          <FragmentRows key={p.prop.id}>
                            <tr
                              className="cursor-pointer border-t border-gray-100 font-medium hover:bg-gray-50"
                              onClick={() => setOpenProps((s) => toggle(s, p.prop.id))}
                            >
                              <td className="py-1.5 pl-8 pr-4">
                                <span className="mr-1.5 inline-block w-3 text-gray-400">{pOpen ? '▾' : '▸'}</span>
                                🏠 {p.prop.name}
                              </td>
                              {p.cells.map((c, i) => (
                                <AmountCell key={i} cell={c} cls={table.cols[i]!.cls} />
                              ))}
                            </tr>
                            {pOpen &&
                              p.cats.map((r, i) => (
                                <FragmentRows key={r.cat}>
                                <tr
                                  className="cursor-pointer border-t border-gray-50 hover:bg-gray-50"
                                  data-testid={`prop-row-${p.prop.id}`}
                                  onClick={() => setOpenCats((s) => toggle(s, catKey(r.cat, p.prop.id)))}
                                >
                                  <td className="py-1.5 pl-16 pr-4 text-gray-700">
                                    {r.side && r.side !== p.cats[i - 1]?.side && (
                                      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                                        {r.side === 'income' ? 'Income' : 'Expenses'}
                                      </span>
                                    )}
                                    {r.cat}
                                  </td>
                                  {r.cells.map((c, i) => (
                                    <AmountCell key={i} cell={c} cls={table.cols[i]!.cls} />
                                  ))}
                                </tr>
                                {openCats.has(catKey(r.cat, p.prop.id)) && drillRow(r.cat, p.prop.id, 'pl-24')}
                                </FragmentRows>
                              ))}
                          </FragmentRows>
                        );
                      })}
                    {open &&
                      g.standalone.map((r) => {
                        const k = catKey(r.cat, null);
                        const cOpen = openCats.has(k);
                        return (
                          <FragmentRows key={r.cat}>
                            <tr
                              className="cursor-pointer border-t border-gray-50 hover:bg-gray-50"
                              onClick={() => setOpenCats((s) => toggle(s, k))}
                              data-testid="cat-row"
                            >
                              <td className="py-1.5 pl-12 pr-4 text-gray-700">
                                <span className="mr-1.5 inline-block w-3 text-gray-300">{cOpen ? '▾' : '▸'}</span>
                                {r.cat}
                              </td>
                              {r.cells.map((c, i) => (
                                <AmountCell key={i} cell={c} cls={table.cols[i]!.cls} />
                              ))}
                            </tr>
                            {cOpen && drillRow(r.cat, null, 'pl-20')}
                          </FragmentRows>
                        );
                      })}
                  </FragmentRows>
                );
              })}
              <tr className="border-t-2 border-gray-300 font-bold">
                <td className="px-4 py-2">Net total</td>
                {table.totals.map((v, i) => (
                  <AmountCell key={i} cell={{ v, note: '' }} cls={table.cols[i]!.cls} bold />
                ))}
              </tr>
            </tbody>
          </table>
          <div className="px-4 pb-3">
            <TransfersNote items={transfersLeftOut(filteredTxns, metricsCtx)} />
          </div>
        </div>
      )}
    </Card>
  );
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
