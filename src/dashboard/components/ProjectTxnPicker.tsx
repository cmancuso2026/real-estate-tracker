'use client';

import { useEffect, useMemo, useState } from 'react';

export interface CandidateTxn {
  id: number;
  date: string;
  description: string;
  amount: number | string;
  category: string;
  source: string;
  group?: string;
  on_property?: boolean;
}
interface Facets { years: string[]; sources: string[]; groups: { name: string; categories: string[] }[] }

const money = (n: number | string) => {
  const v = Number(n);
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const day = (d: string) => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const sel = 'rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs';

/**
 * A small version of Finance → Transactions for linking transactions to a
 * project: the same filters (year, month, group, category, source, search)
 * plus which ones to show (no property yet / on this property). Rows on
 * another project or only on other properties never appear. `selected` keeps
 * the ticked ids across filter changes.
 */
export function ProjectTxnPicker({
  propertyId,
  projectId,
  selected,
  onChange,
  preload = [],
}: {
  propertyId: string | number;
  projectId?: number;
  selected: number[];
  onChange: (ids: number[]) => void;
  /** Transactions to show even if the filters would hide them (e.g. the one a project started from). */
  preload?: CandidateTxn[];
}) {
  const [f, setF] = useState({ year: '', month: '', group: '', category: '', source: '', scope: 'available', search: '' });
  const [rows, setRows] = useState<CandidateTxn[]>([]);
  const [matched, setMatched] = useState(0);
  const [facets, setFacets] = useState<Facets>({ years: [], sources: [], groups: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [known, setKnown] = useState<Record<number, CandidateTxn>>(() => Object.fromEntries(preload.map((t) => [t.id, t])));
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({ propertyId: String(propertyId), limit: '200', scope: f.scope });
        if (projectId) qs.set('projectId', String(projectId));
        if (f.year) qs.set('year', f.year);
        if (f.year && f.month) qs.set('months', f.month);
        for (const k of ['group', 'category', 'source'] as const) if (f[k]) qs.set(k, f[k]);
        if (f.search.trim()) qs.set('search', f.search.trim());
        const res = await fetch(`/api/finance/projects/candidates?${qs}`);
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(data.error ?? 'Could not load transactions');
        setRows(data.transactions ?? []);
        setMatched(data.matched ?? 0);
        setFacets(data.facets ?? { years: [], sources: [], groups: [] });
        setKnown((k) => ({ ...k, ...Object.fromEntries((data.transactions as CandidateTxn[]).map((x) => [x.id, x])) }));
        setError(null);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [propertyId, projectId, f]);

  const toggle = (id: number) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const allShown = rows.length > 0 && rows.every((r) => selected.includes(r.id));
  const toggleAll = () => onChange(allShown ? selected.filter((id) => !rows.some((r) => r.id === id)) : [...new Set([...selected, ...rows.map((r) => r.id)])]);
  // Ticked rows the filters hide still show (at the top) so you can see / untick them.
  const hiddenPicked = selected.filter((id) => !rows.some((r) => r.id === id)).map((id) => known[id]).filter((x): x is CandidateTxn => !!x);
  const total = selected.reduce((s, id) => s + Number(known[id]?.amount ?? 0), 0);
  const cats = useMemo(
    () => (f.group ? facets.groups.find((g) => g.name === f.group)?.categories ?? [] : facets.groups.flatMap((g) => g.categories).sort()),
    [facets, f.group],
  );
  const filtered = Object.entries(f).some(([k, v]) => (k === 'scope' ? v !== 'available' : !!v));

  // A render function, not a component: a component declared inside this one
  // would remount every row on each render.
  const row = (t: CandidateTxn, faded = false, key: string | number = t.id) => (
    <tr key={key} className={`cursor-pointer hover:bg-gray-50 ${selected.includes(t.id) ? 'bg-blue-50/60' : ''} ${faded ? 'opacity-70' : ''}`} onClick={() => toggle(t.id)} data-testid={`txn-candidate-${t.id}`}>
      <td className="px-2 py-1.5"><input type="checkbox" aria-label={`Select ${t.description}`} checked={selected.includes(t.id)} onChange={() => toggle(t.id)} onClick={(e) => e.stopPropagation()} /></td>
      <td className="whitespace-nowrap px-2 py-1.5 text-gray-500">{day(t.date)}</td>
      <td className="max-w-[16rem] truncate px-2 py-1.5" title={t.description}>{t.description}</td>
      <td className="hidden whitespace-nowrap px-2 py-1.5 text-gray-500 md:table-cell">{t.source}</td>
      <td className="hidden px-2 py-1.5 lg:table-cell"><span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">{t.group ?? '—'}</span></td>
      <td className="whitespace-nowrap px-2 py-1.5 text-gray-600">{t.category}</td>
      <td className="whitespace-nowrap px-2 py-1.5">
        {t.on_property === false ? <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">no property yet</span> : t.on_property ? <span className="text-[11px] text-gray-400">this property</span> : null}
      </td>
      <td className={`whitespace-nowrap px-2 py-1.5 text-right tabular ${Number(t.amount) < 0 ? 'text-red-600' : 'text-green-700'}`}>{money(t.amount)}</td>
    </tr>
  );

  return (
    <div className="rounded-lg border border-gray-200 bg-white" data-testid="txn-picker">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 p-2">
        <select aria-label="Year" className={sel} value={f.year} onChange={(e) => set({ year: e.target.value, month: e.target.value ? f.month : '' })}>
          <option value="">All years</option>
          {facets.years.map((y) => <option key={y}>{y}</option>)}
        </select>
        <select aria-label="Month" className={sel} value={f.month} disabled={!f.year} title={f.year ? undefined : 'Pick a year first'} onChange={(e) => set({ month: e.target.value })}>
          <option value="">All months</option>
          {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
        </select>
        <select aria-label="Group" className={sel} value={f.group} onChange={(e) => set({ group: e.target.value, category: '' })}>
          <option value="">All groups</option>
          {facets.groups.map((g) => <option key={g.name}>{g.name}</option>)}
        </select>
        <select aria-label="Category" className={sel} value={f.category} onChange={(e) => set({ category: e.target.value })}>
          <option value="">All categories</option>
          {cats.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select aria-label="Source" className={sel} value={f.source} onChange={(e) => set({ source: e.target.value })}>
          <option value="">All sources</option>
          {facets.sources.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select aria-label="Show" className={sel} value={f.scope} onChange={(e) => set({ scope: e.target.value })}>
          <option value="available">No property yet + this property</option>
          <option value="unassigned">No property yet</option>
          <option value="property">On this property</option>
        </select>
        <input aria-label="Search transactions" value={f.search} onChange={(e) => set({ search: e.target.value })} placeholder="Search…" className={`${sel} min-w-[8rem] flex-1`} />
        {filtered && <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => setF({ year: '', month: '', group: '', category: '', source: '', scope: 'available', search: '' })}>Clear</button>}
      </div>
      <div className="max-h-80 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-2 py-1.5 text-left"><input type="checkbox" aria-label="Select all shown" checked={allShown} onChange={toggleAll} disabled={!rows.length} /></th>
              <th className="px-2 py-1.5 text-left font-medium">Date</th>
              <th className="px-2 py-1.5 text-left font-medium">Description</th>
              <th className="hidden px-2 py-1.5 text-left font-medium md:table-cell">Source</th>
              <th className="hidden px-2 py-1.5 text-left font-medium lg:table-cell">Group</th>
              <th className="px-2 py-1.5 text-left font-medium">Category</th>
              <th className="px-2 py-1.5 text-left font-medium">Property</th>
              <th className="px-2 py-1.5 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {hiddenPicked.map((t) => row(t, true, `p${t.id}`))}
            {rows.map((t) => row(t))}
          </tbody>
        </table>
        {!loading && !rows.length && !hiddenPicked.length && (
          <p className="px-3 py-4 text-center text-xs text-gray-400">{error ?? 'No transactions match these filters.'}</p>
        )}
        {loading && <p className="px-3 py-2 text-center text-xs text-gray-400">Loading…</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-3 py-1.5 text-[11px] text-gray-500">
        <span data-testid="txn-picked-summary">
          <strong className="text-gray-700">{selected.length} selected</strong>{selected.length ? ` · ${money(total)}` : ''}
          {' · '}showing {rows.length}{matched > rows.length ? ` of ${matched}` : ''}
        </span>
        <span className="text-gray-400">Linking one with no property puts it on this property. Ones on another project or another property aren’t listed.</span>
      </div>
    </div>
  );
}
