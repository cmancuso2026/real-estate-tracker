'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

const UTILITIES = ['electric', 'gas', 'water', 'trash', 'sewer', 'internet'];
const EQUIPMENT = ['refrigerator', 'stove', 'dishwasher', 'washer', 'dryer', 'HVAC', 'microwave', 'A/C window unit'];

export default function NewLeasePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const propertyId = params.id as string;
  const tenantId = searchParams.get('tenantId') ?? '';
  const unitId = searchParams.get('unitId') ?? '';

  const [form, setForm] = useState({
    start_date: '',
    end_date: '',
    rent_amount: '',
    security_deposit: '',
    late_fee_amount: '',
    late_fee_grace_days: '5',
    utilities_landlord: [] as string[],
    utilities_tenant: [] as string[],
    equipment_included: [] as string[],
  });

  const [tenantName, setTenantName] = useState('');
  const [unitLabel, setUnitLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Also support picking tenant if not passed via query param
  const [allTenants, setAllTenants] = useState<Array<{ id: number; first_name: string; last_name: string; unit_id: number }>>([]);
  const [selectedTenantId, setSelectedTenantId] = useState(tenantId);
  const [selectedUnitId, setSelectedUnitId] = useState(unitId);

  useEffect(() => {
    // Load unit label for display
    if (unitId) {
      fetch(`/api/v2/units?propertyId=${propertyId}`)
        .then(r => r.json())
        .then((units: Array<{ id: number; unit_label: string }>) => {
          const u = units.find(u => String(u.id) === unitId);
          if (u) setUnitLabel(u.unit_label);
        });
    }

    // Load tenant name for display
    if (tenantId) {
      fetch(`/api/v2/tenants?propertyId=${propertyId}`)
        .then(r => r.json())
        .then((tenants: Array<{ id: number; first_name: string; last_name: string; unit_id: number }>) => {
          setAllTenants(tenants);
          const t = tenants.find(t => String(t.id) === tenantId);
          if (t) setTenantName(`${t.first_name} ${t.last_name}`);
        });
    } else {
      fetch(`/api/v2/tenants?propertyId=${propertyId}`)
        .then(r => r.json())
        .then(setAllTenants);
    }
  }, [propertyId, tenantId, unitId]);

  const toggleUtility = (type: 'landlord' | 'tenant', value: string) => {
    const key = type === 'landlord' ? 'utilities_landlord' : 'utilities_tenant';
    setForm(prev => ({
      ...prev,
      [key]: prev[key].includes(value)
        ? prev[key].filter(v => v !== value)
        : [...prev[key], value],
    }));
  };

  const toggleEquipment = (value: string) => {
    setForm(prev => ({
      ...prev,
      equipment_included: prev.equipment_included.includes(value)
        ? prev.equipment_included.filter(v => v !== value)
        : [...prev.equipment_included, value],
    }));
  };

  const save = async () => {
    const tid = selectedTenantId || tenantId;
    const uid = selectedUnitId || unitId;

    if (!tid || !uid || !form.start_date || !form.end_date || !form.rent_amount) {
      setError('Tenant, unit, dates, and rent amount are required.');
      return;
    }
    setSaving(true);
    setError('');

    const res = await fetch('/api/v2/leases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: parseInt(tid),
        unit_id: parseInt(uid),
        start_date: form.start_date,
        end_date: form.end_date,
        rent_amount: parseInt(form.rent_amount),
        security_deposit: form.security_deposit ? parseInt(form.security_deposit) : null,
        late_fee_amount: form.late_fee_amount ? parseInt(form.late_fee_amount) : null,
        late_fee_grace_days: form.late_fee_grace_days ? parseInt(form.late_fee_grace_days) : null,
        utilities_landlord: form.utilities_landlord,
        utilities_tenant: form.utilities_tenant,
        equipment_included: form.equipment_included,
        extracted_by_ai: false,
      }),
    });

    if (!res.ok) { setError('Failed to save lease.'); setSaving(false); return; }
    router.push(`/properties/${propertyId}?tab=leases`);
  };

  return (
    <>
      <div className="mb-6">
        <Link href={`/properties/${propertyId}?tab=leases`} className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">
          ← Back to Property
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Add Lease</h1>
        {(tenantName || unitLabel) && (
          <p className="text-sm text-gray-500">
            {tenantName && <span>{tenantName}</span>}
            {unitLabel && <span> · Unit {unitLabel}</span>}
          </p>
        )}
      </div>

      <div className="max-w-2xl space-y-6">

        {/* Tenant selector (if not pre-filled) */}
        {!tenantId && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
            <h2 className="mb-4 font-semibold">Tenant</h2>
            <select
              value={selectedTenantId}
              onChange={e => setSelectedTenantId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
            >
              <option value="">Select tenant…</option>
              {allTenants.map(t => (
                <option key={t.id} value={t.id}>{t.first_name} {t.last_name}</option>
              ))}
            </select>
            <Link href={`/properties/${propertyId}/tenants/new`} className="mt-2 inline-block text-xs text-blue-600 hover:underline dark:text-blue-400">
              + Add new tenant first
            </Link>
          </div>
        )}

        {/* Term & Financials */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-4 font-semibold">Term & Rent</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Lease Start *</label>
                <input
                  type="date"
                  value={form.start_date}
                  onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Lease End *</label>
                <input
                  type="date"
                  value={form.end_date}
                  onChange={e => setForm(p => ({ ...p, end_date: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Monthly Rent ($) *</label>
                <input
                  type="number"
                  value={form.rent_amount}
                  onChange={e => setForm(p => ({ ...p, rent_amount: e.target.value }))}
                  placeholder="1500"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Security Deposit ($)</label>
                <input
                  type="number"
                  value={form.security_deposit}
                  onChange={e => setForm(p => ({ ...p, security_deposit: e.target.value }))}
                  placeholder="1500"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Late Fee ($)</label>
                <input
                  type="number"
                  value={form.late_fee_amount}
                  onChange={e => setForm(p => ({ ...p, late_fee_amount: e.target.value }))}
                  placeholder="75"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Grace Period (days)</label>
                <input
                  type="number"
                  value={form.late_fee_grace_days}
                  onChange={e => setForm(p => ({ ...p, late_fee_grace_days: e.target.value }))}
                  placeholder="5"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Utilities */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-4 font-semibold">Utilities</h2>
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-medium text-gray-500">Landlord pays</p>
              <div className="flex flex-wrap gap-2">
                {UTILITIES.map(u => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => toggleUtility('landlord', u)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      form.utilities_landlord.includes(u)
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400'
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-gray-500">Tenant pays</p>
              <div className="flex flex-wrap gap-2">
                {UTILITIES.map(u => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => toggleUtility('tenant', u)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      form.utilities_tenant.includes(u)
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400'
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Equipment */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-4 font-semibold">Equipment Included</h2>
          <div className="flex flex-wrap gap-2">
            {EQUIPMENT.map(e => (
              <button
                key={e}
                type="button"
                onClick={() => toggleEquipment(e)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  form.equipment_included.includes(e)
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400'
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

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
            {saving ? 'Saving…' : 'Save Lease'}
          </button>
          <Link
            href={`/properties/${propertyId}?tab=leases`}
            className="rounded-lg border border-gray-300 px-6 py-2.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            Cancel
          </Link>
        </div>
      </div>
    </>
  );
}
