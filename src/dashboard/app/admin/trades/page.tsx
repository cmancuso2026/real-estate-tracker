'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Trade } from '@/lib/trades';

const card = 'rounded-xl border border-gray-200 bg-white shadow-sm';
const input = 'rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm';
const btn = 'rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40';

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

/**
 * Admin → Trades: the list behind vendor trades and project categories
 * (plumbing, roof, handyman, …). Renaming changes only the label; vendors and
 * projects keep pointing at the same trade. Archived trades leave the pickers
 * but stay on vendors and projects that already use them.
 */
export default function AdminTradesPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTrades(await send('/api/v2/trades?all=1', 'GET'));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const visible = trades.filter((t) => showArchived || !t.archived);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">Trades</h2>
        <p className="mt-1 text-sm text-gray-500">
          The trades you pick for vendors and the categories you give projects (Electrical, Plumbing, Roof…). The order here is the
          order in every picker. Renaming keeps every vendor and project on it; archive a trade to hide it from pickers without
          touching history.
        </p>
      </div>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className={`${card} flex flex-wrap items-end gap-3 p-4`}>
        <label className="text-xs text-gray-500">
          New trade
          <input
            aria-label="New trade name"
            className={`${input} mt-1 block w-56`}
            value={newLabel}
            placeholder="e.g. Pool Service"
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newLabel.trim()) void act(async () => { await send('/api/v2/trades', 'POST', { label: newLabel }); setNewLabel(''); });
            }}
          />
        </label>
        <button
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          disabled={!newLabel.trim()}
          onClick={() => void act(async () => { await send('/api/v2/trades', 'POST', { label: newLabel }); setNewLabel(''); })}
        >
          Add trade
        </button>
        <label className="ml-auto flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
        </label>
      </div>

      <section className={card}>
        <table className="min-w-full text-sm" data-testid="trades-table">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-2 text-left font-medium">Trade</th>
              <th className="px-2 py-2 text-right font-medium">Vendors</th>
              <th className="px-2 py-2 text-right font-medium">Projects</th>
              <th className="px-4 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t, i) => {
              const used = (t.vendor_count ?? 0) + (t.project_count ?? 0);
              return (
                <tr key={t.key} className={`border-t border-gray-100 ${t.archived ? 'bg-gray-50 text-gray-400' : ''}`} data-testid={`trade-${t.key}`}>
                  <td className="px-4 py-2">
                    {editing?.key === t.key ? (
                      <span className="flex items-center gap-2">
                        <input aria-label="Trade name" className={input} value={editing.value} autoFocus onChange={(e) => setEditing({ ...editing, value: e.target.value })} />
                        <button className={btn} disabled={!editing.value.trim()} onClick={() => void act(async () => { await send(`/api/v2/trades/${t.key}`, 'PATCH', { label: editing.value }); setEditing(null); })}>
                          Save
                        </button>
                        <button className={btn} onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <span>
                        {t.label}
                        {t.archived && <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">archived</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular">{t.vendor_count ?? 0}</td>
                  <td className="px-2 py-2 text-right tabular">{t.project_count ?? 0}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    <span className="inline-flex flex-wrap justify-end gap-1">
                      <button className={btn} title="Move up" disabled={i === 0} onClick={() => void act(() => send(`/api/v2/trades/${t.key}`, 'PATCH', { direction: 'up' }))}>
                        ↑
                      </button>
                      <button className={btn} title="Move down" disabled={i === visible.length - 1} onClick={() => void act(() => send(`/api/v2/trades/${t.key}`, 'PATCH', { direction: 'down' }))}>
                        ↓
                      </button>
                      <button className={btn} onClick={() => setEditing({ key: t.key, value: t.label })}>
                        Rename
                      </button>
                      <button className={btn} onClick={() => void act(() => send(`/api/v2/trades/${t.key}`, 'PATCH', { archived: !t.archived }))}>
                        {t.archived ? 'Restore' : 'Archive'}
                      </button>
                      <button
                        className={`${btn} text-red-600`}
                        disabled={used > 0}
                        title={used ? 'In use: archive it instead' : 'Delete'}
                        onClick={() => {
                          if (confirm(`Delete “${t.label}”?`)) void act(() => send(`/api/v2/trades/${t.key}`, 'DELETE'));
                        }}
                      >
                        Delete
                      </button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
