'use client';

import { useCallback, useEffect, useState } from 'react';
import { financeApi } from '@/components/finance/api';
import { Card, btnPrimary, btnSecondary, selectCls } from '@/components/finance/ui';
import { fmt, shortDate } from '@/lib/finance-ui/format';

interface NeedsUnitRow {
  id: number;
  date: string;
  description: string;
  amount: number;
  category: string;
  property: string | null;
  reason: string;
}
interface UnitOption {
  unit_id: number;
  unit_label: string;
  lease_id: number | null;
  rent_amount: number | null;
  tenant: string | null;
}

/** Rent payments the upload couldn't match to a unit; pick one to record it in Rent. */
export function RentNeedsUnit() {
  const [items, setItems] = useState<NeedsUnitRow[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [unitId, setUnitId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await financeApi.get<{ items: NeedsUnitRow[] }>('/api/finance/rent/needs-unit')).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function pick(id: number) {
    setOpen(id);
    setUnitId('');
    setUnits([]);
    setError(null);
    try {
      const r = await financeApi.get<{ units: UnitOption[] }>(`/api/finance/transactions/${id}/rent`);
      setUnits(r.units);
      if (r.units.length === 1) setUnitId(String(r.units[0]!.unit_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function save(row: NeedsUnitRow) {
    const u = units.find((x) => String(x.unit_id) === unitId);
    if (!u) return;
    setBusy(true);
    setError(null);
    try {
      await financeApi.put(`/api/finance/transactions/${row.id}/rent`, { unit_id: u.unit_id, lease_id: u.lease_id });
      setNotice(`Recorded ${fmt(row.amount)} on unit ${u.unit_label}.`);
      setOpen(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!items || items.length === 0) return null;
  return (
    <Card className="scroll-mt-4 space-y-3" id="rent" data-testid="rent-needs-unit">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Rent needs a unit</h2>
        <span className="text-sm text-gray-500" data-testid="rent-needs-unit-count">
          {items.length} waiting
        </span>
      </div>
      <p className="text-sm text-gray-500">
        Rent payments that couldn&apos;t be matched to a unit by tenant name, category or lease amount. Pick the unit and
        the payment is recorded in that unit&apos;s rent history.
      </p>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {notice && (
        <div role="status" className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {notice}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-gray-400">
            <tr>
              <th className="py-1.5 pr-3">Date</th>
              <th className="py-1.5 pr-3">Description</th>
              <th className="py-1.5 pr-3">Property</th>
              <th className="py-1.5 pr-3 text-right">Amount</th>
              <th className="py-1.5" />
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-t border-gray-100 align-top" data-testid="rent-needs-unit-row">
                <td className="whitespace-nowrap py-2 pr-3 text-gray-500">{shortDate(r.date)}</td>
                <td className="py-2 pr-3">
                  <div>{r.description}</div>
                  <div className="text-xs text-gray-400">{r.reason}</div>
                </td>
                <td className="py-2 pr-3 text-gray-600">{r.property ?? r.category}</td>
                <td className="py-2 pr-3 text-right font-medium tabular text-green-700">{fmt(r.amount)}</td>
                <td className="py-2 text-right">
                  {open === r.id ? (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <select aria-label="Unit" className={selectCls} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                        <option value="">Choose unit…</option>
                        {units.map((u) => (
                          <option key={u.unit_id} value={u.unit_id}>
                            Unit {u.unit_label}
                            {u.tenant ? ` · ${u.tenant}` : ''}
                            {u.rent_amount != null ? ` · ${fmt(u.rent_amount)}/mo` : ' · no lease'}
                          </option>
                        ))}
                      </select>
                      <button className={btnPrimary} disabled={!unitId || busy} onClick={() => void save(r)}>
                        Save
                      </button>
                      <button className={btnSecondary} onClick={() => setOpen(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button className={btnSecondary} onClick={() => void pick(r.id)}>
                      Pick unit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
