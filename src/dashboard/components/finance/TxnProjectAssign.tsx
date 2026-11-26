'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { financeApi } from './api';
import { useFinance } from './FinanceData';
import { btnPrimary, btnSecondary, selectCls } from './ui';
import { attributionOf, type ApiTxn, type Txn } from '@/lib/finance-ui/types';

const K = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{children}</div>
);
const STATUS_DOT: Record<string, string> = { received: 'bg-gray-400', open: 'bg-blue-500', completed: 'bg-green-500' };

/** The link that opens a property's Projects tab with a new project started from this transaction. */
export function newProjectHref(propertyId: number, t: Pick<Txn, 'id' | 'desc' | 'amt' | 'date'>): string {
  const qs = new URLSearchParams({ tab: 'projects', newProject: '1', txn: String(t.id), name: t.desc.slice(0, 120), amt: String(t.amt), date: t.date });
  return `/properties/${propertyId}?${qs}`;
}

/**
 * "Project" section of a transaction's detail panel: shows the project(s) it's
 * on, and lets you pick one from a list or start a new one (which opens the
 * property's Projects tab with this transaction already selected).
 */
export function TxnProjectAssign({ t }: { t: Txn }) {
  const router = useRouter();
  const { propertyOptions, patchTxns, allowProjectTag } = useFinance();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [newProp, setNewProp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Properties this transaction is on; with none, every property is open to it.
  const onProps = useMemo(() => [...new Set(t.allocations.map((a) => a.property_id))], [t.allocations]);
  const current = t.allocations.filter((a) => a.work_order_id != null);
  const projectName = (id: number) => {
    for (const p of propertyOptions) {
      const w = p.projects.find((x) => x.id === id);
      if (w) return { project: w.name, property: p.name };
    }
    return { project: `Project #${id}`, property: '' };
  };
  const choices = propertyOptions
    .filter((p) => !onProps.length || onProps.includes(p.id))
    .map((p) => ({
      ...p,
      projects: p.projects.filter((w) => !search.trim() || w.name.toLowerCase().includes(search.trim().toLowerCase())),
    }))
    .filter((p) => p.projects.length > 0);
  const allowed = allowProjectTag(t.cat);

  async function call(fn: () => Promise<{ transactions?: ApiTxn[]; skipped?: { reason: string }[] }>) {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (r.skipped?.length) throw new Error(r.skipped[0]!.reason);
      const updated = r.transactions?.find((x) => x.id === t.id);
      if (updated) patchTxns([t.id], attributionOf(updated));
      setOpen(false);
      setSearch('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const assign = (projectId: number) =>
    call(() => financeApi.post(`/api/finance/projects/${projectId}/transactions`, { ids: [t.id] }));
  const unassign = (projectId: number) =>
    call(() => financeApi.del(`/api/finance/projects/${projectId}/transactions`, { ids: [t.id] }));
  const startNew = (propertyId: number) => router.push(newProjectHref(propertyId, t));

  return (
    <div data-testid="txn-project">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <K>🛠 Project</K>
        {!open && allowed && (
          <button className="rounded-full border border-blue-300 bg-white px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50" onClick={() => setOpen(true)}>
            {current.length ? 'Change project' : 'Assign to project'}
          </button>
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-2 text-sm">
        {current.length ? (
          current.map((a) => {
            const n = projectName(a.work_order_id!);
            return (
              <span key={`${a.property_id}-${a.work_order_id}`} className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-blue-800">
                <a href={`/properties/${a.property_id}?tab=projects&project=${a.work_order_id}`} className="font-medium hover:underline">{n.project}</a>
                {n.property && <span className="text-xs text-blue-600/70">{n.property}</span>}
                <button disabled={busy} onClick={() => void unassign(a.work_order_id!)} title="Take off this project" className="text-blue-400 hover:text-red-600">×</button>
              </span>
            );
          })
        ) : (
          <span className="text-gray-500">{allowed ? 'Not on a project.' : `Project tagging is off for ${t.cat} (Admin → Categories).`}</span>
        )}
      </div>

      {open && (
        <div className="mt-2 space-y-3 rounded-lg border border-blue-200 bg-white p-3" data-testid="txn-project-picker">
          <input
            aria-label="Search projects"
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects…"
            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
          />
          <div className="max-h-60 space-y-2 overflow-y-auto">
            {choices.map((p) => (
              <div key={p.id}>
                <div className="px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{p.name}</div>
                {p.projects.map((w) => {
                  const on = current.some((a) => a.work_order_id === w.id);
                  return (
                    <button
                      key={w.id}
                      disabled={busy || on}
                      onClick={() => void assign(w.id)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-blue-50 disabled:opacity-50"
                    >
                      <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[w.status] ?? 'bg-gray-300'}`} title={w.status} />
                      <span className="flex-1 truncate">{w.name}</span>
                      <span className="text-xs text-gray-400">{on ? 'current' : w.status}</span>
                    </button>
                  );
                })}
              </div>
            ))}
            {!choices.length && <p className="px-1 text-sm text-gray-400">{search ? 'No projects match.' : 'No projects on this property yet.'}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
            {onProps.length === 1 ? (
              <button className={btnPrimary} onClick={() => startNew(onProps[0]!)}>+ New project</button>
            ) : (
              <>
                <select aria-label="Property for the new project" className={selectCls} value={newProp} onChange={(e) => setNewProp(e.target.value)}>
                  <option value="">Property for the new project…</option>
                  {propertyOptions.filter((p) => !onProps.length || onProps.includes(p.id)).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <button className={btnPrimary} disabled={!newProp} onClick={() => startNew(Number(newProp))}>+ New project</button>
              </>
            )}
            <span className="text-xs text-gray-400">Opens the property&apos;s Projects tab to finish it, with this transaction linked.</span>
            <button className={`${btnSecondary} ml-auto`} onClick={() => { setOpen(false); setError(null); }}>Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
