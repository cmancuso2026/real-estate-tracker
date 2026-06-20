'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';

type Tab = 'overview' | 'rent' | 'leases' | 'work-orders' | 'escrow' | 'insurance';

interface Property { id: number; address: string; city: string; state: string; property_type: string; unit_count: number; }
interface Unit { id: number; unit_label: string; tenant_name: string | null; tenant_id: number | null; rent_amount: number | null; lease_end_date: string | null; amount_due: number | null; amount_paid: number | null; is_late: boolean | null; }
interface RentRow { id: number; unit_label: string; due_date: string; amount_due: number; paid_date: string | null; amount_paid: number | null; is_partial: boolean; is_late: boolean; late_fee_charged: number | null; source: string; }
interface WorkOrder { id: number; vendor_name: string; vendor_trade: string; category: string; description: string; status: string; date_received: string; date_completed: string | null; quoted_cost: number | null; actual_cost: number | null; rating: number | null; unit_label: string | null; }
interface Lease { id: number; unit_label: string; tenant_name: string; start_date: string; end_date: string; rent_amount: number; security_deposit: number | null; utilities_landlord: string | null; utilities_tenant: string | null; equipment_included: string | null; extracted_by_ai: boolean; }
interface EscrowAccount { id: number; lender_name: string; loan_number: string | null; statement_date: string | null; projected_requirement: number | null; actual_disbursements: number | null; shortage_surplus_amount: number | null; new_monthly_escrow: number | null; }
interface InsurancePolicy { id: number; carrier: string; policy_type: string | null; effective_date: string; expiration_date: string; annual_premium: number | null; deductible: number | null; coverage_notes: string | null; extracted_by_ai: boolean; }

// Extracted shapes from Claude
interface LeaseExtracted { start_date: string | null; end_date: string | null; rent_amount: number | null; security_deposit: number | null; late_fee_amount: number | null; late_fee_grace_days: number | null; utilities_landlord: string[]; utilities_tenant: string[]; equipment_included: string[]; confidence_notes: string | null; }
interface EscrowExtracted { statement_date: string | null; analysis_period_start: string | null; analysis_period_end: string | null; projected_requirement: number | null; actual_disbursements: number | null; shortage_surplus_amount: number | null; new_monthly_escrow: number | null; confidence_notes: string | null; }
interface InsuranceExtracted { carrier: string | null; policy_number: string | null; policy_type: string | null; effective_date: string | null; expiration_date: string | null; renewal_period_days: number | null; annual_premium: number | null; deductible: number | null; coverage_limit: number | null; coverage_notes: string | null; confidence_notes: string | null; }
interface WorkOrderExtracted { vendor_name: string | null; category: string | null; description: string | null; date_received: string | null; quoted_cost: number | null; actual_cost: number | null; confidence_notes: string | null; }

function fmt$(n: number | null | undefined) {
  if (n == null) return '—';
  return '$' + Math.abs(n).toLocaleString();
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    received: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    open: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    complete: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? colors.received}`}>{status}</span>;
}

function Stars({ rating }: { rating: number | null }) {
  if (!rating) return <span className="text-gray-400 text-xs">Unrated</span>;
  return <span className="text-amber-500">{'★'.repeat(rating)}{'☆'.repeat(5 - rating)}</span>;
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="font-medium">{value ?? <span className="text-gray-400 italic">Not found</span>}</p>
    </div>
  );
}

function Tags({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      {items.length === 0
        ? <span className="italic text-gray-400 text-sm">None</span>
        : <div className="flex flex-wrap gap-1">{items.map(i => <span key={i} className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{i}</span>)}</div>
      }
    </div>
  );
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'rent', label: 'Rent' },
  { id: 'leases', label: 'Leases' },
  { id: 'work-orders', label: 'Work Orders' },
  { id: 'escrow', label: 'Escrow' },
  { id: 'insurance', label: 'Insurance' },
];

const UTILITIES = ['electric', 'gas', 'water', 'trash', 'sewer', 'internet'];
const EQUIPMENT = ['refrigerator', 'stove', 'dishwasher', 'washer', 'dryer', 'HVAC', 'microwave', 'A/C window unit'];

export default function PropertyDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = params.id as string;

  const [tab, setTab] = useState<Tab>((searchParams.get('tab') as Tab) ?? 'overview');
  const [property, setProperty] = useState<Property | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [rent, setRent] = useState<RentRow[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [escrow, setEscrow] = useState<EscrowAccount[]>([]);
  const [insurance, setInsurance] = useState<InsurancePolicy[]>([]);
  const [loading, setLoading] = useState(true);

  // Upload / extraction state
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Extracted data pending review
  const [leaseExtracted, setLeaseExtracted] = useState<LeaseExtracted | null>(null);
  const [leaseConfirmUnit, setLeaseConfirmUnit] = useState('');
  const [leaseConfirmTenant, setLeaseConfirmTenant] = useState('');
  const [leaseSaving, setLeaseSaving] = useState(false);

  const [escrowExtracted, setEscrowExtracted] = useState<EscrowExtracted | null>(null);
  const [escrowConfirmLender, setEscrowConfirmLender] = useState('');
  const [escrowSaving, setEscrowSaving] = useState(false);

  const [insuranceExtracted, setInsuranceExtracted] = useState<InsuranceExtracted | null>(null);
  const [insuranceSaving, setInsuranceSaving] = useState(false);

  const [woExtracted, setWoExtracted] = useState<WorkOrderExtracted | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [propRes, unitsRes] = await Promise.all([
      fetch(`/api/v2/properties`),
      fetch(`/api/v2/units?propertyId=${id}`),
    ]);
    const props: Property[] = await propRes.json();
    setProperty(props.find(p => String(p.id) === id) ?? null);
    setUnits(await unitsRes.json());
    setLoading(false);
  }, [id]);

  const loadTab = useCallback(async (t: Tab) => {
    if (t === 'rent') {
      const res = await fetch(`/api/v2/rent?propertyId=${id}`);
      setRent(await res.json());
    } else if (t === 'work-orders') {
      const res = await fetch(`/api/v2/work-orders?propertyId=${id}`);
      setWorkOrders(await res.json());
    } else if (t === 'leases') {
      const allLeases: Lease[] = [];
      for (const u of units) {
        const res = await fetch(`/api/v2/leases?unitId=${u.id}`);
        allLeases.push(...(await res.json() as Lease[]));
      }
      setLeases(allLeases);
    } else if (t === 'escrow') {
      const res = await fetch(`/api/v2/escrow?propertyId=${id}`);
      setEscrow(await res.json());
    } else if (t === 'insurance') {
      const res = await fetch(`/api/v2/insurance?propertyId=${id}`);
      setInsurance(await res.json());
    }
  }, [id, units]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!loading) loadTab(tab); }, [tab, loading, loadTab]);

  const switchTab = (t: Tab) => {
    setTab(t);
    router.replace(`/properties/${id}?tab=${t}`, { scroll: false });
  };

  async function uploadPdf(file: File, type: string) {
    setUploading(true);
    setUploadError('');
    const form = new FormData();
    form.append('file', file);
    form.append('type', type);
    const res = await fetch('/api/v2/upload', { method: 'POST', body: form });
    const data = await res.json();
    setUploading(false);
    if (!res.ok) { setUploadError('Upload failed: ' + (data.error ?? 'unknown')); return null; }
    return data.extracted;
  }

  // ── SAVE HANDLERS ──────────────────────────────────────────────────────────

  async function confirmLease() {
    if (!leaseExtracted || !leaseConfirmUnit || !leaseConfirmTenant) return;
    setLeaseSaving(true);
    await fetch('/api/v2/leases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: parseInt(leaseConfirmTenant),
        unit_id: parseInt(leaseConfirmUnit),
        start_date: leaseExtracted.start_date,
        end_date: leaseExtracted.end_date,
        rent_amount: leaseExtracted.rent_amount,
        security_deposit: leaseExtracted.security_deposit,
        late_fee_amount: leaseExtracted.late_fee_amount,
        late_fee_grace_days: leaseExtracted.late_fee_grace_days,
        utilities_landlord: leaseExtracted.utilities_landlord,
        utilities_tenant: leaseExtracted.utilities_tenant,
        equipment_included: leaseExtracted.equipment_included,
        extracted_by_ai: true,
        ai_confidence_notes: leaseExtracted.confidence_notes,
      }),
    });
    setLeaseExtracted(null);
    setLeaseSaving(false);
    loadTab('leases');
  }

  async function confirmEscrow() {
    if (!escrowExtracted) return;
    setEscrowSaving(true);
    // Upsert escrow account
    const accRes = await fetch('/api/v2/escrow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ property_id: parseInt(id), lender_name: escrowConfirmLender || 'Unknown Lender' }),
    });
    const acc = await accRes.json();
    // Save statement
    await fetch('/api/v2/escrow/statement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...escrowExtracted, escrow_account_id: acc.id, extracted_by_ai: true }),
    });
    setEscrowExtracted(null);
    setEscrowSaving(false);
    loadTab('escrow');
  }

  async function confirmInsurance() {
    if (!insuranceExtracted) return;
    setInsuranceSaving(true);
    await fetch('/api/v2/insurance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...insuranceExtracted, property_id: parseInt(id), extracted_by_ai: true }),
    });
    setInsuranceExtracted(null);
    setInsuranceSaving(false);
    loadTab('insurance');
  }

  if (loading) return <div className="py-20 text-center text-gray-400">Loading…</div>;
  if (!property) return <div className="py-20 text-center text-gray-400">Property not found.</div>;

  const activeTenants = units.filter(u => u.tenant_id);

  return (
    <>
      <div className="mb-6">
        <Link href="/properties" className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">← My Properties</Link>
        <h1 className="mt-1 text-2xl font-bold">{property.address}</h1>
        <p className="text-sm text-gray-500">{property.city}, {property.state} · {property.property_type} · {property.unit_count} units</p>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 border-b border-gray-200 dark:border-gray-800">
        {TABS.map(t => (
          <button key={t.id} onClick={() => switchTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${tab === t.id ? 'border-b-2 border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400' : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {uploadError && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">{uploadError}</div>
      )}

      {/* ── OVERVIEW ── */}
      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Units</h2>
            <div className="flex gap-2">
              <Link href={`/properties/${id}/tenants/new`} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">+ Add Tenant</Link>
              <Link href={`/properties/${id}/leases/new`} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">+ Add Lease</Link>
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>{['Unit','Tenant','Rent/mo','This Month','Lease Ends'].map(h => <th key={h} className="px-5 py-3 text-left text-xs font-medium text-gray-500">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {units.map(u => (
                  <tr key={u.id}>
                    <td className="px-5 py-3 font-medium">{u.unit_label}</td>
                    <td className="px-5 py-3">{u.tenant_name ?? <span className="italic text-gray-400">Vacant</span>}</td>
                    <td className="px-5 py-3 tabular">{fmt$(u.rent_amount)}</td>
                    <td className="px-5 py-3">
                      {u.amount_due
                        ? u.amount_paid
                          ? <span className={u.amount_paid < u.amount_due ? 'text-amber-600' : 'text-green-600'}>{fmt$(u.amount_paid)} {u.amount_paid < u.amount_due ? '(partial)' : '✓'}</span>
                          : <span className="text-red-600">Unpaid {fmt$(u.amount_due)}</span>
                        : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-5 py-3 text-gray-500">{u.lease_end_date ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── RENT ── */}
      {tab === 'rent' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Rent Collection</h2>
            <div className="flex gap-2">
              <label className="cursor-pointer rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                Import BofA CSV
                <input type="file" accept=".csv" className="hidden" onChange={async e => {
                  const file = e.target.files?.[0]; if (!file) return;
                  const form = new FormData(); form.append('file', file);
                  const res = await fetch('/api/v2/rent', { method: 'PUT', body: form });
                  const data = await res.json();
                  alert(`Found ${data.count} credit transactions. Manual matching coming soon.`);
                }} />
              </label>
              <Link href={`/properties/${id}/rent/new`} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">+ Add Payment</Link>
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>{['Unit','Due Date','Expected','Paid','Status','Late Fee','Source'].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {rent.length === 0
                  ? <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No rent records yet</td></tr>
                  : rent.map(r => (
                    <tr key={r.id}>
                      <td className="px-4 py-3 font-medium">{r.unit_label}</td>
                      <td className="px-4 py-3 tabular">{r.due_date}</td>
                      <td className="px-4 py-3 tabular">{fmt$(r.amount_due)}</td>
                      <td className="px-4 py-3 tabular">{fmt$(r.amount_paid)}</td>
                      <td className="px-4 py-3">
                        {!r.amount_paid ? <span className="text-red-600 font-medium">Unpaid</span>
                          : r.is_partial ? <span className="text-amber-600 font-medium">Partial</span>
                          : r.is_late ? <span className="text-amber-600 font-medium">Late</span>
                          : <span className="text-green-600 font-medium">Paid</span>}
                      </td>
                      <td className="px-4 py-3 tabular">{fmt$(r.late_fee_charged)}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{r.source}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── LEASES ── */}
      {tab === 'leases' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Lease History</h2>
            <div className="flex gap-2">
              <label className={`cursor-pointer rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800 ${uploading ? 'opacity-50' : ''}`}>
                {uploading ? 'Parsing…' : 'Upload Lease PDF'}
                <input type="file" accept=".pdf" className="hidden" disabled={uploading} onChange={async e => {
                  const file = e.target.files?.[0]; if (!file) return;
                  const extracted = await uploadPdf(file, 'lease');
                  if (extracted) { setLeaseExtracted(extracted); setLeaseConfirmUnit(''); setLeaseConfirmTenant(''); }
                  e.target.value = '';
                }} />
              </label>
              <Link href={`/properties/${id}/leases/new`} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">+ Add Manually</Link>
            </div>
          </div>

          {/* ── EXTRACTION REVIEW PANEL ── */}
          {leaseExtracted && (
            <div className="rounded-xl border-2 border-blue-300 bg-blue-50 p-5 dark:border-blue-700 dark:bg-blue-950/20">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold text-blue-800 dark:text-blue-300">✦ AI Extracted — Review & Confirm</h3>
                <button onClick={() => setLeaseExtracted(null)} className="text-xs text-gray-400 hover:text-gray-600">Discard</button>
              </div>

              {leaseExtracted.confidence_notes && (
                <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                  ⚠ {leaseExtracted.confidence_notes}
                </p>
              )}

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Field label="Lease Start" value={leaseExtracted.start_date} />
                <Field label="Lease End" value={leaseExtracted.end_date} />
                <Field label="Monthly Rent" value={leaseExtracted.rent_amount ? fmt$(leaseExtracted.rent_amount) : null} />
                <Field label="Security Deposit" value={leaseExtracted.security_deposit ? fmt$(leaseExtracted.security_deposit) : null} />
                <Field label="Late Fee" value={leaseExtracted.late_fee_amount ? fmt$(leaseExtracted.late_fee_amount) : null} />
                <Field label="Grace Period" value={leaseExtracted.late_fee_grace_days ? `${leaseExtracted.late_fee_grace_days} days` : null} />
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Tags label="Landlord pays" items={leaseExtracted.utilities_landlord} />
                <Tags label="Tenant pays" items={leaseExtracted.utilities_tenant} />
                <Tags label="Equipment included" items={leaseExtracted.equipment_included} />
              </div>

              {/* Assign to unit + tenant */}
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Assign to Unit *</label>
                  <select value={leaseConfirmUnit} onChange={e => setLeaseConfirmUnit(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800">
                    <option value="">Select unit…</option>
                    {units.map(u => <option key={u.id} value={u.id}>Unit {u.unit_label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Assign to Tenant *</label>
                  <select value={leaseConfirmTenant} onChange={e => setLeaseConfirmTenant(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800">
                    <option value="">Select tenant…</option>
                    {activeTenants.map(u => <option key={u.tenant_id} value={u.tenant_id!}>{u.tenant_name} (Unit {u.unit_label})</option>)}
                  </select>
                  {activeTenants.length === 0 && (
                    <p className="mt-1 text-xs text-amber-600">No tenants yet — <Link href={`/properties/${id}/tenants/new`} className="underline">add one first</Link></p>
                  )}
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <button onClick={confirmLease} disabled={leaseSaving || !leaseConfirmUnit || !leaseConfirmTenant}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {leaseSaving ? 'Saving…' : 'Confirm & Save Lease'}
                </button>
                <Link href={`/properties/${id}/leases/new`} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                  Edit Manually Instead
                </Link>
              </div>
            </div>
          )}

          {/* Saved leases */}
          <div className="space-y-3">
            {leases.length === 0 && !leaseExtracted
              ? <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-400 dark:border-gray-700">No leases yet. Upload a PDF or add manually.</div>
              : leases.map(l => (
                <div key={l.id} className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="font-medium">{l.tenant_name}</span>
                      <span className="ml-2 text-sm text-gray-500">· Unit {l.unit_label}</span>
                      {l.extracted_by_ai && <span className="ml-2 rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">AI parsed</span>}
                    </div>
                    <span className="text-sm font-medium tabular">{fmt$(l.rent_amount)}/mo</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-4 text-sm text-gray-500">
                    <span>{l.start_date} → {l.end_date}</span>
                    {l.security_deposit && <span>Deposit: {fmt$(l.security_deposit)}</span>}
                  </div>
                  {l.utilities_landlord && (
                    <p className="mt-1 text-xs text-gray-400">Landlord pays: {JSON.parse(l.utilities_landlord).join(', ')}</p>
                  )}
                  {l.equipment_included && (
                    <p className="mt-1 text-xs text-gray-400">Included: {JSON.parse(l.equipment_included).join(', ')}</p>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ── WORK ORDERS ── */}
      {tab === 'work-orders' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Work Orders</h2>
            <div className="flex gap-2">
              <label className={`cursor-pointer rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800 ${uploading ? 'opacity-50' : ''}`}>
                {uploading ? 'Parsing…' : 'Upload PDF/Invoice'}
                <input type="file" accept=".pdf" className="hidden" disabled={uploading} onChange={async e => {
                  const file = e.target.files?.[0]; if (!file) return;
                  const extracted = await uploadPdf(file, 'work_order');
                  if (extracted) setWoExtracted(extracted);
                  e.target.value = '';
                }} />
              </label>
              <Link href={`/properties/${id}/work-orders/new`} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">+ New Work Order</Link>
            </div>
          </div>

          {woExtracted && (
            <div className="rounded-xl border-2 border-blue-300 bg-blue-50 p-5 dark:border-blue-700 dark:bg-blue-950/20">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold text-blue-800 dark:text-blue-300">✦ AI Extracted — Review & Confirm</h3>
                <button onClick={() => setWoExtracted(null)} className="text-xs text-gray-400 hover:text-gray-600">Discard</button>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field label="Vendor" value={woExtracted.vendor_name} />
                <Field label="Category" value={woExtracted.category} />
                <Field label="Date" value={woExtracted.date_received} />
                <Field label="Quoted Cost" value={woExtracted.quoted_cost ? fmt$(woExtracted.quoted_cost) : null} />
                <Field label="Actual Cost" value={woExtracted.actual_cost ? fmt$(woExtracted.actual_cost) : null} />
              </div>
              {woExtracted.description && <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">{woExtracted.description}</p>}
              <div className="mt-4">
                <Link href={`/properties/${id}/work-orders/new?prefill=${encodeURIComponent(JSON.stringify(woExtracted))}`}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                  Continue to Work Order Form →
                </Link>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {workOrders.length === 0 && !woExtracted
              ? <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-400 dark:border-gray-700">No work orders yet.</div>
              : workOrders.map(wo => (
                <div key={wo.id} className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{wo.vendor_name}</span>
                        <span className="text-xs text-gray-400">{wo.vendor_trade}</span>
                        <StatusBadge status={wo.status} />
                        {wo.unit_label && <span className="text-xs text-gray-400">Unit {wo.unit_label}</span>}
                      </div>
                      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{wo.description}</p>
                      <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-400">
                        <span>Received {wo.date_received}</span>
                        {wo.date_completed && <span>Completed {wo.date_completed}</span>}
                        {wo.quoted_cost && <span>Quote: {fmt$(wo.quoted_cost)}</span>}
                        {wo.actual_cost && <span>Actual: {fmt$(wo.actual_cost)}</span>}
                      </div>
                    </div>
                    <Stars rating={wo.rating} />
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ── ESCROW ── */}
      {tab === 'escrow' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Escrow</h2>
            <label className={`cursor-pointer rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 ${uploading ? 'opacity-50' : ''}`}>
              {uploading ? 'Parsing…' : 'Upload Escrow Statement'}
              <input type="file" accept=".pdf" className="hidden" disabled={uploading} onChange={async e => {
                const file = e.target.files?.[0]; if (!file) return;
                const extracted = await uploadPdf(file, 'escrow');
                if (extracted) { setEscrowExtracted(extracted); setEscrowConfirmLender(''); }
                e.target.value = '';
              }} />
            </label>
          </div>

          {escrowExtracted && (
            <div className="rounded-xl border-2 border-blue-300 bg-blue-50 p-5 dark:border-blue-700 dark:bg-blue-950/20">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold text-blue-800 dark:text-blue-300">✦ AI Extracted — Review & Confirm</h3>
                <button onClick={() => setEscrowExtracted(null)} className="text-xs text-gray-400 hover:text-gray-600">Discard</button>
              </div>
              {escrowExtracted.confidence_notes && (
                <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">⚠ {escrowExtracted.confidence_notes}</p>
              )}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Field label="Statement Date" value={escrowExtracted.statement_date} />
                <Field label="Period Start" value={escrowExtracted.analysis_period_start} />
                <Field label="Period End" value={escrowExtracted.analysis_period_end} />
                <Field label="New Monthly Escrow" value={escrowExtracted.new_monthly_escrow ? fmt$(escrowExtracted.new_monthly_escrow) : null} />
                <Field label="Projected" value={escrowExtracted.projected_requirement ? fmt$(escrowExtracted.projected_requirement) : null} />
                <Field label="Actual Disbursed" value={escrowExtracted.actual_disbursements ? fmt$(escrowExtracted.actual_disbursements) : null} />
                <Field label="Shortage / Surplus" value={escrowExtracted.shortage_surplus_amount != null ? `${escrowExtracted.shortage_surplus_amount < 0 ? '-' : '+'}${fmt$(escrowExtracted.shortage_surplus_amount)}` : null} />
              </div>
              <div className="mt-4">
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Lender Name *</label>
                <input type="text" value={escrowConfirmLender} onChange={e => setEscrowConfirmLender(e.target.value)}
                  placeholder="e.g. Rocket Mortgage"
                  className="w-full max-w-xs rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800" />
              </div>
              <button onClick={confirmEscrow} disabled={escrowSaving || !escrowConfirmLender}
                className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {escrowSaving ? 'Saving…' : 'Confirm & Save'}
              </button>
            </div>
          )}

          <div className="space-y-3">
            {escrow.length === 0 && !escrowExtracted
              ? <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-400 dark:border-gray-700">No escrow accounts yet. Upload an annual escrow statement to get started.</div>
              : escrow.map(e => (
                <div key={e.id} className="rounded-xl border border-gray-200 p-5 dark:border-gray-800">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium">{e.lender_name}</p>
                      {e.loan_number && <p className="text-sm text-gray-500">Loan #{e.loan_number}</p>}
                    </div>
                    {e.new_monthly_escrow && (
                      <div className="text-right">
                        <p className="text-xs text-gray-500">New monthly escrow</p>
                        <p className="font-semibold tabular">{fmt$(e.new_monthly_escrow)}</p>
                      </div>
                    )}
                  </div>
                  {e.statement_date && (
                    <div className="mt-4 grid grid-cols-3 gap-4 rounded-lg bg-gray-50 p-4 text-sm dark:bg-gray-900">
                      <div><p className="text-xs text-gray-500">Projected</p><p className="font-medium tabular">{fmt$(e.projected_requirement)}</p></div>
                      <div><p className="text-xs text-gray-500">Actual</p><p className="font-medium tabular">{fmt$(e.actual_disbursements)}</p></div>
                      <div>
                        <p className="text-xs text-gray-500">Shortage / Surplus</p>
                        <p className={`font-medium tabular ${(e.shortage_surplus_amount ?? 0) < 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {e.shortage_surplus_amount != null ? `${e.shortage_surplus_amount < 0 ? '-' : '+'}${fmt$(e.shortage_surplus_amount)}` : '—'}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ── INSURANCE ── */}
      {tab === 'insurance' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Insurance Policies</h2>
            <label className={`cursor-pointer rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 ${uploading ? 'opacity-50' : ''}`}>
              {uploading ? 'Parsing…' : 'Upload Policy PDF'}
              <input type="file" accept=".pdf" className="hidden" disabled={uploading} onChange={async e => {
                const file = e.target.files?.[0]; if (!file) return;
                const extracted = await uploadPdf(file, 'insurance');
                if (extracted) setInsuranceExtracted(extracted);
                e.target.value = '';
              }} />
            </label>
          </div>

          {insuranceExtracted && (
            <div className="rounded-xl border-2 border-blue-300 bg-blue-50 p-5 dark:border-blue-700 dark:bg-blue-950/20">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold text-blue-800 dark:text-blue-300">✦ AI Extracted — Review & Confirm</h3>
                <button onClick={() => setInsuranceExtracted(null)} className="text-xs text-gray-400 hover:text-gray-600">Discard</button>
              </div>
              {insuranceExtracted.confidence_notes && (
                <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">⚠ {insuranceExtracted.confidence_notes}</p>
              )}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Field label="Carrier" value={insuranceExtracted.carrier} />
                <Field label="Policy Type" value={insuranceExtracted.policy_type} />
                <Field label="Policy #" value={insuranceExtracted.policy_number} />
                <Field label="Effective Date" value={insuranceExtracted.effective_date} />
                <Field label="Expiration Date" value={insuranceExtracted.expiration_date} />
                <Field label="Annual Premium" value={insuranceExtracted.annual_premium ? fmt$(insuranceExtracted.annual_premium) : null} />
                <Field label="Deductible" value={insuranceExtracted.deductible ? fmt$(insuranceExtracted.deductible) : null} />
                <Field label="Coverage Limit" value={insuranceExtracted.coverage_limit ? fmt$(insuranceExtracted.coverage_limit) : null} />
              </div>
              {insuranceExtracted.coverage_notes && (
                <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">{insuranceExtracted.coverage_notes}</p>
              )}
              <button onClick={confirmInsurance} disabled={insuranceSaving}
                className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {insuranceSaving ? 'Saving…' : 'Confirm & Save Policy'}
              </button>
            </div>
          )}

          <div className="space-y-3">
            {insurance.length === 0 && !insuranceExtracted
              ? <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-400 dark:border-gray-700">No insurance policies yet. Upload a policy PDF to get started.</div>
              : insurance.map(p => {
                const daysLeft = Math.ceil((new Date(p.expiration_date).getTime() - Date.now()) / 86400000);
                return (
                  <div key={p.id} className="rounded-xl border border-gray-200 p-5 dark:border-gray-800">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{p.carrier}</p>
                          {p.policy_type && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">{p.policy_type}</span>}
                          {p.extracted_by_ai && <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">AI parsed</span>}
                        </div>
                        <p className="mt-1 text-sm text-gray-500">{p.effective_date} → {p.expiration_date}</p>
                      </div>
                      <p className={`text-sm font-medium ${daysLeft <= 60 ? 'text-amber-600' : 'text-gray-500'}`}>
                        {daysLeft <= 0 ? 'Expired' : daysLeft <= 60 ? `Expires in ${daysLeft}d` : `${daysLeft}d remaining`}
                      </p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-6 text-sm">
                      {p.annual_premium && <div><span className="text-xs text-gray-500">Premium</span><p className="font-medium tabular">{fmt$(p.annual_premium)}/yr</p></div>}
                      {p.deductible && <div><span className="text-xs text-gray-500">Deductible</span><p className="font-medium tabular">{fmt$(p.deductible)}</p></div>}
                    </div>
                    {p.coverage_notes && <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{p.coverage_notes}</p>}
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </>
  );
}
