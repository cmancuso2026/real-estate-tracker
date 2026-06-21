'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface Unit { amount_due: number | null; amount_paid: number | null; is_late: boolean | null; is_owner_unit: boolean;
  id: number;
  unit_label: string;
  tenant_name: string | null;
  tenant_id: number | null;
  rent_amount: number | null;
  lease_start_date: string | null;
  lease_end_date: string | null;
  first_lease_start_date: string | null;
  amount_due: number | null;
  amount_paid: number | null;
  is_late: boolean | null;
}

function fmt$(n: number | null | undefined) {
  if (n == null) return '—';
  return '$' + n.toLocaleString();
}

function yearsInUnit(firstLeaseStart: string | null): string {
  if (!firstLeaseStart) return '—';
  const start = new Date(firstLeaseStart).getTime();
  const now = Date.now();
  const years = (now - start) / (1000 * 60 * 60 * 24 * 365.25);
  if (years < 0) return '—';
  return years.toFixed(1) + ' yrs';
}

function LeaseStatusBadge({ startDate, endDate }: { startDate: string | null; endDate: string | null }) {
  if (!endDate) return <span className="italic text-gray-400 text-xs">No lease</span>;
  const today = new Date().toISOString().slice(0, 10);
  const daysLeft = Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000);
  const isActive = startDate && startDate <= today && endDate >= today;
  const isExpired = endDate < today;

  if (isExpired) return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600 dark:bg-red-900/30 dark:text-red-400">Expired</span>;
  if (isActive && daysLeft <= 60) return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Expiring soon</span>;
  if (isActive) return <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">Active</span>;
  return <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">Upcoming</span>;
}

function daysUntilExpiry(endDate: string | null): string {
  if (!endDate) return '—';
  const days = Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000);
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days === 0) return 'Today';
  return `${days}d`;
}

export function OverviewTab({ id, units, onRefresh }: { id: string; units: Unit[]; onRefresh: () => void }) {
  const router = useRouter();
  const [selectedUnit, setSelectedUnit] = useState<string>('all');
  const [togglingId, setTogglingId] = useState<number|null>(null);

  async function toggleOwner(u: Unit, e: React.MouseEvent) {
    e.stopPropagation();
    setTogglingId(u.id);
    await fetch(`/api/v2/units/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_owner_unit: !u.is_owner_unit }),
    });
    setTogglingId(null);
    onRefresh();
  }

  const filtered = selectedUnit === 'all'
    ? units
    : units.filter(u => u.unit_label === selectedUnit);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-700 dark:text-gray-300">Units</h2>
        <div className="flex gap-2">
          <Link href={`/properties/${id}/tenants/new`} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
            + Add Tenant
          </Link>
          <Link href={`/properties/${id}?tab=leases`} onClick={e=>{e.preventDefault();router.push(`/properties/${id}?tab=leases`);}} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
            + Add Lease
          </Link>
        </div>
      </div>

      {/* Unit slicers */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedUnit('all')}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
            selectedUnit === 'all'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
          }`}
        >
          All Units
        </button>
        {units.map(u => (
          <button
            key={u.id}
            onClick={() => setSelectedUnit(u.unit_label)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              selectedUnit === u.unit_label
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
            }`}
          >
            Unit {u.unit_label}
          </button>
        ))}
      </div>

      {/* Summary cards — only when showing all rental units */}
      {selectedUnit === 'all' && (() => {
        const today = new Date().toISOString().slice(0, 10);
        const rentalUnits = units.filter(u => !u.is_owner_unit);
        const totalRent = rentalUnits
          .filter(u => u.lease_start_date && u.lease_end_date && u.lease_start_date <= today && u.lease_end_date >= today)
          .reduce((s, u) => s + (u.rent_amount ?? 0), 0);
        const collected = rentalUnits.reduce((s, u) => s + (u.amount_paid ?? 0), 0);
        return (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <p className="text-xs text-gray-500">Total Rent Expected</p>
              <p className="mt-1 text-xl font-bold tabular">${totalRent.toLocaleString()}/mo</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <p className="text-xs text-gray-500">Rent Collected</p>
              <p className="mt-1 text-xl font-bold tabular">${collected.toLocaleString()}</p>
              <p className="text-xs text-gray-400">{totalRent > 0 ? Math.round((collected/totalRent)*100) : 0}% this month</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <p className="text-xs text-gray-500">Occupied Units</p>
              <p className="mt-1 text-xl font-bold">{rentalUnits.filter(u=>u.tenant_id).length} / {rentalUnits.length}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <p className="text-xs text-gray-500">Leases Expiring Soon</p>
              <p className="mt-1 text-xl font-bold">{rentalUnits.filter(u=>{const d=u.lease_end_date?Math.ceil((new Date(u.lease_end_date).getTime()-Date.now())/86400000):null;return d!==null&&d>=0&&d<=60;}).length}</p>
              <p className="text-xs text-gray-400">within 60 days</p>
            </div>
          </div>
        );
      })()}

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              {['Unit', 'Tenant', 'Rent/mo', 'This Month', 'Lease Status', 'Lease Expiration', 'Days Until Exp.', 'Years in Unit', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">No units</td>
              </tr>
            ) : filtered.map(u => (
              <tr key={u.id} className={`cursor-pointer ${u.is_owner_unit ? 'bg-blue-50/50 dark:bg-blue-950/20' : 'hover:bg-gray-50 dark:hover:bg-gray-900/50'}`} onClick={()=>window.location.href=`/properties/${id}/units/${u.id}`}>
                <td className="px-4 py-3 font-semibold text-blue-600 dark:text-blue-400">
                  <div className="flex items-center gap-2">
                    {u.unit_label}
                    {u.is_owner_unit && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">Owner</span>}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {u.is_owner_unit
                    ? <span className="italic text-blue-500 dark:text-blue-400">Owner occupied</span>
                    : u.tenant_name
                    ? <span className="font-medium">{u.tenant_name}</span>
                    : <span className="italic text-gray-400">Vacant</span>
                  }
                </td>
                <td className="px-4 py-3 tabular font-medium">{fmt$(u.rent_amount)}</td>
                <td className="px-4 py-3">
                  {u.is_owner_unit ? <span className="text-gray-400">—</span> : u.amount_paid != null
                    ? <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${u.is_late ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>{u.is_late ? 'Late' : 'Paid'} {fmt$(u.amount_paid)}</span>
                    : u.amount_due != null
                    ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">Unpaid</span>
                    : <span className="text-gray-400 text-xs">No record</span>
                  }
                </td>
                <td className="px-4 py-3">
                  <LeaseStatusBadge startDate={u.lease_start_date} endDate={u.lease_end_date} />
                </td>
                <td className="px-4 py-3 tabular text-gray-600 dark:text-gray-400">
                  {u.lease_end_date ?? <span className="text-gray-400">—</span>}
                </td>
                <td className="px-4 py-3 tabular">
                  {u.lease_end_date ? (
                    <span className={
                      Math.ceil((new Date(u.lease_end_date).getTime() - Date.now()) / 86400000) <= 60 &&
                      Math.ceil((new Date(u.lease_end_date).getTime() - Date.now()) / 86400000) >= 0
                        ? 'text-amber-600 font-medium'
                        : Math.ceil((new Date(u.lease_end_date).getTime() - Date.now()) / 86400000) < 0
                        ? 'text-red-500'
                        : 'text-gray-600 dark:text-gray-400'
                    }>
                      {daysUntilExpiry(u.lease_end_date)}
                    </span>
                  ) : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-4 py-3 tabular text-gray-600 dark:text-gray-400">
                  {u.is_owner_unit ? '—' : yearsInUnit(u.first_lease_start_date)}
                </td>
                <td className="px-4 py-3" onClick={e=>e.stopPropagation()}>
                  <button
                    onClick={e=>toggleOwner(u,e)}
                    disabled={togglingId===u.id}
                    className={`rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${u.is_owner_unit ? 'bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400'}`}
                  >
                    {togglingId===u.id ? '…' : u.is_owner_unit ? 'Owner ✓' : 'Set Owner'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
