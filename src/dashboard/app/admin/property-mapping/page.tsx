'use client';

import { useCallback, useEffect, useState } from 'react';
import { financeApi } from '@/components/finance/api';
import { useConfirm } from '@/components/admin/Confirm';

interface Mapping {
  category: string;
  property_id: number | null;
  role: string;
  confirmed: boolean;
  address: string | null;
}
interface Unmapped {
  category: string;
  group: string;
  dismissed: boolean;
}
interface Data {
  mappings: Mapping[];
  unmapped: Unmapped[];
  properties: { id: number; address: string }[];
  roles: string[];
  categories: string[];
}

const ROLE_LABEL: Record<string, string> = { income: 'Rent / income', piti: 'PITI / mortgage / loan', expense: 'Expense' };
const input = 'rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm';
const btn = 'rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40';

export default function AdminPropertyMappingPage() {
  const [data, setData] = useState<Data | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { property_id: string; role: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [any, setAny] = useState({ category: '', property_id: '', role: 'expense' });
  const { ask, dialog, showError } = useConfirm();

  const load = useCallback(async () => {
    try {
      setData(await financeApi.get<Data>('/api/admin/property-map'));
      setDrafts({});
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const draftOf = (m: { category: string; property_id: number | null; role?: string }) =>
    drafts[m.category] ?? { property_id: m.property_id != null ? String(m.property_id) : '', role: m.role ?? 'income' };
  async function save(category: string, d: { property_id: string; role: string }) {
    try {
      await financeApi.put('/api/admin/property-map', {
        category,
        property_id: d.property_id ? Number(d.property_id) : null,
        role: d.role,
        confirmed: true,
      });
      await load();
    } catch (err) {
      showError(err);
    }
  }
  const unconfirmed = (data?.mappings ?? []).filter((m) => m.property_id != null && !m.confirmed).length;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">Property mapping</h2>
        <p className="mt-1 text-sm text-gray-500">
          Which per-property categories belong to which property. The Overview&apos;s cash flow per property and the Spending page&apos;s property
          rows use these. Rent adds to a property&apos;s cash flow; PITI and expenses subtract.
        </p>
      </div>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {data && (
        <section className="rounded-xl border border-gray-200 bg-white p-4" data-testid="map-any">
          <h3 className="font-semibold">Map any category to a property</h3>
          <p className="mt-0.5 text-sm text-gray-500">
            For categories without a street number in the name, like a loan (Figure Lending) or an HOA. Its transactions then sit
            under that property on the Categories page and count in its cash flow.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select aria-label="Any category" className={input} value={any.category} onChange={(e) => setAny({ ...any, category: e.target.value })}>
              <option value="">Choose category…</option>
              {data.categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select aria-label="Any property" className={input} value={any.property_id} onChange={(e) => setAny({ ...any, property_id: e.target.value })}>
              <option value="">Choose property…</option>
              {data.properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.address}
                </option>
              ))}
            </select>
            <select aria-label="Any role" className={input} value={any.role} onChange={(e) => setAny({ ...any, role: e.target.value })}>
              {data.roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r] ?? r}
                </option>
              ))}
            </select>
            <button
              className={btn}
              disabled={!any.category || !any.property_id}
              onClick={async () => {
                await save(any.category, { property_id: any.property_id, role: any.role });
                setAny({ category: '', property_id: '', role: 'expense' });
              }}
            >
              Map
            </button>
          </div>
        </section>
      )}

      {data && data.unmapped.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4" data-testid="unmapped">
          <h3 className="font-semibold text-amber-900">Unmapped categories ({data.unmapped.length})</h3>
          <p className="mb-3 text-sm text-amber-900/80">
            These look per-property (a street number, or Rent/PITI in the name) but aren&apos;t mapped, so they don&apos;t count toward any property.
          </p>
          <div className="space-y-2">
            {data.unmapped.map((u) => {
              const d = draftOf({ category: u.category, property_id: null, role: undefined });
              return (
                <div key={u.category} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-40 font-medium">{u.category}</span>
                  <select aria-label={`Property for ${u.category}`} className={input} value={d.property_id} onChange={(e) => setDrafts({ ...drafts, [u.category]: { ...d, property_id: e.target.value } })}>
                    <option value="">Choose property…</option>
                    {data.properties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.address}
                      </option>
                    ))}
                  </select>
                  <select aria-label={`Role for ${u.category}`} className={input} value={d.role} onChange={(e) => setDrafts({ ...drafts, [u.category]: { ...d, role: e.target.value } })}>
                    {data.roles.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r] ?? r}
                      </option>
                    ))}
                  </select>
                  <button className={btn} disabled={!d.property_id} onClick={() => void save(u.category, d)}>
                    Map
                  </button>
                  {!u.dismissed && (
                    <button className={`${btn} text-gray-500`} onClick={() => void save(u.category, { property_id: '', role: d.role })}>
                      Not a property category
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
          <h3 className="font-semibold">Mappings</h3>
          <button
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            disabled={!unconfirmed}
            onClick={() =>
              void ask({
                title: 'Confirm all proposed mappings?',
                preview: async () => ({ summary: 'Marks every proposed mapping as reviewed.', changes: { confirmed: unconfirmed } }),
                run: () => financeApi.put('/api/admin/property-map', { confirm_all: true }),
                onDone: load,
              })
            }
          >
            Confirm all ({unconfirmed})
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm" data-testid="mappings">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-gray-400">
                <th className="px-4 py-2 text-left font-medium">Category</th>
                <th className="px-2 py-2 text-left font-medium">Property</th>
                <th className="px-2 py-2 text-left font-medium">Role</th>
                <th className="px-2 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {(data?.mappings ?? []).map((m) => {
                const d = draftOf(m);
                const dirty = d.property_id !== (m.property_id != null ? String(m.property_id) : '') || d.role !== m.role;
                return (
                  <tr key={m.category} className="border-t border-gray-100" data-testid={`mapping-${m.category}`}>
                    <td className="px-4 py-2 font-medium">{m.category}</td>
                    <td className="px-2 py-2">
                      <select aria-label={`Property for ${m.category}`} className={input} value={d.property_id} onChange={(e) => setDrafts({ ...drafts, [m.category]: { ...d, property_id: e.target.value } })}>
                        <option value="">Not mapped</option>
                        {data!.properties.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.address}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <select aria-label={`Role for ${m.category}`} className={input} value={d.role} onChange={(e) => setDrafts({ ...drafts, [m.category]: { ...d, role: e.target.value } })}>
                        {data!.roles.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r] ?? r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {m.property_id == null ? (
                        <span className="text-gray-400">not a property category</span>
                      ) : m.confirmed ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-700">confirmed</span>
                      ) : (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 font-medium text-blue-700">proposed</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button className={btn} disabled={!dirty && m.confirmed} onClick={() => void save(m.category, d)}>
                        {dirty ? 'Save' : 'Confirm'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {dialog}
    </div>
  );
}
