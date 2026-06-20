'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface Unit { id: number; unit_label: string; }

export default function NewTenantPage() {
  const params = useParams();
  const router = useRouter();
  const propertyId = params.id as string;

  const [units, setUnits] = useState<Unit[]>([]);
  const [form, setForm] = useState({
    unit_id: '',
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/v2/units?propertyId=${propertyId}`)
      .then(r => r.json())
      .then(setUnits);
  }, [propertyId]);

  const save = async () => {
    if (!form.unit_id || !form.first_name || !form.last_name) {
      setError('Unit, first name, and last name are required.');
      return;
    }
    setSaving(true);
    setError('');

    const res = await fetch('/api/v2/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unit_id: parseInt(form.unit_id),
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email || null,
        phone: form.phone || null,
        payment_method: 'zelle',
        is_active: true,
        notes: form.notes || null,
      }),
    });

    if (!res.ok) { setError('Failed to save tenant.'); setSaving(false); return; }
    const tenant = await res.json();

    // Go straight to add lease for this tenant
    router.push(`/properties/${propertyId}/leases/new?tenantId=${tenant.id}&unitId=${form.unit_id}`);
  };

  return (
    <>
      <div className="mb-6">
        <Link href={`/properties/${propertyId}?tab=overview`} className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">
          ← Back to Property
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Add Tenant</h1>
      </div>

      <div className="max-w-lg space-y-6">
        <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-4 font-semibold">Tenant Info</h2>
          <div className="space-y-4">

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Unit *</label>
              <select
                value={form.unit_id}
                onChange={e => setForm(p => ({ ...p, unit_id: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
              >
                <option value="">Select a unit…</option>
                {units.map(u => (
                  <option key={u.id} value={u.id}>Unit {u.unit_label}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">First Name *</label>
                <input
                  type="text"
                  value={form.first_name}
                  onChange={e => setForm(p => ({ ...p, first_name: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Last Name *</label>
                <input
                  type="text"
                  value={form.last_name}
                  onChange={e => setForm(p => ({ ...p, last_name: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Phone</label>
              <input
                type="tel"
                value={form.phone}
                onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                placeholder="(305) 555-0100"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Notes</label>
              <textarea
                value={form.notes}
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                rows={2}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
              />
            </div>
          </div>
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400">
          After saving, you'll be taken straight to add a lease for this tenant.
        </p>

        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save & Add Lease →'}
          </button>
          <Link
            href={`/properties/${propertyId}?tab=overview`}
            className="rounded-lg border border-gray-300 px-6 py-2.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            Cancel
          </Link>
        </div>
      </div>
    </>
  );
}
