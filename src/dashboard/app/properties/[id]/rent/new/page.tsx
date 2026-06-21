'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface Unit { id: number; unit_label: string; tenant_name: string | null; rent_amount: number | null; }
interface Lease { id: number; rent_amount: number; start_date: string; end_date: string; }

export default function AddPaymentPage() {
  const params = useParams();
  const router = useRouter();
  const propertyId = params.id as string;

  const [units, setUnits] = useState<Unit[]>([]);
  const [leases, setLeases] = useState<Record<number, Lease>>({});
  const [form, setForm] = useState({
    unit_id: '',
    due_date: new Date().toISOString().slice(0, 7) + '-01',
    amount_due: '',
    paid_date: new Date().toISOString().slice(0, 10),
    amount_paid: '',
    is_late: false,
    late_fee_charged: '',
    late_fee_paid: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/v2/units?propertyId=${propertyId}`)
      .then(r => r.json())
      .then((us: Unit[]) => {
        setUnits(us);
        if (us.length === 1 && us[0]) {
          setForm(p => ({ ...p, unit_id: String(us[0]!.id), amount_due: String(us[0]!.rent_amount ?? '') }));
        }
      });
  }, [propertyId]);

  // Auto-fill amount_due when unit changes
  async function handleUnitChange(unitId: string) {
    setForm(p => ({ ...p, unit_id: unitId }));
    if (!unitId) return;
    const unit = units.find(u => String(u.id) === unitId);
    if (unit?.rent_amount) setForm(p => ({ ...p, amount_due: String(unit.rent_amount) }));

    // Get active lease
    const res = await fetch(`/api/v2/leases?unitId=${unitId}`);
    const ls: Lease[] = await res.json();
    const active = ls[0];
    if (active) {
      setLeases(prev => ({ ...prev, [parseInt(unitId)]: active }));
      setForm(p => ({ ...p, amount_due: String(active.rent_amount) }));
    }
  }

  // Auto-detect late based on paid date vs due date
  function checkLate(paidDate: string, dueDate: string) {
    if (!paidDate || !dueDate) return false;
    const grace = 5; // default grace days
    const paid = new Date(paidDate);
    const due = new Date(dueDate);
    return Math.ceil((paid.getTime() - due.getTime()) / 86400000) > grace;
  }

  async function save() {
    if (!form.unit_id || !form.due_date || !form.amount_due) {
      setError('Unit, due date, and amount due are required.');
      return;
    }
    setSaving(true); setError('');

    const unitId = parseInt(form.unit_id);
    const lease = leases[unitId];
    const amountPaid = form.amount_paid ? parseFloat(form.amount_paid) : null;
    const amountDue = parseFloat(form.amount_due);
    const isPartial = amountPaid !== null && amountPaid < amountDue;
    const isLate = form.is_late || checkLate(form.paid_date, form.due_date);

    const res = await fetch('/api/v2/rent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unit_id: unitId,
        lease_id: lease?.id ?? null,
        due_date: form.due_date,
        amount_due: amountDue,
        paid_date: form.paid_date || null,
        amount_paid: amountPaid,
        is_partial: isPartial,
        is_late: isLate,
        late_fee_charged: form.late_fee_charged ? parseInt(form.late_fee_charged) : null,
        late_fee_paid: form.late_fee_paid ? parseInt(form.late_fee_paid) : null,
        notes: form.notes || null,
        source: 'manual',
      }),
    });

    if (!res.ok) { setError('Failed to save payment.'); setSaving(false); return; }
    router.push(`/properties/${propertyId}?tab=rent`);
  }

  const isLateAuto = checkLate(form.paid_date, form.due_date);

  return (
    <>
      <div className="mb-6">
        <Link href={`/properties/${propertyId}?tab=rent`} className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">← Back to Rent</Link>
        <h1 className="mt-1 text-2xl font-bold">Add Rent Payment</h1>
      </div>

      <div className="max-w-lg space-y-5">
        <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-4 dark:border-gray-800 dark:bg-gray-900">

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Unit *</label>
            <select value={form.unit_id} onChange={e => handleUnitChange(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800">
              <option value="">Select unit…</option>
              {units.filter(u => !u.hasOwnProperty('is_owner_unit')).map(u => (
                <option key={u.id} value={u.id}>
                  Unit {u.unit_label}{u.tenant_name ? ` — ${u.tenant_name}` : ' (vacant)'}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Due Date (Month) *</label>
              <input type="month" value={form.due_date.slice(0, 7)}
                onChange={e => setForm(p => ({ ...p, due_date: e.target.value + '-01' }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Amount Due ($) *</label>
              <input type="number" value={form.amount_due} onChange={e => setForm(p => ({ ...p, amount_due: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Date Paid</label>
              <input type="date" value={form.paid_date} onChange={e => setForm(p => ({ ...p, paid_date: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Amount Paid ($)</label>
              <input type="number" value={form.amount_paid} onChange={e => setForm(p => ({ ...p, amount_paid: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800" />
            </div>
          </div>

          {/* Late detection */}
          {isLateAuto && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/20 dark:text-amber-400">
              ⚠ This payment appears to be late (paid after grace period). Late fee fields enabled below.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Late Fee Charged ($)</label>
              <input type="number" value={form.late_fee_charged} onChange={e => setForm(p => ({ ...p, late_fee_charged: e.target.value }))}
                placeholder="0"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Late Fee Paid ($)</label>
              <input type="number" value={form.late_fee_paid} onChange={e => setForm(p => ({ ...p, late_fee_paid: e.target.value }))}
                placeholder="0"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800" />
          </div>
        </div>

        {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">{error}</p>}

        <div className="flex gap-3">
          <button onClick={save} disabled={saving}
            className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Payment'}
          </button>
          <Link href={`/properties/${propertyId}?tab=rent`}
            className="rounded-lg border border-gray-300 px-6 py-2.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
            Cancel
          </Link>
        </div>
      </div>
    </>
  );
}
