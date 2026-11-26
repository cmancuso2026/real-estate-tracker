'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TradePills } from './TradePicker';
import { useTrades } from '@/lib/useTrades';
import { describeRecurring } from '@/lib/recurring';
import { projectRows, type OverviewProject, type ProjectRow } from '@/lib/projects-overview';

const STATUSES = ['received', 'open', 'completed'] as const;
const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const money = (n: number | null | undefined) => (n == null ? '—' : '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 }));
const day = (s: string | null) => (s ? new Date(s.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—');

interface Column {
  key: string;
  label: string;
  /** Shown before you change anything. */
  base?: boolean;
  align?: 'right';
  sort?: (r: ProjectRow) => string | number | null;
  total?: (rows: ProjectRow[]) => string;
  cell: (r: ProjectRow, ctx: { label: (k: string) => string; rate: (r: ProjectRow, n: number | null) => void }) => React.ReactNode;
}

const sum = (rows: ProjectRow[], f: (r: ProjectRow) => number | null) => rows.reduce((s, r) => s + (f(r) ?? 0), 0);

const COLUMNS: Column[] = [
  { key: 'project', label: 'Project', base: true, sort: (r) => r.name.toLowerCase(), cell: (r) => (
    <Link href={`/properties/${r.propertyId}?tab=projects&project=${r.id}`} className="font-medium text-blue-700 hover:underline">{r.name}</Link>
  ) },
  { key: 'property', label: 'Property', base: true, sort: (r) => r.property, cell: (r) => <span className="text-gray-600">{r.property}</span> },
  { key: 'trades', label: 'Categories', base: true, cell: (r, c) => <TradePills keys={r.trades} label={c.label} /> },
  { key: 'status', label: 'Status', base: true, sort: (r) => r.status, cell: (r) => (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.status === 'completed' ? 'bg-green-100 text-green-700' : r.status === 'open' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{cap(r.status)}</span>
  ) },
  { key: 'vendor', label: 'Vendor', base: true, sort: (r) => r.vendor ?? '', cell: (r) => r.vendor ?? <span className="text-gray-300">—</span> },
  { key: 'quoted', label: 'Quoted', base: true, align: 'right', sort: (r) => r.quoted, total: (rows) => money(sum(rows, (r) => r.quoted)), cell: (r) => money(r.quoted) },
  { key: 'actual', label: 'Actual', base: true, align: 'right', sort: (r) => r.actual, total: (rows) => money(sum(rows, (r) => r.actual)), cell: (r) => (r.txnCount ? money(r.actual) : <span className="text-gray-300">—</span>) },
  { key: 'rating', label: 'My rating', base: true, sort: (r) => r.rating ?? 0, cell: (r, c) => (
    <span className="inline-flex" role="radiogroup" aria-label={`My rating for ${r.name}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={r.rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`}
          onClick={() => c.rate(r, r.rating === n ? null : n)}
          className={`text-base leading-none ${r.rating && n <= r.rating ? 'text-amber-500' : 'text-gray-300 hover:text-amber-300'}`}>★</button>
      ))}
    </span>
  ) },
  { key: 'variance', label: 'Over / under', align: 'right', sort: (r) => r.variance, cell: (r) => r.variance == null ? <span className="text-gray-300">—</span> : (
    <span className={r.variance > 0 ? 'text-red-600' : 'text-green-700'}>{r.variance > 0 ? '+' : '−'}{money(Math.abs(r.variance))}</span>
  ) },
  { key: 'final', label: 'Final cost', align: 'right', sort: (r) => r.final, total: (rows) => money(sum(rows, (r) => r.final)), cell: (r) => money(r.final) },
  { key: 'txns', label: 'Transactions', align: 'right', sort: (r) => r.txnCount, total: (rows) => String(sum(rows, (r) => r.txnCount)), cell: (r) => (
    r.txnCount ? <Link href={`/finance/transactions?project=${r.id}`} className="text-blue-600 hover:underline">{r.txnCount}</Link> : <span className="text-gray-300">0</span>
  ) },
  { key: 'description', label: 'Description', cell: (r) => <span className="line-clamp-2 max-w-xs text-xs text-gray-500" title={r.description ?? ''}>{r.description ?? '—'}</span> },
  { key: 'units', label: 'Units', cell: (r) => (r.units.length ? r.units.join(', ') : <span className="text-gray-300">—</span>) },
  { key: 'phone', label: 'Contact number', cell: (r) => (r.vendorPhone ? <a href={`tel:${r.vendorPhone}`} className="text-blue-600 hover:underline">{r.vendorPhone}</a> : <span className="text-gray-300">—</span>) },
  { key: 'email', label: 'Vendor email', cell: (r) => (r.vendorEmail ? <a href={`mailto:${r.vendorEmail}`} className="text-blue-600 hover:underline">{r.vendorEmail}</a> : <span className="text-gray-300">—</span>) },
  { key: 'vendorRating', label: 'Vendor rating', sort: (r) => r.vendorRating ?? 0, cell: (r) => (r.vendorRating ? <span className="text-amber-500">{'★'.repeat(r.vendorRating)}</span> : <span className="text-gray-300">—</span>) },
  { key: 'quotes', label: 'Quotes', align: 'right', sort: (r) => r.quoteCount, cell: (r) => r.quoteCount },
  { key: 'recurring', label: 'Recurring', cell: (r) => (r.recurring.length ? <span className="text-xs">{r.recurring.map((x) => describeRecurring(x)).join('; ')}</span> : <span className="text-gray-300">—</span>) },
  { key: 'created', label: 'Created', sort: (r) => r.created ?? '', cell: (r) => day(r.created) },
  { key: 'completed', label: 'Completed', sort: (r) => r.completed ?? '', cell: (r) => day(r.completed) },
];
const BASE = COLUMNS.filter((c) => c.base).map((c) => c.key);
const STORE = 'projects-overview-columns';

/**
 * Every project across properties, with slicers (category, status, property,
 * search), a gear menu to choose the columns, sortable headers and totals.
 */
export function ProjectsOverview() {
  const { trades, label } = useTrades();
  const [projects, setProjects] = useState<OverviewProject[] | null>(null);
  const [actuals, setActuals] = useState<Record<number, { actual_spend: number; transaction_count: number }>>({});
  const [error, setError] = useState<string | null>(null);
  const [tradeSel, setTradeSel] = useState<string[]>([]);
  const [statusSel, setStatusSel] = useState<string[]>([]);
  const [property, setProperty] = useState('');
  const [search, setSearch] = useState('');
  const [cols, setCols] = useState<string[]>(BASE);
  const [gearOpen, setGearOpen] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'created', dir: -1 });
  const gearRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null');
      if (Array.isArray(saved) && saved.length) setCols(saved.filter((k) => COLUMNS.some((c) => c.key === k)));
    } catch { /* not remembered */ }
  }, []);
  const saveCols = (next: string[]) => {
    setCols(next);
    try { localStorage.setItem(STORE, JSON.stringify(next)); } catch { /* not remembered */ }
  };
  useEffect(() => {
    if (!gearOpen) return;
    const close = (e: MouseEvent) => { if (!gearRef.current?.contains(e.target as Node)) setGearOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [gearOpen]);

  const load = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([
        fetch('/api/v2/work-orders').then((r) => (r.ok ? r.json() : Promise.reject(new Error('Could not load projects')))),
        fetch('/api/finance/rollups/projects').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      setProjects(Array.isArray(p) ? p : []);
      setActuals(a?.projects ?? {});
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProjects([]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => projectRows(projects ?? [], actuals), [projects, actuals]);
  const properties = useMemo(() => [...new Map(rows.map((r) => [r.propertyId, r.property])).entries()], [rows]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const col = COLUMNS.find((c) => c.key === sort.key);
    const out = rows.filter((r) =>
      (!tradeSel.length || r.trades.some((t) => tradeSel.includes(t))) &&
      (!statusSel.length || statusSel.includes(r.status)) &&
      (!property || String(r.propertyId) === property) &&
      (!q || [r.name, r.description, r.vendor, r.property].some((x) => x?.toLowerCase().includes(q))));
    if (col?.sort) {
      out.sort((a, b) => {
        const x = col.sort!(a), y = col.sort!(b);
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
      });
    }
    return out;
  }, [rows, tradeSel, statusSel, property, search, sort]);
  const shown = COLUMNS.filter((c) => cols.includes(c.key));
  const tradeCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) for (const t of r.trades) m[t] = (m[t] ?? 0) + 1;
    return m;
  }, [rows]);

  async function rate(r: ProjectRow, n: number | null) {
    setProjects((ps) => (ps ?? []).map((p) => (p.id === r.id ? { ...p, rating: n } : p)));
    await fetch(`/api/v2/work-orders/${r.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating: n }) });
  }
  const toggle = (list: string[], set: (v: string[]) => void, k: string) => set(list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);
  const chip = (on: boolean) => `rounded-full px-3 py-1 text-xs font-medium transition-colors ${on ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`;

  if (projects === null) return <div className="py-12 text-center text-gray-400">Loading projects…</div>;

  return (
    <div className="space-y-4" data-testid="projects-overview">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by category">
          <span className="w-20 text-xs font-medium text-gray-500">Category</span>
          <button className={chip(!tradeSel.length)} onClick={() => setTradeSel([])}>All</button>
          {trades.filter((t) => tradeCounts[t.key]).map((t) => (
            <button key={t.key} aria-pressed={tradeSel.includes(t.key)} className={chip(tradeSel.includes(t.key))} onClick={() => toggle(tradeSel, setTradeSel, t.key)}>
              {t.label} <span className="opacity-60">{tradeCounts[t.key]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
          <span className="w-20 text-xs font-medium text-gray-500">Status</span>
          <button className={chip(!statusSel.length)} onClick={() => setStatusSel([])}>All</button>
          {STATUSES.map((s) => (
            <button key={s} aria-pressed={statusSel.includes(s)} className={chip(statusSel.includes(s))} onClick={() => toggle(statusSel, setStatusSel, s)}>{cap(s)}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-20 text-xs font-medium text-gray-500">Property</span>
          <select aria-label="Filter by property" value={property} onChange={(e) => setProperty(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1 text-sm">
            <option value="">All properties</option>
            {properties.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <input aria-label="Search projects" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search project, vendor…" className="min-w-[12rem] flex-1 rounded-lg border border-gray-300 px-3 py-1 text-sm" />
          <div className="relative" ref={gearRef}>
            <button aria-label="Choose columns" aria-expanded={gearOpen} title="Choose columns" onClick={() => setGearOpen((v) => !v)}
              className="rounded-lg border border-gray-300 px-2.5 py-1 text-base leading-none text-gray-600 hover:bg-gray-50">⚙</button>
            {gearOpen && (
              <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-gray-200 bg-white p-2 shadow-lg" role="menu" data-testid="column-menu">
                <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Columns</p>
                {COLUMNS.map((c) => (
                  <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-gray-50">
                    <input type="checkbox" checked={cols.includes(c.key)} disabled={c.key === 'project'}
                      onChange={() => saveCols(cols.includes(c.key) ? cols.filter((k) => k !== c.key) : COLUMNS.map((x) => x.key).filter((k) => k === c.key || cols.includes(k)))} />
                    {c.label}
                  </label>
                ))}
                <button onClick={() => saveCols(BASE)} className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-blue-600 hover:bg-gray-50">Reset to default</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm" data-testid="projects-table">
          <thead className="bg-gray-50">
            <tr>
              {shown.map((c) => (
                <th key={c.key} className={`whitespace-nowrap px-4 py-2.5 text-xs font-medium text-gray-500 ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                  {c.sort ? (
                    <button onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : c.align === 'right' ? -1 : 1 }))} className="hover:text-gray-900">
                      {c.label}{sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                    </button>
                  ) : c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50" data-testid={`overview-project-${r.id}`}>
                {shown.map((c) => (
                  <td key={c.key} className={`px-4 py-2.5 align-top ${c.align === 'right' ? 'text-right tabular' : ''}`}>{c.cell(r, { label, rate })}</td>
                ))}
              </tr>
            ))}
            {!filtered.length && (
              <tr><td colSpan={shown.length} className="px-4 py-10 text-center text-sm text-gray-400">{rows.length ? 'No projects match these filters.' : 'No projects yet. Create them from a property’s Projects tab.'}</td></tr>
            )}
          </tbody>
          {filtered.length > 0 && (
            <tfoot className="border-t-2 border-gray-200 bg-gray-50 text-sm font-semibold">
              <tr>
                {shown.map((c, i) => (
                  <td key={c.key} className={`px-4 py-2.5 ${c.align === 'right' ? 'text-right tabular' : ''}`}>
                    {i === 0 ? `${filtered.length} project${filtered.length === 1 ? '' : 's'}` : c.total ? c.total(filtered) : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
