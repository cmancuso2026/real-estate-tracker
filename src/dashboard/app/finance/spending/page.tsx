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
  const { txns, tax, props, selYears, selMonths } = useFinance();
  const [view, setView] = useState<CatView>('monthly');
  const [compare, setCompare] = useState('');
  // Groups and properties start collapsed (as on the old page).
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [openProps, setOpenProps] = useState<Set<number>>(new Set());

  const table = useMemo(
    () => buildCategoryTable(txns, selYears, selMonths, tax, props, view, compare),
    [txns, selYears, selMonths, tax, props, view, compare],
  );
  const options = useMemo(() => compareOptions(txns), [txns]);
  useEffect(() => {
    if (compare && !options.some((o) => o.value === compare)) setCompare('');
  }, [options, compare]);

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
          onClick={() => setOpenGroups(allCollapsed ? new Set(groupNames) : new Set())}
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
                              p.cats.map((r) => (
                                <tr key={r.cat} className="border-t border-gray-50">
                                  <td className="py-1.5 pl-16 pr-4 text-gray-700">{r.cat}</td>
                                  {r.cells.map((c, i) => (
                                    <AmountCell key={i} cell={c} cls={table.cols[i]!.cls} />
                                  ))}
                                </tr>
                              ))}
                          </FragmentRows>
                        );
                      })}
                    {open &&
                      g.standalone.map((r) => (
                        <tr key={r.cat} className="border-t border-gray-50">
                          <td className="py-1.5 pl-12 pr-4 text-gray-700">{r.cat}</td>
                          {r.cells.map((c, i) => (
                            <AmountCell key={i} cell={c} cls={table.cols[i]!.cls} />
                          ))}
                        </tr>
                      ))}
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
        </div>
      )}
    </Card>
  );
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
