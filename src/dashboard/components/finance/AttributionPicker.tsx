'use client';

import { useEffect, useState } from 'react';
import { financeApi } from './api';
import { useFinance } from './FinanceData';
import { btnPrimary, btnSecondary, selectCls } from './ui';
import { SplitEditor, initialSplit, type SplitMode, type SplitRow } from './SplitEditor';
import { fmt } from '@/lib/finance-ui/format';
import { attributionOf, type ApiTxn, type Txn } from '@/lib/finance-ui/types';

interface Suggestion {
  property_id: number;
  unit_id: number | null;
  work_order_id: number | null;
  source: 'rule' | 'vendor' | 'address' | 'default' | 'history';
  reason: string;
}

const NEW_PROJECT = 'new';

/**
 * Inline property / unit / project picker for one transaction.
 * - `category` set: the user picked a category that requires a property; Save
 *   changes the category and the attribution together (the category can't be
 *   saved without a property).
 * - otherwise: edit the transaction's attribution.
 * The best suggestion is pre-filled but nothing is saved until Save. "Split"
 * opens the split editor to divide the amount across several properties.
 */
export function AttributionPicker({
  txn,
  category,
  onSaved,
  onCancel,
}: {
  txn: Txn;
  category?: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { propertyOptions, allowProjectTag, requiresProperty, patchTxns, reloadPropertyOptions } = useFinance();
  const targetCat = category ?? txn.cat;
  const [propertyId, setPropertyId] = useState<string>(txn.propertyId ? String(txn.propertyId) : '');
  const [unitId, setUnitId] = useState<string>(txn.unitId ? String(txn.unitId) : '');
  const [projectId, setProjectId] = useState<string>(txn.workOrderId ? String(txn.workOrderId) : '');
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSplit = txn.allocations.length > 1 || (txn.allocations.length > 0 && !txn.fullyAllocated);
  const [splitting, setSplitting] = useState(isSplit);

  // Pre-fill the best suggestion when the row has no attribution yet.
  useEffect(() => {
    let alive = true;
    financeApi
      .get<{ suggestions: Suggestion[] }>(`/api/finance/transactions/${txn.id}/suggestions`)
      .then(({ suggestions }) => {
        if (!alive || !suggestions.length) return;
        const s = suggestions[0]!;
        setSuggestion(s);
        if (!txn.propertyId && txn.allocations.length === 0) {
          setPropertyId(String(s.property_id));
          setUnitId(s.unit_id ? String(s.unit_id) : '');
          setProjectId(s.work_order_id ? String(s.work_order_id) : '');
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [txn.id, txn.propertyId]);

  const prop = propertyOptions.find((p) => String(p.id) === propertyId);
  const projectsOn = allowProjectTag(targetCat);
  const required = requiresProperty(targetCat);

  async function save() {
    if (!propertyId) return;
    setBusy(true);
    setError(null);
    const attr = {
      property_id: Number(propertyId),
      unit_id: unitId ? Number(unitId) : null,
      work_order_id: projectId && projectId !== NEW_PROJECT ? Number(projectId) : null,
    };
    try {
      let updated: ApiTxn;
      if (category !== undefined && category !== txn.cat) {
        updated = await financeApi.put<ApiTxn>(`/api/finance/transactions/${txn.id}/category`, { category, ...attr });
      } else {
        updated = await financeApi.patch<ApiTxn>(`/api/finance/transactions/${txn.id}/attribution`, attr);
      }
      if (projectId === NEW_PROJECT) {
        const r = await financeApi.post<{ transaction: ApiTxn }>(`/api/finance/transactions/${txn.id}/project`, {
          property_id: attr.property_id,
          unit_id: attr.unit_id,
        });
        updated = r.transaction;
        await reloadPropertyOptions();
      }
      patchTxns([txn.id], { cat: updated.category, manual: updated.is_manual, ...attributionOf(updated) });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setError(null);
    try {
      const updated = await financeApi.patch<ApiTxn>(`/api/finance/transactions/${txn.id}/attribution`, { property_id: null });
      patchTxns([txn.id], attributionOf(updated));
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Save a split: the allocations first, then (if one is pending) the category,
  // which a required category only accepts once the row is fully allocated.
  async function saveSplit(mode: SplitMode, rows: SplitRow[]) {
    setBusy(true);
    setError(null);
    try {
      let updated = await financeApi.put<ApiTxn>(`/api/finance/transactions/${txn.id}/allocations`, {
        mode,
        rows: rows.map((r) => ({
          property_id: Number(r.property_id),
          unit_id: r.unit_id ? Number(r.unit_id) : null,
          work_order_id: r.work_order_id ? Number(r.work_order_id) : null,
          value: Number(r.value),
        })),
      });
      if (category !== undefined && category !== txn.cat) {
        updated = await financeApi.put<ApiTxn>(`/api/finance/transactions/${txn.id}/category`, { category });
      }
      patchTxns([txn.id], { cat: updated.category, manual: updated.is_manual, ...attributionOf(updated) });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function clearSplit() {
    setBusy(true);
    setError(null);
    try {
      const updated = await financeApi.put<ApiTxn>(`/api/finance/transactions/${txn.id}/allocations`, { rows: [] });
      patchTxns([txn.id], attributionOf(updated));
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/60 p-3"
      onClick={(e) => e.stopPropagation()}
      data-testid="attribution-picker"
    >
      <div className="text-sm">
        {category !== undefined && category !== txn.cat ? (
          <>
            <strong>{category}</strong> needs a property. Pick one to save the category for{' '}
          </>
        ) : (
          <>Property for </>
        )}
        <span className="text-gray-700">
          {txn.desc} · <span className="tabular">{fmt(txn.amt)}</span>
        </span>
      </div>
      {suggestion && (
        <div className="text-xs text-blue-800" data-testid="suggestion">
          💡 Suggested: {suggestion.reason}
        </div>
      )}
      {splitting ? (
        <SplitEditor
          txn={txn}
          properties={propertyOptions}
          projectsOn={projectsOn}
          initial={initialSplit(txn, { property_id: propertyId, unit_id: unitId, work_order_id: projectId === NEW_PROJECT ? '' : projectId })}
          busy={busy}
          onSave={(mode, rows) => void saveSplit(mode, rows)}
          onCancel={onCancel}
          onSingle={() => setSplitting(false)}
        />
      ) : (
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Property"
          className={selectCls}
          value={propertyId}
          onChange={(e) => {
            setPropertyId(e.target.value);
            setUnitId('');
            setProjectId('');
          }}
        >
          <option value="">Choose a property…</option>
          {propertyOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {prop && prop.units.length > 0 && (
          <select aria-label="Unit" className={selectCls} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">Whole property</option>
            {prop.units.map((u) => (
              <option key={u.id} value={u.id}>
                Unit {u.label}
              </option>
            ))}
          </select>
        )}
        {prop && projectsOn && (
          <select aria-label="Project" className={selectCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">No project</option>
            {prop.projects.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.status})
              </option>
            ))}
            <option value={NEW_PROJECT}>+ New project from this transaction</option>
          </select>
        )}
        <button className={btnPrimary} disabled={!propertyId || busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button className={btnSecondary} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={btnSecondary} disabled={busy} onClick={() => setSplitting(true)} data-testid="split-button">
          Split
        </button>
        {category === undefined && txn.propertyId && !required && (
          <button className="text-xs text-red-600 hover:underline" disabled={busy} onClick={() => void clear()}>
            Remove property
          </button>
        )}
      </div>
      )}
      {splitting && category === undefined && txn.allocations.length > 0 && !required && (
        <button className="text-xs text-red-600 hover:underline" disabled={busy} onClick={() => void clearSplit()}>
          Remove all properties
        </button>
      )}
      {!splitting && projectId === NEW_PROJECT && (
        <div className="text-xs text-gray-600">
          Creates an open project named “{txn.desc}” with a starting cost of ${Math.round(Math.abs(txn.amt)).toLocaleString()}, and links
          this transaction to it.
        </div>
      )}
      {error && (
        <div role="alert" className="text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
