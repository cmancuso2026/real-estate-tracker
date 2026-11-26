'use client';

import { useEffect, useState } from 'react';

export interface CandidateTxn {
  id: number;
  date: string;
  description: string;
  amount: number | string;
  category: string;
  source: string;
  on_property?: boolean;
}

const money = (n: number | string) => {
  const v = Number(n);
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const day = (d: string) => new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });

/**
 * Pick existing finance transactions to link to a project: ones with no
 * property yet or already on this property, and not on another project.
 * `selected` holds the picked ids (kept across searches).
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
  /** Transactions to show even if the search would hide them (e.g. the one a project started from). */
  preload?: CandidateTxn[];
}) {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<CandidateTxn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [known, setKnown] = useState<Record<number, CandidateTxn>>(() => Object.fromEntries(preload.map((t) => [t.id, t])));

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({ propertyId: String(propertyId), limit: '100' });
        if (search.trim()) qs.set('search', search.trim());
        if (projectId) qs.set('projectId', String(projectId));
        const res = await fetch(`/api/finance/projects/candidates?${qs}`);
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(data.error ?? 'Could not load transactions');
        const list: CandidateTxn[] = data.transactions ?? [];
        setRows(list);
        setKnown((k) => ({ ...k, ...Object.fromEntries(list.map((x) => [x.id, x])) }));
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
  }, [propertyId, projectId, search]);

  const toggle = (id: number) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  // Picked rows stay at the top, even when the search no longer matches them.
  const picked = selected.map((id) => known[id]).filter((x): x is CandidateTxn => !!x);
  const others = rows.filter((r) => !selected.includes(r.id));
  const total = picked.reduce((s, t) => s + Number(t.amount), 0);

  const Row = ({ t }: { t: CandidateTxn }) => (
    <label className="flex cursor-pointer items-center gap-3 px-3 py-1.5 text-xs hover:bg-gray-50" data-testid={`txn-candidate-${t.id}`}>
      <input type="checkbox" checked={selected.includes(t.id)} onChange={() => toggle(t.id)} />
      <span className="w-16 shrink-0 text-gray-500">{day(t.date)}</span>
      <span className="min-w-0 flex-1 truncate" title={t.description}>
        {t.description}
      </span>
      <span className="hidden shrink-0 text-gray-400 sm:inline">{t.category}</span>
      {t.on_property === false && <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">no property yet</span>}
      <span className={`w-24 shrink-0 text-right tabular ${Number(t.amount) < 0 ? 'text-red-600' : 'text-green-700'}`}>{money(t.amount)}</span>
    </label>
  );

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 p-2">
        <input
          aria-label="Search transactions"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search transactions (e.g. Home Depot)…"
          className="min-w-[12rem] flex-1 rounded-lg border border-gray-300 px-2 py-1 text-sm"
        />
        <span className="text-xs text-gray-500" data-testid="txn-picked-summary">
          {selected.length} selected{selected.length ? ` · ${money(total)}` : ''}
        </span>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {picked.length > 0 && <div className="divide-y divide-gray-50 bg-blue-50/40">{picked.map((t) => <Row key={t.id} t={t} />)}</div>}
        <div className="divide-y divide-gray-50">{others.map((t) => <Row key={t.id} t={t} />)}</div>
        {!loading && !others.length && !picked.length && (
          <p className="px-3 py-4 text-center text-xs text-gray-400">{error ?? 'No matching transactions on this property or without one.'}</p>
        )}
        {loading && <p className="px-3 py-2 text-center text-xs text-gray-400">Loading…</p>}
      </div>
      <p className="border-t border-gray-100 px-3 py-1.5 text-[11px] text-gray-400">
        Showing transactions with no property yet or already on this property. Linking one with no property assigns it to this property.
      </p>
    </div>
  );
}
