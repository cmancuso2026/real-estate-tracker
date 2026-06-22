'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface Property { id: number; address: string; city: string; state: string; property_type: string; unit_count: number; }
interface Unit {
  id: number; property_id: number; unit_label: string; is_owner_unit: boolean;
  tenant_name: string | null; tenant_id: number | null;
  rent_amount: number | null; lease_start_date: string | null; lease_end_date: string | null;
  first_lease_start_date: string | null; amount_due: number | null; amount_paid: number | null; is_late: boolean | null;
  payment_status: string | null;
}
interface InsurancePolicy { id: number; property_id: number; expiration_date: string; carrier: string; }

function fmt$(n: number | null | undefined) {
  if (n == null) return '—';
  return '$' + n.toLocaleString();
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
  if (isActive && days !== null && days <= 60) return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Exp. in {days}d</span>;
  if (isActive) return <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Active</span>;
  return <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-600">Upcoming</span>;
}

function yearsInUnit(first: string | null) {
  if (!first) return '—';
  const yrs = (Date.now() - new Date(first).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  return yrs < 0 ? '—' : yrs.toFixed(1) + ' yrs';
}

function PaymentStatusBadge({ status, amountPaid }: { status: string | null; amountPaid: number | null }) {
  if (!status || status === 'no_record') return <span className="italic text-gray-400 text-xs">No record</span>;
  if (status === 'outstanding') return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">Outstanding</span>;
  if (status === 'paid') return <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">✓ Paid {fmt$(amountPaid)}</span>;
  if (status === 'partial') return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">⚠ Partial {fmt$(amountPaid)}</span>;
  return null;
}

export default function PropertiesPage() {
  const router = useRouter();
  const [properties, setProperties] = useState<Property[]>([]);
  const [units, setUnits] = useState<Record<number, Unit[]>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [insurancePolicies, setInsurancePolicies] = useState<InsurancePolicy[]>([]);

  const thisMonth = new Date().toISOString().slice(0, 7);

  useEffect(() => {
    fetch('/api/v2/properties')
      .then(r => r.json())
      .then((props: Property[]) => {
        setProperties(props);
        setLoading(false);
        const exp: Record<number, boolean> = {};
        props.forEach(p => { exp[p.id] = true; });
        setExpanded(exp);
        props.forEach(p => {
          loadUnits(p.id);
          // Load insurance for each property
          fetch(`/api/v2/insurance?propertyId=${p.id}`)
            .then(r => r.ok ? r.json() : [])
            .then((policies: InsurancePolicy[]) => {
              setInsurancePolicies(prev => [...prev.filter(pol => pol.property_id !== p.id), ...policies]);
            })
            .catch(() => {});
        });
      });
  }, []);

  async function loadUnits(propertyId: number) {
    const res = await fetch(`/api/v2/units?propertyId=${propertyId}`);
    const data: Unit[] = await res.json();
    setUnits(prev => ({ ...prev, [propertyId]: data }));
  }

  function toggleExpand(propertyId: number) {
    setExpanded(prev => {
      const next = { ...prev, [propertyId]: !prev[propertyId] };
      if (next[propertyId] && !units[propertyId]) loadUnits(propertyId);
      return next;
    });
  }

  // Summary stats across all units
  const allUnits = Object.values(units).flat();
  const rentalUnits = allUnits.filter(u => !u.is_owner_unit);
  const today = new Date().toISOString().slice(0, 10);
  const totalExpected = rentalUnits
    .filter(u => u.lease_start_date && u.lease_end_date && u.lease_start_date <= today && u.lease_end_date >= today)
    .reduce((s, u) => s + (u.rent_amount ?? 0), 0);
  const totalCollected = rentalUnits.reduce((s, u) => s + (u.amount_paid ?? 0), 0);
  const expiring = rentalUnits.filter(u => {
    const d = daysUntil(u.lease_end_date);
    return d !== null && d >= 0 && d <= 60;
  }).length;

  // Insurance expiring within 60 days
  const insuranceExpiring = insurancePolicies.filter(p => {
    const d = daysUntil(p.expiration_date);
    return d !== null && d >= 0 && d <= 60;
  }).length;

  if (loading) return <div className="py-20 text-center text-gray-400">Loading…</div>;

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Properties</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })}
          </p>
        </div>
        <Link href="/properties/new" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          + Add Property
        </Link>
      </div>

      {/* Summary Cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Rent Expected', value: fmt$(totalExpected), sub: thisMonth },
          { label: 'Rent Collected', value: fmt$(totalCollected), sub: totalExpected ? `${Math.round((totalCollected / totalExpected) * 100)}%` : '—' },
          {
            label: 'Insurance Expiring',
            value: String(insuranceExpiring),
            sub: insuranceExpiring === 0 ? 'all policies current' : 'within 60 days',
            alert: insuranceExpiring > 0,
          },
          { label: 'Leases Expiring', value: String(expiring), sub: 'within 60 days' },
        ].map(card => (
          <div key={card.label} className={`rounded-xl border p-4 ${'alert' in card && card.alert ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20' : 'border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900'}`}>
            <p className="text-xs text-gray-500 dark:text-gray-400">{card.label}</p>
            <p className={`mt-1 text-2xl font-bold tabular ${'alert' in card && card.alert ? 'text-amber-700 dark:text-amber-400' : ''}`}>{card.value}</p>
            <p className="text-xs text-gray-400">{card.sub}</p>
          </div>
        ))}
      </div>

      {properties.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center text-gray-500 dark:border-gray-700">
          <p className="text-lg font-medium">No properties yet</p>
          <Link href="/properties/new" className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Add Property</Link>
        </div>
      ) : (
        <div className="space-y-4">
          {properties.map(property => {
            const propUnits = units[property.id] ?? [];
            const isExpanded = expanded[property.id];

            return (
              <div key={property.id} className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                {/* Property header — click to expand */}
                <button
                  onClick={() => toggleExpand(property.id)}
                  className="flex w-full items-center justify-between px-5 py-4 text-left"
                >
                  <div>
                    <p className="font-semibold">{property.address}</p>
                    <p className="text-sm text-gray-500">{property.city}, {property.state} · {property.property_type.charAt(0).toUpperCase() + property.property_type.slice(1)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/properties/${property.id}`}
                      onClick={e => e.stopPropagation()}
                      className="rounded-lg border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
                    >
                      Manage →
                    </Link>
                    <span className="text-gray-400 text-sm">{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </button>

                {/* Expanded units */}
                {isExpanded && (
                  <div className="border-t border-gray-100 dark:border-gray-800">
                    {propUnits.length === 0 ? (
                      <p className="px-5 py-4 text-sm text-gray-400 italic">Loading units…</p>
                    ) : (
                      <table className="w-full text-sm">
                        <colgroup>
                          <col className="w-24" />
                          <col className="w-64" />
                          <col className="w-28" />
                          <col className="w-32" />
                          <col className="w-32" />
                          <col className="w-20" />
                          <col className="w-24" />
                          <col />
                        </colgroup>
                        <thead>
                          <tr className="border-b border-gray-50 dark:border-gray-800">
                            {['Unit', 'Tenant', 'Rent/mo', 'This Month', 'Lease Status', 'Expires', 'Days', 'Tenure'].map(h => (
                              <th key={h} className="px-5 py-2.5 text-left text-xs font-medium text-gray-400">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {propUnits.map(u => {
                            const days = daysUntil(u.lease_end_date);
                            return (
                              <tr
                                key={u.id}
                                onClick={() => router.push(`/properties/${property.id}/units/${u.id}`)}
                                className={`cursor-pointer border-b border-gray-50 last:border-0 dark:border-gray-800/50 ${u.is_owner_unit ? 'bg-blue-50/50 dark:bg-blue-950/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/30'}`}
                              >
                                <td className="px-5 py-3 font-semibold text-blue-600 dark:text-blue-400">
                                  <div className="flex items-center gap-2">
                                    {u.unit_label}
                                    {u.is_owner_unit && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">Owner</span>}
                                  </div>
                                </td>
                                <td className="px-5 py-3">{u.is_owner_unit ? <span className="italic text-blue-500 dark:text-blue-400">Owner occupied</span> : u.tenant_name ?? <span className="italic text-gray-400">Vacant</span>}</td>
                                <td className="px-5 py-3 tabular">{u.is_owner_unit ? <span className="text-gray-400">—</span> : fmt$(u.rent_amount)}</td>
                                <td className="px-5 py-3">
                                  {u.is_owner_unit ? <span className="text-gray-400">—</span>
                                    : <PaymentStatusBadge status={u.payment_status} amountPaid={u.amount_paid} />
                                  }
                                </td>
                                <td className="px-5 py-3">{u.is_owner_unit ? <span className="text-gray-400">—</span> : <LeaseStatusBadge startDate={u.lease_start_date} endDate={u.lease_end_date} />}</td>
                                <td className="px-5 py-3 text-gray-500 text-xs tabular">{u.is_owner_unit ? '—' : u.lease_end_date ?? '—'}</td>
                                <td className="px-5 py-3 tabular">
                                  {u.is_owner_unit ? <span className="text-gray-400">—</span> : days !== null
                                    ? <span className={days < 0 ? 'text-red-500' : days <= 60 ? 'text-amber-600 font-medium' : 'text-gray-500'}>
                                        {Math.abs(days)}d{days < 0 ? ' ago' : ''}
                                      </span>
                                    : <span className="text-gray-400">—</span>
                                  }
                                </td>
                                <td className="px-5 py-3 text-gray-500">{u.is_owner_unit ? '—' : yearsInUnit(u.first_lease_start_date)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
