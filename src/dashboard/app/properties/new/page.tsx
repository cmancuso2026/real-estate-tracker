'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface UnitEntry { label: string; bedrooms: string; bathrooms: string; sqft: string; }

export default function NewPropertyPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    address: '', city: 'Miami', state: 'FL', zip_code: '',
    property_type: 'duplex', notes: '',
  });
  const [units, setUnits] = useState<UnitEntry[]>([
    { label: '', bedrooms: '', bathrooms: '', sqft: '' },
    { label: '', bedrooms: '', bathrooms: '', sqft: '' },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const updateUnit = (i: number, field: keyof UnitEntry, value: string) => {
    setUnits(prev => prev.map((u, idx) => idx === i ? { ...u, [field]: value } : u));
  };

  const addUnit = () => setUnits(prev => [...prev, { label: '', bedrooms: '', bathrooms: '', sqft: '' }]);
  const removeUnit = (i: number) => setUnits(prev => prev.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!form.address || !form.zip_code) { setError('Address and zip code are required.'); return; }
    if (units.some(u => !u.label)) { setError('All units need a label (e.g. 1205, 1207).'); return; }
    setSaving(true);
    setError('');

    // 1. Create property
    const propRes = await fetch('/api/v2/properties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        unit_count: units.length,
      }),
    });
    if (!propRes.ok) { setError('Failed to create property.'); setSaving(false); return; }
    const property = await propRes.json();

    // 2. Create each unit
    for (const u of units) {
      await fetch('/api/v2/units', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: property.id,
          unit_label: u.label,
          bedrooms: u.bedrooms ? parseInt(u.bedrooms) : null,
          bathrooms: u.bathrooms ? parseFloat(u.bathrooms) : null,
          sqft: u.sqft ? parseInt(u.sqft) : null,
        }),
      });
    }

    router.push(`/properties/${property.id}`);
  };

  return (
    <>
      <div className="mb-6">
        <Link href="/properties" className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">
          ← My Properties
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Add Property</h1>
      </div>

      <div className="max-w-2xl space-y-6">

        {/* Property Info */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-4 font-semibold">Property Info</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Street Address *</label>
              <input
                type="text"
                placeholder="e.g. 20-22 NW 119th St"
                value={form.address}
                onChange={e => setForm(p => ({ ...p, address: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-1">
                <label className="mb-1 block text-xs font-medium text-gray-500">City</label>
                <input
                  type="text"
                  value={form.city}
                  onChange={e => setForm(p => ({ ...p, city: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">State</label>
                <input
                  type="text"
                  value={form.state}
                  onChange={e => setForm(p => ({ ...p, state: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Zip *</label>
                <input
                  type="text"
                  value={form.zip_code}
                  onChange={e => setForm(p => ({ ...p, zip_code: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Property Type</label>
              <select
                value={form.property_type}
                onChange={e => setForm(p => ({ ...p, property_type: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
              >
                {['duplex','sfh','triplex','quad','other'].map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
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

        {/* Units */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Units</h2>
            <button
              onClick={addUnit}
              className="text-sm text-blue-600 hover:underline dark:text-blue-400"
            >
              + Add unit
            </button>
          </div>
          <p className="mb-4 text-xs text-gray-500">
            Use the street number as the unit label — e.g. for 1205-1207 NE 117th St, label the units <strong>1205</strong> and <strong>1207</strong>.
          </p>
          <div className="space-y-3">
            {units.map((u, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-3">
                  {i === 0 && <label className="mb-1 block text-xs text-gray-500">Unit # *</label>}
                  <input
                    type="text"
                    placeholder="e.g. 1205"
                    value={u.label}
                    onChange={e => updateUnit(i, 'label', e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
                  />
                </div>
                <div className="col-span-2">
                  {i === 0 && <label className="mb-1 block text-xs text-gray-500">Beds</label>}
                  <input
                    type="number"
                    placeholder="3"
                    value={u.bedrooms}
                    onChange={e => updateUnit(i, 'bedrooms', e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
                  />
                </div>
                <div className="col-span-2">
                  {i === 0 && <label className="mb-1 block text-xs text-gray-500">Baths</label>}
                  <input
                    type="number"
                    step="0.5"
                    placeholder="1"
                    value={u.bathrooms}
                    onChange={e => updateUnit(i, 'bathrooms', e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
                  />
                </div>
                <div className="col-span-3">
                  {i === 0 && <label className="mb-1 block text-xs text-gray-500">Sq ft</label>}
                  <input
                    type="number"
                    placeholder="900"
                    value={u.sqft}
                    onChange={e => updateUnit(i, 'sqft', e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
                  />
                </div>
                <div className="col-span-2 flex justify-end">
                  {units.length > 1 && (
                    <button
                      onClick={() => removeUnit(i)}
                      className="text-xs text-red-400 hover:text-red-600"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
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
            {saving ? 'Saving…' : 'Save Property'}
          </button>
          <Link
            href="/properties"
            className="rounded-lg border border-gray-300 px-6 py-2.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            Cancel
          </Link>
        </div>
      </div>
    </>
  );
}
