'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface UnitDetail {
  id: number; unit_label: string; bedrooms: number | null; bathrooms: number | null; sqft: number | null;
  tenant_name: string | null; tenant_id: number | null;
  rent_amount: number | null; lease_start_date: string | null; lease_end_date: string | null;
  first_lease_start_date: string | null;
}
interface Lease {
  id: number; start_date: string; end_date: string; rent_amount: number;
  security_deposit: number | null; extracted_by_ai: boolean; tenant_name: string;
}
interface RentCollection {
  id: number; due_date: string; amount_due: number; amount_paid: number | null;
  is_partial: boolean; is_late: boolean; late_fee_charged: number | null; paid_date: string | null;
}

function fmt$(n: number | null | undefined) {
  if (n == null) return '—';
  return '$' + Math.abs(n).toLocaleString();
}

function yearsInUnit(first: string | null) {
  if (!first) return '—';
  const yrs = (Date.now() - new Date(first).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  return yrs < 0 ? '—' : yrs.toFixed(1) + ' yrs';
}

function daysUntil(date: string | null) {
  if (!date) return null;
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86400000);
}

function LeaseStatusBadge({ startDate, endDate }: { startDate: string | null; endDate: string | null }) {
  if (!endDate) return <span className="italic text-gray-400 text-xs">No lease</span>;
  const today = new Date().toISOString().slice(0, 10);
  const days = daysUntil(endDate);
  const isActive = startDate && startDate <= today && endDate >= today;
  const isExpired = endDate < today;
  if (isExpired) return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">Expired</span>;
  if (isActive && days !== null && days <= 60) return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Expiring in {days}d</span>;
  if (isActive) return <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Active</span>;
  return <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-600">Upcoming</span>;
}

export default function UnitDetailPage() {
  const params = useParams();
  const propertyId = params.id as string;
  const unitId = params.unitId as string;

  const [unit, setUnit] = useState<UnitDetail | null>(null);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [rent, setRent] = useState<RentCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [propertyAddress, setPropertyAddress] = useState('');

  useEffect(() => {
    async function load() {
      const [unitsRes, leasesRes, rentRes, propRes] = await Promise.all([
        fetch(`/api/v2/units?propertyId=${propertyId}`),
        fetch(`/api/v2/leases?unitId=${unitId}`),
        fetch(`/api/v2/rent?unitId=${unitId}`),
        fetch(`/api/v2/properties`),
      ]);
      const units: UnitDetail[] = await unitsRes.json();
      setUnit(units.find(u => String(u.id) === unitId) ?? null);
      setLeases(await leasesRes.json());
      setRent(await rentRes.json());
      const props: Array<{ id: number; address: string }> = await propRes.json();
      const p = props.find(p => String(p.id) === propertyId);
      if (p) setPropertyAddress(p.address);
      setLoading(false);
    }
    load();
  }, [propertyId, unitId]);

  if (loading) return <div className="py-20 text-center text-gray-400">Loading…</div>;
  if (!unit) return <div className="py-20 text-center text-gray-400">Unit not found.</div>;

  // Rent summary stats
  const paid = rent.filter(r => r.amount_paid != null);
  const onTime = paid.filter(r => !r.is_late && !r.is_partial).length;
  const late = paid.filter(r => r.is_late).length;
  const partial = paid.filter(r => r.is_partial).length;
  const unpaid = rent.filter(r => r.amount_paid == null).length;
  const totalPaid = paid.reduce((s, r) => s + (r.amount_paid ?? 0), 0);
  const totalExpected = rent.reduce((s, r) => s + r.amount_due, 0);

  const days = daysUntil(unit.lease_end_date);
  const today = new Date().toISOString().slice(0, 10);
  const leaseIsActive = unit.lease_start_date && unit.lease_end_date &&
    unit.lease_start_date <= today && unit.lease_end_date >= today;

  return (
    <>
      <div className="mb-6">
        <Link href={`/properties/${propertyId}`} className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">
          ← {propertyAddress}
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Unit {unit.unit_label}</h1>
        {(unit.bedrooms || unit.sqft) && (
          <p className="text-sm text-gray-500">
            {[unit.bedrooms && `${unit.bedrooms} bed`, unit.bathrooms && `${unit.bathrooms} bath`, unit.sqft && `${unit.sqft} sqft`].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">

        {/* Tenant card */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Current Tenant</h2>
          {unit.tenant_name ? (
            <div className="space-y-3">
              <p className="text-lg font-semibold">{unit.tenant_name}</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-500">Monthly Rent</p>
                  <p className="font-semibold tabular">{fmt$(unit.rent_amount)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Years in Unit</p>
                  <p className="font-semibold">{yearsInUnit(unit.first_lease_start_date)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Lease Status</p>
                  <div className="mt-0.5">
                    <LeaseStatusBadge startDate={unit.lease_start_date} endDate={unit.lease_end_date} />
                  </div>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Lease Expiration</p>
                  <p className="font-medium">{unit.lease_end_date ?? '—'}</p>
                </div>
                {unit.lease_end_date && days !== null && (
                  <div className="col-span-2">
                    <p className="text-xs text-gray-500">{days >= 0 ? 'Days Until Expiration' : 'Days Since Expiration'}</p>
                    <p className={`font-semibold tabular ${days < 0 ? 'text-red-500' : days <= 60 ? 'text-amber-600' : 'text-gray-700 dark:text-gray-300'}`}>
                      {Math.abs(days)}d {days < 0 ? 'overdue' : leaseIsActive ? 'remaining' : ''}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="py-4 text-center text-gray-400">
              <p className="italic">Vacant</p>
              <Link href={`/properties/${propertyId}/tenants/new`} className="mt-2 inline-block text-xs text-blue-600 hover:underline dark:text-blue-400">
                + Add Tenant
              </Link>
            </div>
          )}
        </div>

        {/* Rent summary card */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Rent History</h2>
          {rent.length === 0 ? (
            <p className="py-4 text-center italic text-gray-400 text-sm">No rent records yet</p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-500">Total Records</p>
                  <p className="text-lg font-bold">{rent.length}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Total Collected</p>
                  <p className="text-lg font-bold tabular">{fmt$(totalPaid)}</p>
                </div>
              </div>
              <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">On time</span>
                    <span className="font-medium text-green-600">{onTime}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Late</span>
                    <span className="font-medium text-amber-600">{late}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Partial</span>
                    <span className="font-medium text-amber-600">{partial}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Unpaid</span>
                    <span className="font-medium text-red-500">{unpaid}</span>
                  </div>
                </div>
              </div>
              {totalExpected > 0 && (
                <div>
                  <div className="mb-1 flex justify-between text-xs text-gray-500">
                    <span>Collection rate</span>
                    <span>{Math.round((totalPaid / totalExpected) * 100)}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                    <div
                      className="h-2 rounded-full bg-green-500"
                      style={{ width: `${Math.min(100, Math.round((totalPaid / totalExpected) * 100))}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Quick actions card */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Quick Actions</h2>
          <div className="space-y-2">
            <Link href={`/properties/${propertyId}?tab=leases`}
              className="flex w-full items-center justify-between rounded-lg border border-gray-200 px-3 py-2.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
              <span>Upload Lease PDF</span>
              <span className="text-gray-400">→</span>
            </Link>
            <Link href={`/properties/${propertyId}?tab=rent`}
              className="flex w-full items-center justify-between rounded-lg border border-gray-200 px-3 py-2.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
              <span>Add Rent Payment</span>
              <span className="text-gray-400">→</span>
            </Link>
            <Link href={`/properties/${propertyId}?tab=work-orders`}
              className="flex w-full items-center justify-between rounded-lg border border-gray-200 px-3 py-2.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
              <span>New Work Order</span>
              <span className="text-gray-400">→</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Lease history */}
      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-gray-700 dark:text-gray-300">Lease History</h2>
          <Link href={`/properties/${propertyId}?tab=leases`}
            className="text-xs text-blue-600 hover:underline dark:text-blue-400">
            Upload PDF →
          </Link>
        </div>
        <div className="space-y-2">
          {leases.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-gray-400 dark:border-gray-700">
              No leases yet.
            </div>
          ) : leases.map(l => (
            <div key={l.id} className="flex items-center justify-between rounded-xl border border-gray-200 px-5 py-3 dark:border-gray-800">
              <div>
                <span className="font-medium text-sm">{l.tenant_name}</span>
                {l.extracted_by_ai && <span className="ml-2 rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">AI parsed</span>}
                <p className="text-xs text-gray-500 mt-0.5">{l.start_date} → {l.end_date}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold tabular text-sm">{fmt$(l.rent_amount)}/mo</p>
                {l.security_deposit && <p className="text-xs text-gray-400">Dep: {fmt$(l.security_deposit)}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
