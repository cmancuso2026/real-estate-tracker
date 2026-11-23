'use client';

import { Fragment, useEffect, useState } from 'react';
import { financeApi } from '@/components/finance/api';

interface Entry {
  id: number;
  action: string;
  summary: string | null;
  before: unknown;
  after: unknown;
  at: string;
}

export default function AdminChangeLogPage() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    financeApi
      .get<{ entries: Entry[] }>('/api/admin/audit?limit=500')
      .then((r) => setEntries(r.entries))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">Change log</h2>
        <p className="mt-1 text-sm text-gray-500">Every change made in Admin, newest first. Click a row for before and after.</p>
      </div>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full text-sm" data-testid="change-log">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-2 text-left font-medium">When</th>
              <th className="px-2 py-2 text-left font-medium">Action</th>
              <th className="px-4 py-2 text-left font-medium">What changed</th>
            </tr>
          </thead>
          <tbody>
            {(entries ?? []).map((e) => (
              <Fragment key={e.id}>
                <tr className="cursor-pointer border-t border-gray-100 hover:bg-gray-50" onClick={() => setOpen(open === e.id ? null : e.id)}>
                  <td className="whitespace-nowrap px-4 py-2 text-gray-600">{new Date(e.at).toLocaleString()}</td>
                  <td className="px-2 py-2">
                    <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">{e.action}</code>
                  </td>
                  <td className="px-4 py-2">{e.summary}</td>
                </tr>
                {open === e.id && (
                  <tr className="bg-gray-50">
                    <td />
                    <td colSpan={2} className="px-4 pb-3">
                      <div className="grid gap-3 text-xs md:grid-cols-2">
                        <div>
                          <div className="mb-1 font-semibold text-gray-500">Before</div>
                          <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-white p-2">{JSON.stringify(e.before, null, 2) ?? '—'}</pre>
                        </div>
                        <div>
                          <div className="mb-1 font-semibold text-gray-500">After</div>
                          <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-white p-2">{JSON.stringify(e.after, null, 2) ?? '—'}</pre>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {entries && entries.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-gray-400">
                  No changes yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
