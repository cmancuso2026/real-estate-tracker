import Link from 'next/link';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface PropertyRow {
  id: number;
  address: string;
  city: string;
  state: string;
  property_type: string;
  unit_count: number;
}

interface UnitRow {
  id: number;
  property_id: number;
  unit_label: string;
  tenant_name: string | null;
  tenant_id: number | null;
  rent_amount: number | null;
  lease_end_date: string | null;
  amount_due: number | null;
  amount_paid: number | null;
  is_late: boolean | null;
}

interface WorkOrderRow {
  property_id: number;
  count: number;
}

function fmt$(n: number | null) {
  if (n == null) return '—';
  return '$' + n.toLocaleString();
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function LeaseExpiry({ date }: { date: string | null }) {
  const days = daysUntil(date);
  if (!date || days == null) return <span className="text-gray-400">—</span>;
  if (days < 0) return <span className="text-red-600 font-medium">Expired</span>;
  if (days <= 60) return <span className="text-amber-600 font-medium">Expires in {days}d</span>;
  return <span className="text-gray-500">{date}</span>;
}

function RentStatus({ due, paid, isLate }: { due: number | null; paid: number | null; isLate: boolean | null }) {
  if (!due) return <span className="text-gray-400">No active lease</span>;
  if (!paid) return <span className="text-red-600 font-medium">Unpaid {fmt$(due)}</span>;
  if (paid < due) return <span className="text-amber-600 font-medium">Partial {fmt$(paid)} / {fmt$(due)}</span>;
  if (isLate) return <span className="text-amber-600 font-medium">Paid late {fmt$(paid)}</span>;
  return <span className="text-green-600 font-medium">Paid {fmt$(paid)}</span>;
}

export default async function PropertiesPage() {
  const properties = await query<PropertyRow>(
    `SELECT * FROM owned_properties ORDER BY address`
  );

  const thisMonth = new Date().toISOString().slice(0, 7);

  const [units, openWOs] = await Promise.all([
    query<UnitRow>(`
      SELECT u.id, u.property_id, u.unit_label,
             (t.first_name || ' ' || t.last_name) AS tenant_name,
             t.id AS tenant_id,
             l.rent_amount,
             l.end_date AS lease_end_date,
             rc.amount_due,
             rc.amount_paid,
             rc.is_late
      FROM units u
      LEFT JOIN tenants t ON t.unit_id = u.id AND t.is_active = TRUE
      LEFT JOIN leases l ON l.unit_id = u.id
        AND l.start_date <= to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD')
        AND l.end_date   >= to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD')
      LEFT JOIN rent_collections rc ON rc.unit_id = u.id AND rc.due_date LIKE $1
      ORDER BY u.property_id, u.unit_label
    `, [thisMonth + '%']),

    query<WorkOrderRow>(`
      SELECT property_id, COUNT(*)::int AS count
      FROM work_orders WHERE status = 'open'
      GROUP BY property_id
    `),
  ]);

  const woByProperty = Object.fromEntries(openWOs.map(w => [w.property_id, w.count]));
  const unitsByProperty = units.reduce<Record<number, UnitRow[]>>((acc, u) => {
    (acc[u.property_id] ??= []).push(u);
    return acc;
  }, {});

  const totalExpected = units.reduce((s, u) => s + (u.amount_due ?? 0), 0);
  const totalCollected = units.reduce((s, u) => s + (u.amount_paid ?? 0), 0);
  const unitsVacant = units.filter(u => !u.tenant_id).length;
  const leasesExpiring = units.filter(u => {
    const d = daysUntil(u.lease_end_date);
    return d != null && d >= 0 && d <= 60;
  }).length;

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Properties</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })}
          </p>
        </div>
        <Link
          href="/properties/new"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Add Property
        </Link>
      </div>

      {/* Summary Cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Rent Expected', value: fmt$(totalExpected), sub: thisMonth },
          { label: 'Rent Collected', value: fmt$(totalCollected), sub: totalExpected ? `${Math.round((totalCollected / totalExpected) * 100)}%` : '—' },
          { label: 'Vacant Units', value: String(unitsVacant), sub: unitsVacant === 0 ? 'fully occupied' : 'needs tenant' },
          { label: 'Leases Expiring', value: String(leasesExpiring), sub: 'within 60 days' },
        ].map(card => (
          <div key={card.label} className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <p className="text-xs text-gray-500 dark:text-gray-400">{card.label}</p>
            <p className="mt-1 text-2xl font-bold tabular">{card.value}</p>
            <p className="text-xs text-gray-400">{card.sub}</p>
          </div>
        ))}
      </div>

      {properties.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center text-gray-500 dark:border-gray-700">
          <p className="text-lg font-medium">No properties yet</p>
          <p className="mt-1 text-sm">Add your first property to get started.</p>
          <Link href="/properties/new" className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            Add Property
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {properties.map(property => {
            const propUnits = unitsByProperty[property.id] ?? [];
            const openWOCount = woByProperty[property.id] ?? 0;

            return (
              <div key={property.id} className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                {/* Property Header */}
                <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
                  <div>
                    <Link href={`/properties/${property.id}`} className="font-semibold hover:text-blue-600 dark:hover:text-blue-400">
                      {property.address}
                    </Link>
                    <p className="text-sm text-gray-500">{property.city}, {property.state} · {property.property_type}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {openWOCount > 0 && (
                      <Link href={`/properties/${property.id}?tab=work-orders`} className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                        {openWOCount} open WO{openWOCount > 1 ? 's' : ''}
                      </Link>
                    )}
                    <Link href={`/properties/${property.id}`} className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
                      View →
                    </Link>
                  </div>
                </div>

                {/* Units Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-gray-800">
                        <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500">Unit</th>
                        <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500">Tenant</th>
                        <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500">Rent</th>
                        <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500">This Month</th>
                        <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500">Lease Ends</th>
                        <th className="px-5 py-2.5 text-right text-xs font-medium text-gray-500">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {propUnits.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-5 py-4 text-center text-gray-400">
                            No units — <Link href={`/properties/${property.id}?tab=units`} className="text-blue-600 hover:underline">add units</Link>
                          </td>
                        </tr>
                      ) : propUnits.map(unit => (
                        <tr key={unit.id} className="border-b border-gray-50 last:border-0 dark:border-gray-800/50">
                          <td className="px-5 py-3 font-medium">{unit.unit_label}</td>
                          <td className="px-5 py-3">
                            {unit.tenant_name
                              ? <span>{unit.tenant_name}</span>
                              : <span className="italic text-gray-400">Vacant</span>
                            }
                          </td>
                          <td className="px-5 py-3 tabular">{fmt$(unit.rent_amount)}</td>
                          <td className="px-5 py-3">
                            <RentStatus due={unit.amount_due} paid={unit.amount_paid} isLate={unit.is_late} />
                          </td>
                          <td className="px-5 py-3">
                            <LeaseExpiry date={unit.lease_end_date} />
                          </td>
                          <td className="px-5 py-3 text-right">
                            <Link href={`/properties/${property.id}?unit=${unit.id}`} className="text-xs text-blue-600 hover:underline dark:text-blue-400">
                              Details
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
