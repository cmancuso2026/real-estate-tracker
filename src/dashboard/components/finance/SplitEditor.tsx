'use client';

import { useMemo, useState } from 'react';
import { btnPrimary, btnSecondary, selectCls } from './ui';
import { fmt } from '@/lib/finance-ui/format';
import type { PropertyOption, Txn } from '@/lib/finance-ui/types';

export type SplitMode = 'percent' | 'amount';
export interface SplitRow {
  property_id: string;
  unit_id: string;
  work_order_id: string;
  value: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
const usd = (n: number) => '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Percentages that add up to exactly 100 (the last row takes the remainder). */
export function evenPercents(n: number): number[] {
  const base = Math.floor((100 / n) * 1000) / 1000;
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? r3(100 - base * (n - 1)) : base));
}

/** Convert typed values between % and $ for a transaction amount; the last row absorbs rounding. */
export function convertValues(values: number[], from: SplitMode, total: number): string[] {
  const abs = Math.abs(total);
  if (from === 'percent') {
    let used = 0;
    return values.map((v, i) => {
      const last = i === values.length - 1;
      const d = last && values.every(Number.isFinite) && Math.abs(values.reduce((s, x) => s + x, 0) - 100) < 0.0005 ? r2(abs - used) : r2((abs * v) / 100);
      used = r2(used + d);
      return Number.isFinite(d) ? String(d) : '';
    });
  }
  let used = 0;
  return values.map((v, i) => {
    const last = i === values.length - 1;
    const p = last && values.every(Number.isFinite) && Math.round(values.reduce((s, x) => s + x, 0) * 100) === Math.round(abs * 100) ? r3(100 - used) : r3((v / abs) * 100);
    used = r3(used + p);
    return Number.isFinite(p) ? String(p) : '';
  });
}

/** What is left to allocate: percent points, or dollars (in cents precision). */
export function remainderOf(mode: SplitMode, rows: SplitRow[], total: number) {
  const values = rows.map((r) => num(r.value));
  if (mode === 'percent') {
    const left = r3(100 - values.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0));
    return { left, balanced: Math.abs(left) < 0.0005 };
  }
  const leftC = Math.round(Math.abs(total) * 100) - values.reduce((s, v) => s + (Number.isFinite(v) ? Math.round(Math.abs(v) * 100) : 0), 0);
  return { left: leftC / 100, balanced: leftC === 0 };
}

const emptyRow = (): SplitRow => ({ property_id: '', unit_id: '', work_order_id: '', value: '' });

/** Starting rows: the saved split as typed, else the current pick at 100% plus an empty row. */
export function initialSplit(txn: Txn, pick: { property_id: string; unit_id: string; work_order_id: string }): { mode: SplitMode; rows: SplitRow[] } {
  if (txn.allocations.length > 1 || (txn.allocations.length === 1 && !txn.fullyAllocated)) {
    const mode: SplitMode = txn.allocations[0]!.input_mode === 'amount' ? 'amount' : 'percent';
    return {
      mode,
      rows: txn.allocations.map((a) => ({
        property_id: String(a.property_id),
        unit_id: a.unit_id ? String(a.unit_id) : '',
        work_order_id: a.work_order_id ? String(a.work_order_id) : '',
        value: mode === 'amount' ? String(Math.abs(a.amount)) : String(a.percent ?? r3((a.amount / txn.amt) * 100)),
      })),
    };
  }
  return { mode: 'percent', rows: [{ ...pick, value: '100' }, emptyRow()] };
}

/**
 * Split one transaction across properties. Rows of property (+ unit / project)
 * and a value in % or $; Save stays disabled until the values balance.
 */
export function SplitEditor({
  txn,
  properties,
  projectsOn,
  initial,
  busy,
  onSave,
  onCancel,
  onSingle,
}: {
  txn: Txn;
  properties: PropertyOption[];
  projectsOn: boolean;
  initial: { mode: SplitMode; rows: SplitRow[] };
  busy: boolean;
  onSave: (mode: SplitMode, rows: SplitRow[]) => void;
  onCancel: () => void;
  onSingle: () => void;
}) {
  const [mode, setMode] = useState<SplitMode>(initial.mode);
  const [rows, setRows] = useState<SplitRow[]>(initial.rows);
  const rem = useMemo(() => remainderOf(mode, rows, txn.amt), [mode, rows, txn.amt]);
  const complete = rows.every((r) => r.property_id && Number.isFinite(num(r.value)) && num(r.value) > 0);
  const canSave = complete && rem.balanced && rows.length > 0;

  const set = (i: number, patch: Partial<SplitRow>) => setRows((cur) => cur.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  function switchMode(next: SplitMode) {
    if (next === mode) return;
    const converted = convertValues(rows.map((r) => num(r.value)), mode, txn.amt);
    setRows((cur) => cur.map((r, i) => ({ ...r, value: converted[i] ?? '' })));
    setMode(next);
  }

  function splitEvenly() {
    const n = rows.length;
    if (mode === 'percent') {
      const p = evenPercents(n);
      setRows((cur) => cur.map((r, i) => ({ ...r, value: String(p[i]) })));
    } else {
      const totalC = Math.round(Math.abs(txn.amt) * 100);
      const base = Math.floor(totalC / n);
      setRows((cur) => cur.map((r, i) => ({ ...r, value: String((i === n - 1 ? totalC - base * (n - 1) : base) / 100) })));
    }
  }

  const leftLabel =
    mode === 'percent'
      ? rem.balanced
        ? 'Balanced: 100%'
        : rem.left > 0
          ? `${rem.left}% left to allocate`
          : `${Math.abs(rem.left)}% too much`
      : rem.balanced
        ? `Balanced: ${usd(txn.amt)}`
        : rem.left > 0
          ? `${usd(rem.left)} left to allocate`
          : `${usd(rem.left)} too much`;

  return (
    <div className="space-y-2" data-testid="split-editor">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Split {fmt(txn.amt)} across properties</span>
        <div role="group" aria-label="Split by" className="inline-flex overflow-hidden rounded-lg border border-gray-300 text-xs font-medium">
          {(['percent', 'amount'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => switchMode(m)}
              className={`px-2.5 py-1 ${mode === m ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}
            >
              {m === 'percent' ? '%' : '$'}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        {rows.map((r, i) => {
          const prop = properties.find((p) => String(p.id) === r.property_id);
          return (
            <div key={i} className="flex flex-wrap items-center gap-2" data-testid="split-row">
              <select
                aria-label={`Property ${i + 1}`}
                className={selectCls}
                value={r.property_id}
                onChange={(e) => set(i, { property_id: e.target.value, unit_id: '', work_order_id: '' })}
              >
                <option value="">Choose a property…</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {prop && prop.units.length > 0 && (
                <select aria-label={`Unit ${i + 1}`} className={selectCls} value={r.unit_id} onChange={(e) => set(i, { unit_id: e.target.value })}>
                  <option value="">Whole property</option>
                  {prop.units.map((u) => (
                    <option key={u.id} value={u.id}>
                      Unit {u.label}
                    </option>
                  ))}
                </select>
              )}
              {prop && projectsOn && prop.projects.length > 0 && (
                <select aria-label={`Project ${i + 1}`} className={selectCls} value={r.work_order_id} onChange={(e) => set(i, { work_order_id: e.target.value })}>
                  <option value="">No project</option>
                  {prop.projects.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.status})
                    </option>
                  ))}
                </select>
              )}
              <label className="flex items-center gap-1 text-sm">
                {mode === 'amount' && <span className="text-gray-500">$</span>}
                <input
                  aria-label={`Share ${i + 1}`}
                  inputMode="decimal"
                  className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-right tabular"
                  value={r.value}
                  onChange={(e) => set(i, { value: e.target.value.replace(/[^0-9.]/g, '') })}
                />
                {mode === 'percent' && <span className="text-gray-500">%</span>}
              </label>
              {mode === 'percent' && Number.isFinite(num(r.value)) && (
                <span className="text-xs text-gray-400 tabular">{usd(Math.abs(txn.amt) * (num(r.value) / 100))}</span>
              )}
              {rows.length > 1 && (
                <button type="button" aria-label={`Remove row ${i + 1}`} className="text-xs text-gray-400 hover:text-red-600" onClick={() => setRows((cur) => cur.filter((_, k) => k !== i))}>
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <button type="button" className="font-medium text-blue-600 hover:underline" onClick={() => setRows((cur) => [...cur, emptyRow()])}>
          + Add property
        </button>
        <button type="button" className="font-medium text-blue-600 hover:underline" onClick={splitEvenly}>
          Split evenly
        </button>
        <span data-testid="split-remainder" className={`font-medium ${rem.balanced ? 'text-green-700' : 'text-orange-600'}`}>
          {leftLabel}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className={btnPrimary} disabled={!canSave || busy} onClick={() => onSave(mode, rows)}>
          {busy ? 'Saving…' : 'Save split'}
        </button>
        <button className={btnSecondary} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="text-xs text-gray-500 hover:underline" disabled={busy} onClick={onSingle}>
          One property instead
        </button>
      </div>
    </div>
  );
}
