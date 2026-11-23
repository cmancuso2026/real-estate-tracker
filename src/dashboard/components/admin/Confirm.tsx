'use client';

import { useState } from 'react';

/** A dry-run preview from an /api/admin endpoint. */
export interface Preview {
  summary?: string;
  changes?: Record<string, number>;
  sample?: { description: string; from?: string; to?: string }[];
}

const LABELS: Record<string, string> = {
  transactions: 'Transactions',
  category_overrides: 'Saved category overrides',
  category_settings: 'Category rules',
  property_category_map: 'Property mappings',
  merchant_rules: 'Merchant rules',
  categories: 'Categories',
  queue_enter: 'Transactions entering the Needs-property queue',
  queue_leave: 'Transactions leaving the queue (their saved properties stay)',
  recategorized: 'Transactions recategorized',
  attributed: 'Transactions given a property',
  matched: 'Transactions matching the rule',
  updated: 'Transactions categorized',
  scanned: 'Uncategorized transactions checked',
  confirmed: 'Mappings confirmed',
};

interface Pending {
  title: string;
  preview: Preview;
  confirmLabel: string;
  danger: boolean;
  run: () => Promise<void>;
}

/**
 * Preview-then-confirm for destructive or bulk admin actions:
 *   const { ask, dialog } = useConfirm();
 *   ask({ title, preview: () => api(..., { dry_run: true }), run: () => api(...) })
 * The dialog shows the preview (summary + row counts) and runs only on Confirm.
 */
export function useConfirm() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(opts: {
    title: string;
    preview: () => Promise<Preview>;
    run: () => Promise<unknown>;
    confirmLabel?: string;
    danger?: boolean;
    onDone?: () => void | Promise<void>;
  }) {
    setError(null);
    try {
      const preview = await opts.preview();
      setPending({
        title: opts.title,
        preview,
        confirmLabel: opts.confirmLabel ?? 'Confirm',
        danger: !!opts.danger,
        run: async () => {
          await opts.run();
          await opts.onDone?.();
        },
      });
    } catch (err) {
      alertError(err);
    }
  }

  function alertError(err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    setPending({ title: 'Can’t do that', preview: { summary: msg }, confirmLabel: '', danger: false, run: async () => {} });
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await pending.run();
      setPending(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const changes = Object.entries(pending?.preview.changes ?? {});
  const dialog = pending && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="w-full max-w-lg space-y-4 rounded-xl bg-white p-5 shadow-xl" data-testid="confirm-dialog">
        <h2 id="confirm-title" className="text-lg font-semibold">
          {pending.title}
        </h2>
        {pending.preview.summary && <p className="text-sm text-gray-700">{pending.preview.summary}</p>}
        {changes.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">What will change</div>
            <table className="w-full text-sm" data-testid="confirm-changes">
              <tbody>
                {changes.map(([k, n]) => (
                  <tr key={k} className="border-t border-gray-100">
                    <td className="py-1.5 text-gray-600">{LABELS[k] ?? k}</td>
                    <td className="py-1.5 text-right font-semibold tabular">{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pending.preview.sample && pending.preview.sample.length > 0 && (
          <div className="max-h-40 overflow-auto rounded-lg bg-gray-50 p-2 text-xs">
            {pending.preview.sample.map((s, i) => (
              <div key={i} className="flex justify-between gap-3 py-0.5">
                <span className="truncate">{s.description}</span>
                <span className="shrink-0 text-gray-500">
                  {s.from ? `${s.from} → ` : '→ '}
                  {s.to}
                </span>
              </div>
            ))}
          </div>
        )}
        {error && (
          <div role="alert" className="text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            onClick={() => setPending(null)}
            disabled={busy}
          >
            {pending.confirmLabel ? 'Cancel' : 'Close'}
          </button>
          {pending.confirmLabel && (
            <button
              className={`rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${pending.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
              onClick={() => void confirm()}
              disabled={busy}
            >
              {busy ? 'Working…' : pending.confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return { ask, dialog, showError: alertError };
}
