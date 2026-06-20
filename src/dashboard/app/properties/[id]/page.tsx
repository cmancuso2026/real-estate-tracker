'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';

type Tab = 'overview' | 'tenants' | 'rent' | 'leases' | 'work-orders' | 'escrow' | 'insurance';

interface Property { id: number; address: string; city: string; state: string; property_type: string; unit_count: number; }
interface Unit { id: number; unit_label: string; tenant_name: string | null; tenant_id: number | null; rent_amount: number | null; lease_start_date: string | null; lease_end_date: string | null; amount_due: number | null; amount_paid: number | null; is_late: boolean | null; }
interface RentRow { id: number; unit_label: string; due_date: string; amount_due: number; paid_date: string | null; amount_paid: number | null; is_partial: boolean; is_late: boolean; late_fee_charged: number | null; source: string; }
interface WorkOrder { id: number; vendor_name: string; vendor_trade: string; category: string; description: string; status: string; date_received: string; date_completed: string | null; quoted_cost: number | null; actual_cost: number | null; rating: number | null; unit_label: string | null; }
interface Lease { id: number; unit_label: string; tenant_name: string; start_date: string; end_date: string; rent_amount: number; security_deposit: number | null; late_fee_amount: number | null; late_fee_grace_days: number | null; utilities_landlord: string | null; utilities_tenant: string | null; equipment_included: string | null; extracted_by_ai: boolean; }
interface EscrowAccount { id: number; lender_name: string; loan_number: string | null; statement_date: string | null; projected_requirement: number | null; actual_disbursements: number | null; shortage_surplus_amount: number | null; new_monthly_escrow: number | null; }
interface InsurancePolicy { id: number; carrier: string; policy_type: string | null; effective_date: string; expiration_date: string; annual_premium: number | null; deductible: number | null; coverage_notes: string | null; extracted_by_ai: boolean; }
interface ExistingTenant { id: number; first_name: string; last_name: string; unit_id: number; unit_label: string; phone: string | null; email: string | null; is_active: boolean; notes: string | null; }

interface LeaseExtracted {
  tenant_first_name: string | null; tenant_last_name: string | null;
  start_date: string | null; end_date: string | null; rent_amount: number | null;
  security_deposit: number | null; late_fee_amount: number | null; late_fee_grace_days: number | null;
  utilities_landlord: string[]; utilities_tenant: string[]; equipment_included: string[];
  confidence_notes: string | null;
}
interface EscrowExtracted { statement_date: string | null; analysis_period_start: string | null; analysis_period_end: string | null; projected_requirement: number | null; actual_disbursements: number | null; shortage_surplus_amount: number | null; new_monthly_escrow: number | null; confidence_notes: string | null; }
interface InsuranceExtracted { carrier: string | null; policy_number: string | null; policy_type: string | null; effective_date: string | null; expiration_date: string | null; renewal_period_days: number | null; annual_premium: number | null; deductible: number | null; coverage_limit: number | null; coverage_notes: string | null; confidence_notes: string | null; }
interface WorkOrderExtracted { vendor_name: string | null; category: string | null; description: string | null; date_received: string | null; quoted_cost: number | null; actual_cost: number | null; confidence_notes: string | null; }

const UTILITIES = ['electric','gas','water','trash','sewer','internet'];
const EQUIPMENT = ['refrigerator','stove','dishwasher','washer','dryer','HVAC','microwave','A/C window unit'];

function fmt$(n: number | null | undefined) { return n == null ? '—' : '$' + Math.abs(n).toLocaleString(); }
function StatusBadge({ status }: { status: string }) {
  const c: Record<string,string> = { received:'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400', open:'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', complete:'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c[status]??c.received}`}>{status}</span>;
}
function Stars({ rating }: { rating: number | null }) {
  if (!rating) return <span className="text-gray-400 text-xs">Unrated</span>;
  return <span className="text-amber-500">{'★'.repeat(rating)}{'☆'.repeat(5-rating)}</span>;
}
function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return <div><p className="text-xs text-gray-500">{label}</p><p className="font-medium">{value ?? <span className="italic text-gray-400 text-sm">Not found</span>}</p></div>;
}
function Tags({ label, items, color='blue' }: { label: string; items: string[]; color?: string }) {
  const cls = color === 'green' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : color === 'purple' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
  return <div><p className="text-xs text-gray-500 mb-1">{label}</p>{items.length===0?<span className="italic text-gray-400 text-sm">None</span>:<div className="flex flex-wrap gap-1">{items.map(i=><span key={i} className={`rounded-full px-2 py-0.5 text-xs ${cls}`}>{i}</span>)}</div>}</div>;
}
function ToggleChip({ label, active, onClick, color='blue' }: { label: string; active: boolean; onClick: ()=>void; color?: string }) {
  const on = color==='green' ? 'bg-green-600 text-white' : color==='purple' ? 'bg-purple-600 text-white' : 'bg-blue-600 text-white';
  return <button type="button" onClick={onClick} className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${active ? on : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400'}`}>{label}</button>;
}
function Input({ label, value, onChange, type='text', placeholder='' }: { label: string; value: string; onChange:(v:string)=>void; type?: string; placeholder?: string }) {
  return <div><label className="mb-1 block text-xs font-medium text-gray-500">{label}</label><input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800" /></div>;
}

const TABS: {id:Tab;label:string}[] = [{id:'overview',label:'Overview'},{id:'tenants',label:'Tenants'},{id:'rent',label:'Rent'},{id:'leases',label:'Leases'},{id:'tenants',label:'Tenants'},{id:'work-orders',label:'Work Orders'},{id:'escrow',label:'Escrow'},{id:'insurance',label:'Insurance'}];

// Lease edit form — shared between "review extracted" and "edit existing"
function LeaseForm({
  data, onChange, units, existingTenants,
  tenantMode, setTenantMode,
  tenantFirstName, setTenantFirstName,
  tenantLastName, setTenantLastName,
  selectedTenantId, setSelectedTenantId,
  selectedUnitId, setSelectedUnitId,
  showTenantFields,
}: {
  data: Partial<LeaseExtracted>;
  onChange: (patch: Partial<LeaseExtracted>) => void;
  units: Unit[];
  existingTenants: ExistingTenant[];
  tenantMode: 'new' | 'existing';
  setTenantMode: (m: 'new'|'existing') => void;
  tenantFirstName: string; setTenantFirstName: (v:string)=>void;
  tenantLastName: string; setTenantLastName: (v:string)=>void;
  selectedTenantId: string; setSelectedTenantId: (v:string)=>void;
  selectedUnitId: string; setSelectedUnitId: (v:string)=>void;
  showTenantFields: boolean;
}) {
  const toggle = (field: 'utilities_landlord'|'utilities_tenant'|'equipment_included', val: string) => {
    const arr = (data[field] as string[]) ?? [];
    onChange({ [field]: arr.includes(val) ? arr.filter(v=>v!==val) : [...arr, val] });
  };

  return (
    <div className="space-y-4">
      {/* Tenant assignment */}
      {showTenantFields && (
        <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-800/50">
          <p className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-400">Tenant</p>
          <div className="mb-3 flex gap-2">
            <button onClick={()=>setTenantMode('new')} className={`rounded-full px-3 py-1 text-xs font-medium ${tenantMode==='new'?'bg-blue-600 text-white':'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}`}>New tenant</button>
            <button onClick={()=>setTenantMode('existing')} className={`rounded-full px-3 py-1 text-xs font-medium ${tenantMode==='existing'?'bg-blue-600 text-white':'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}`}>Existing tenant</button>
          </div>
          {tenantMode==='new' ? (
            <div className="grid grid-cols-2 gap-3">
              <Input label="First Name *" value={tenantFirstName} onChange={setTenantFirstName} />
              <Input label="Last Name *" value={tenantLastName} onChange={setTenantLastName} />
            </div>
          ) : (
            <select value={selectedTenantId} onChange={e=>setSelectedTenantId(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800">
              <option value="">Select existing tenant…</option>
              {existingTenants.map(t=><option key={t.id} value={t.id}>{t.first_name} {t.last_name} (Unit {t.unit_label})</option>)}
            </select>
          )}
        </div>
      )}

      {/* Unit */}
      {showTenantFields && (
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Unit *</label>
          <select value={selectedUnitId} onChange={e=>setSelectedUnitId(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800">
            <option value="">Select unit…</option>
            {units.map(u=><option key={u.id} value={u.id}>Unit {u.unit_label}</option>)}
          </select>
        </div>
      )}

      {/* Dates & financials */}
      <div className="grid grid-cols-2 gap-3">
        <Input label="Lease Start" type="date" value={data.start_date??''} onChange={v=>onChange({start_date:v})} />
        <Input label="Lease End" type="date" value={data.end_date??''} onChange={v=>onChange({end_date:v})} />
        <Input label="Monthly Rent ($)" type="number" value={data.rent_amount?.toString()??''} onChange={v=>onChange({rent_amount:v?parseInt(v):null})} placeholder="1500" />
        <Input label="Security Deposit ($)" type="number" value={data.security_deposit?.toString()??''} onChange={v=>onChange({security_deposit:v?parseInt(v):null})} placeholder="1500" />
        <Input label="Late Fee ($)" type="number" value={data.late_fee_amount?.toString()??''} onChange={v=>onChange({late_fee_amount:v?parseInt(v):null})} placeholder="75" />
        <Input label="Grace Period (days)" type="number" value={data.late_fee_grace_days?.toString()??''} onChange={v=>onChange({late_fee_grace_days:v?parseInt(v):null})} placeholder="5" />
      </div>

      {/* Utilities */}
      <div>
        <p className="mb-2 text-xs font-medium text-gray-500">Landlord pays</p>
        <div className="flex flex-wrap gap-2">{UTILITIES.map(u=><ToggleChip key={u} label={u} active={(data.utilities_landlord??[]).includes(u)} onClick={()=>toggle('utilities_landlord',u)} />)}</div>
      </div>
      <div>
        <p className="mb-2 text-xs font-medium text-gray-500">Tenant pays</p>
        <div className="flex flex-wrap gap-2">{UTILITIES.map(u=><ToggleChip key={u} label={u} active={(data.utilities_tenant??[]).includes(u)} onClick={()=>toggle('utilities_tenant',u)} color="green" />)}</div>
      </div>
      <div>
        <p className="mb-2 text-xs font-medium text-gray-500">Equipment included</p>
        <div className="flex flex-wrap gap-2">{EQUIPMENT.map(e=><ToggleChip key={e} label={e} active={(data.equipment_included??[]).includes(e)} onClick={()=>toggle('equipment_included',e)} color="purple" />)}</div>
      </div>
    </div>
  );
}

export default function PropertyDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = params.id as string;

  const [tab, setTab] = useState<Tab>((searchParams.get('tab') as Tab)?? 'overview');
  const [property, setProperty] = useState<Property | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [rent, setRent] = useState<RentRow[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [escrow, setEscrow] = useState<EscrowAccount[]>([]);
  const [insurance, setInsurance] = useState<InsurancePolicy[]>([]);
  const [existingTenants, setExistingTenants] = useState<ExistingTenant[]>([]);
  const [editingTenant, setEditingTenant] = useState<ExistingTenant | null>(null);
  const [deletingTenantId, setDeletingTenantId] = useState<number|null>(null);
  const [tenantSaving, setTenantSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deletingTenantId, setDeletingTenantId] = useState<number|null>(null);
  const [editingTenant, setEditingTenant] = useState<ExistingTenant|null>(null);
  const [editTenantForm, setEditTenantForm] = useState({first_name:'',last_name:'',email:'',phone:'',notes:''});
  const [tenantSaving, setTenantSaving] = useState(false);
  const [uploadingLease, setUploadingLease] = useState(false);
  const [uploadingWO, setUploadingWO] = useState(false);
  const [uploadingEscrow, setUploadingEscrow] = useState(false);
  const [uploadingInsurance, setUploadingInsurance] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Lease extraction state
  const [leaseExtracted, setLeaseExtracted] = useState<Partial<LeaseExtracted> | null>(null);
  const [leaseTenantMode, setLeaseTenantMode] = useState<'new'|'existing'>('new');
  const [leaseTenantFirst, setLeaseTenantFirst] = useState('');
  const [leaseTenantLast, setLeaseTenantLast] = useState('');
  const [leaseSelectedTenant, setLeaseSelectedTenant] = useState('');
  const [leaseSelectedUnit, setLeaseSelectedUnit] = useState('');
  const [leaseSaving, setLeaseSaving] = useState(false);
  const leaseSavingRef = useRef(false);

  // Lease edit state
  const [editingLease, setEditingLease] = useState<Lease | null>(null);
  const [editLeaseData, setEditLeaseData] = useState<Partial<LeaseExtracted>>({});
  const [editSaving, setEditSaving] = useState(false);
  const editSavingRef = useRef(false);
  const [deletingLeaseId, setDeletingLeaseId] = useState<number|null>(null);

  // Escrow state
  const [escrowExtracted, setEscrowExtracted] = useState<EscrowExtracted | null>(null);
  const [escrowLender, setEscrowLender] = useState('');
  const [escrowSaving, setEscrowSaving] = useState(false);

  // Insurance state
  const [insuranceExtracted, setInsuranceExtracted] = useState<InsuranceExtracted | null>(null);
  const [insuranceSaving, setInsuranceSaving] = useState(false);

  // Work order state
  const [woExtracted, setWoExtracted] = useState<WorkOrderExtracted | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [propRes, unitsRes, tenantsRes] = await Promise.all([
      fetch(`/api/v2/properties`),
      fetch(`/api/v2/units?propertyId=${id}`),
      fetch(`/api/v2/tenants?propertyId=${id}`),
    ]);
    const props: Property[] = await propRes.json();
    setProperty(props.find(p => String(p.id) === id) ?? null);
    setUnits(await unitsRes.json());
    setExistingTenants(await tenantsRes.json());
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
      const res = await fetch(`/api/v2/leases?propertyId=${id}`);
      setLeases(await res.json());
    } else if (t === 'escrow') {
      const res = await fetch(`/api/v2/escrow?propertyId=${id}`);
      setEscrow(await res.json());
    } else if (t === 'insurance') {
      const res = await fetch(`/api/v2/insurance?propertyId=${id}`);
      setInsurance(await res.json());
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!loading) loadTab(tab); }, [tab, loading, loadTab]);

  const switchTab = (t: Tab) => { setTab(t); router.replace(`/properties/${id}?tab=${t}`, { scroll: false }); };

  async function uploadPdf(file: File, type: string, setFlag: (v:boolean)=>void) {
    setFlag(true); setUploadError('');
    const form = new FormData(); form.append('file', file); form.append('type', type);
    const res = await fetch('/api/v2/upload', { method: 'POST', body: form });
    const data = await res.json();
    setFlag(false);
    if (!res.ok) { setUploadError('Upload failed: ' + (data.error ?? 'unknown')); return null; }
    return data.extracted;
  }

  async function confirmLease() {
    if (!leaseExtracted || leaseSaving) return;
    setLeaseSaving(true);
    setLeaseExtracted(null); // hide panel immediately

    const snapshot = { ...leaseExtracted };
    const unitId = leaseSelectedUnit;

    let tenantId = leaseSelectedTenant ? parseInt(leaseSelectedTenant) : null;

    if (leaseTenantMode === 'new' && leaseTenantFirst && leaseTenantLast && unitId) {
      const res = await fetch('/api/v2/tenants', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_id: parseInt(unitId), first_name: leaseTenantFirst, last_name: leaseTenantLast, payment_method: 'zelle', is_active: true }),
      });
      const tenant = await res.json();
      tenantId = tenant.id;
    }

    if (tenantId && unitId) {
      await fetch('/api/v2/leases', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId, unit_id: parseInt(unitId),
          start_date: snapshot.start_date, end_date: snapshot.end_date,
          rent_amount: snapshot.rent_amount, security_deposit: snapshot.security_deposit,
          late_fee_amount: snapshot.late_fee_amount, late_fee_grace_days: snapshot.late_fee_grace_days,
          utilities_landlord: snapshot.utilities_landlord ?? [],
          utilities_tenant: snapshot.utilities_tenant ?? [],
          equipment_included: snapshot.equipment_included ?? [],
          extracted_by_ai: true, ai_confidence_notes: snapshot.confidence_notes,
        }),
      });
    }

    setLeaseSaving(false);
    await load();
    await loadTab('leases');
  }

  function startEditLease(lease: Lease) {
    setEditingLease(lease);
    setEditLeaseData({
      start_date: lease.start_date, end_date: lease.end_date,
      rent_amount: lease.rent_amount, security_deposit: lease.security_deposit,
      late_fee_amount: lease.late_fee_amount, late_fee_grace_days: lease.late_fee_grace_days,
      utilities_landlord: lease.utilities_landlord ? JSON.parse(lease.utilities_landlord) : [],
      utilities_tenant: lease.utilities_tenant ? JSON.parse(lease.utilities_tenant) : [],
      equipment_included: lease.equipment_included ? JSON.parse(lease.equipment_included) : [],
    });
  }

  async function saveEditLease() {
    if (!editingLease || editSavingRef.current) return;
    editSavingRef.current = true;
    setEditSaving(true);
    await fetch(`/api/v2/leases/${editingLease.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editLeaseData),
    });
    setEditingLease(null); setEditSaving(false); editSavingRef.current = false;
    loadTab('leases');
  }

  async function deleteLease(leaseId: number) {
    if (!confirm('Delete this lease? This cannot be undone.')) return;
    setDeletingLeaseId(leaseId);
    await fetch(`/api/v2/leases/${leaseId}`, { method: 'DELETE' });
    setDeletingLeaseId(null);
    loadTab('leases');
  }

  async function deleteTenant(tenantId: number) {
    if (!confirm('Delete this tenant and all their leases? This cannot be undone.')) return;
    setDeletingTenantId(tenantId);
    await fetch(`/api/v2/tenants/${tenantId}`, { method: 'DELETE' });
    setDeletingTenantId(null);
    await load();
  }

  function startEditTenant(t: ExistingTenant) {
    setEditingTenant(t);
    setEditTenantForm({ first_name: t.first_name, last_name: t.last_name, email: '', phone: '', notes: '' });
  }

  async function saveEditTenant() {
    if (!editingTenant || tenantSaving) return;
    setTenantSaving(true);
    await fetch(`/api/v2/tenants/${editingTenant.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editTenantForm),
    });
    setEditingTenant(null); setTenantSaving(false);
    await load();
  }

  async function confirmEscrow() {
    if (!escrowExtracted) return;
    setEscrowSaving(true);
    const accRes = await fetch('/api/v2/escrow', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ property_id: parseInt(id), lender_name: escrowLender || 'Unknown Lender' }),
    });
    const acc = await accRes.json();
    await fetch('/api/v2/escrow/statement', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...escrowExtracted, escrow_account_id: acc.id, extracted_by_ai: true }),
    });
    setEscrowExtracted(null); setEscrowSaving(false); loadTab('escrow');
  }

  async function confirmInsurance() {
    if (!insuranceExtracted) return;
    setInsuranceSaving(true);
    await fetch('/api/v2/insurance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...insuranceExtracted, property_id: parseInt(id), extracted_by_ai: true }),
    });
    setInsuranceExtracted(null); setInsuranceSaving(false); loadTab('insurance');
  }

  if (loading) return <div className="py-20 text-center text-gray-400">Loading…</div>;
  if (!property) return <div className="py-20 text-center text-gray-400">Property not found.</div>;

  return (
    <>
      <div className="mb-6">
        <Link href="/properties" className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">← My Properties</Link>
        <h1 className="mt-1 text-2xl font-bold">{property.address}</h1>
        <p className="text-sm text-gray-500">{property.city}, {property.state} · {property.property_type} · {property.unit_count} units</p>
      </div>

      <div className="mb-6 flex gap-1 border-b border-gray-200 dark:border-gray-800">
        {TABS.map(t => (
          <button key={t.id} onClick={() => switchTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${tab===t.id?'border-b-2 border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400':'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {uploadError && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">{uploadError}</div>}

      {/* ── OVERVIEW ── */}
      {tab==='overview' && (
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
              <thead className="bg-gray-50 dark:bg-gray-900"><tr>{['Unit','Tenant','Rent/mo','This Month','Lease Status'].map(h=><th key={h} className="px-5 py-3 text-left text-xs font-medium text-gray-500">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {units.map(u=>{
                  const today = new Date().toISOString().slice(0,10);
                  const isActive = u.lease_start_date && u.lease_end_date && u.lease_start_date <= today && u.lease_end_date >= today;
                  const isExpired = u.lease_end_date && u.lease_end_date < today;
                  const daysLeft = u.lease_end_date ? Math.ceil((new Date(u.lease_end_date).getTime()-Date.now())/86400000) : null;
                  return (
                  <tr key={u.id}>
                    <td className="px-5 py-3 font-medium">{u.unit_label}</td>
                    <td className="px-5 py-3">{u.tenant_name??<span className="italic text-gray-400">Vacant</span>}</td>
                    <td className="px-5 py-3 tabular">{fmt$(u.rent_amount)}</td>
                    <td className="px-5 py-3">{u.amount_due?u.amount_paid?<span className={u.amount_paid<u.amount_due?'text-amber-600':'text-green-600'}>{fmt$(u.amount_paid)} {u.amount_paid<u.amount_due?'(partial)':'✓'}</span>:<span className="text-red-600">Unpaid {fmt$(u.amount_due)}</span>:<span className="text-gray-400">No record</span>}</td>
                    <td className="px-5 py-3">
                      {!u.lease_end_date ? <span className="text-gray-400 italic">No lease</span> : (
                        <div className="flex items-center gap-2">
                          {isActive && daysLeft !== null && daysLeft <= 60
                            ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Expires in {daysLeft}d</span>
                            : isActive
                            ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Active</span>
                            : isExpired
                            ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">Expired</span>
                            : <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-600">Upcoming</span>
                          }
                          <span className="text-gray-500 text-xs">{u.lease_start_date} → {u.lease_end_date}</span>
                        </div>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── RENT ── */}
      {tab==='rent' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Rent Collection</h2>
            <div className="flex gap-2">
              <label className="cursor-pointer rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                Import BofA CSV
                <input type="file" accept=".csv" className="hidden" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;const form=new FormData();form.append('file',file);const res=await fetch('/api/v2/rent',{method:'PUT',body:form});const data=await res.json();alert(`Found ${data.count} credit transactions.`);}} />
              </label>
              <Link href={`/properties/${id}/rent/new`} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">+ Add Payment</Link>
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900"><tr>{['Unit','Due Date','Expected','Paid','Status','Late Fee','Source'].map(h=><th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {rent.length===0?<tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No rent records yet</td></tr>:rent.map(r=>(
                  <tr key={r.id}>
                    <td className="px-4 py-3 font-medium">{r.unit_label}</td>
                    <td className="px-4 py-3 tabular">{r.due_date}</td>
                    <td className="px-4 py-3 tabular">{fmt$(r.amount_due)}</td>
                    <td className="px-4 py-3 tabular">{fmt$(r.amount_paid)}</td>
                    <td className="px-4 py-3">{!r.amount_paid?<span className="text-red-600 font-medium">Unpaid</span>:r.is_partial?<span className="text-amber-600 font-medium">Partial</span>:r.is_late?<span className="text-amber-600 font-medium">Late</span>:<span className="text-green-600 font-medium">Paid</span>}</td>
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
      {tab==='leases' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Lease History</h2>
            <div className="flex gap-2">
              <label className={`cursor-pointer rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800 ${uploadingLease?'opacity-50':''}`}>
                {uploadingLease?'Parsing…':'Upload Lease PDF'}
                <input type="file" accept=".pdf" className="hidden" disabled={uploadingLease} onClick={e=>{(e.target as HTMLInputElement).value='';}} onChange={async e=>{
                  const file=e.target.files?.[0];if(!file||uploadingLease)return;
                  e.target.value='';
                  const extracted=await uploadPdf(file,'lease',setUploadingLease);
                  if(extracted){
                    setLeaseExtracted(extracted);
                    setLeaseTenantFirst(extracted.tenant_first_name??'');
                    setLeaseTenantLast(extracted.tenant_last_name??'');
                    setLeaseTenantMode('new');
                    setLeaseSelectedTenant(''); setLeaseSelectedUnit('');
                  }
                }} />
              </label>
              <Link href={`/properties/${id}/leases/new`} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">+ Add Manually</Link>
            </div>
          </div>

          {/* Extraction review panel */}
          {leaseExtracted && (
            <div className="rounded-xl border-2 border-blue-300 bg-blue-50 p-5 space-y-4 dark:border-blue-700 dark:bg-blue-950/20">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-blue-800 dark:text-blue-300">✦ AI Extracted — Review & Confirm</h3>
                <button onClick={()=>setLeaseExtracted(null)} className="text-xs text-gray-400 hover:text-gray-600">Discard</button>
              </div>
              {leaseExtracted.confidence_notes && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">⚠ {leaseExtracted.confidence_notes}</p>
              )}
              <LeaseForm
                data={leaseExtracted} onChange={patch=>setLeaseExtracted(prev=>({...prev,...patch}))}
                units={units} existingTenants={existingTenants}
                tenantMode={leaseTenantMode} setTenantMode={setLeaseTenantMode}
                tenantFirstName={leaseTenantFirst} setTenantFirstName={setLeaseTenantFirst}
                tenantLastName={leaseTenantLast} setTenantLastName={setLeaseTenantLast}
                selectedTenantId={leaseSelectedTenant} setSelectedTenantId={setLeaseSelectedTenant}
                selectedUnitId={leaseSelectedUnit} setSelectedUnitId={setLeaseSelectedUnit}
                showTenantFields={true}
              />
              <div className="flex gap-2 pt-2">
                <button onClick={confirmLease} disabled={leaseSaving||!leaseSelectedUnit||(leaseTenantMode==='new'?!leaseTenantFirst||!leaseTenantLast:!leaseSelectedTenant)}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {leaseSaving?'Saving…':'Confirm & Save Lease'}
                </button>
              </div>
            </div>
          )}

          {/* Saved leases */}
          <div className="space-y-3">
            {leases.length===0&&!leaseExtracted
              ?<div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-400 dark:border-gray-700">No leases yet. Upload a PDF or add manually.</div>
              :leases.map(l=>(
                <div key={l.id} className="rounded-xl border border-gray-200 dark:border-gray-800">
                  {editingLease?.id===l.id ? (
                    // EDIT MODE
                    <div className="p-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold">Editing — {l.tenant_name} · Unit {l.unit_label}</h3>
                        <div className="flex gap-3">
                          <button onClick={()=>deleteLease(l.id)} disabled={deletingLeaseId===l.id} className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50">{deletingLeaseId===l.id?'Deleting…':'Delete'}</button>
                          <button onClick={()=>setEditingLease(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                        </div>
                      </div>
                      <LeaseForm
                        data={editLeaseData} onChange={patch=>setEditLeaseData(prev=>({...prev,...patch}))}
                        units={units} existingTenants={existingTenants}
                        tenantMode="existing" setTenantMode={()=>{}}
                        tenantFirstName="" setTenantFirstName={()=>{}}
                        tenantLastName="" setTenantLastName={()=>{}}
                        selectedTenantId="" setSelectedTenantId={()=>{}}
                        selectedUnitId="" setSelectedUnitId={()=>{}}
                        showTenantFields={false}
                      />
                      <button onClick={saveEditLease} disabled={editSaving}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                        {editSaving?'Saving…':'Save Changes'}
                      </button>
                    </div>
                  ) : (
                    // VIEW MODE
                    <div className="p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="font-medium">{l.tenant_name}</span>
                          <span className="ml-2 text-sm text-gray-500">· Unit {l.unit_label}</span>
                          {l.extracted_by_ai&&<span className="ml-2 rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">AI parsed</span>}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-medium tabular">{fmt$(l.rent_amount)}/mo</span>
                          <button onClick={()=>startEditLease(l)} className="text-xs text-blue-600 hover:underline dark:text-blue-400">Edit</button>
                          <button onClick={()=>deleteLease(l.id)} disabled={deletingLeaseId===l.id} className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50">{deletingLeaseId===l.id?'Deleting…':'Delete'}</button>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-4 text-sm text-gray-500">
                        <span>{l.start_date} → {l.end_date}</span>
                        {l.security_deposit&&<span>Deposit: {fmt$(l.security_deposit)}</span>}
                        {l.late_fee_amount&&<span>Late fee: {fmt$(l.late_fee_amount)}</span>}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-3">
                        {l.utilities_landlord&&JSON.parse(l.utilities_landlord).length>0&&<Tags label="Landlord pays" items={JSON.parse(l.utilities_landlord)} />}
                        {l.utilities_tenant&&JSON.parse(l.utilities_tenant).length>0&&<Tags label="Tenant pays" items={JSON.parse(l.utilities_tenant)} color="green" />}
                        {l.equipment_included&&JSON.parse(l.equipment_included).length>0&&<Tags label="Included" items={JSON.parse(l.equipment_included)} color="purple" />}
                      </div>
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ── TENANTS ── */}
      {tab==='tenants' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Tenants</h2>
            <Link href={`/properties/${id}/tenants/new`} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">+ Add Tenant</Link>
          </div>
          <div className="space-y-3">
            {existingTenants.length === 0
              ? <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-400 dark:border-gray-700">No tenants yet.</div>
              : existingTenants.map(t => (
                <div key={t.id} className="rounded-xl border border-gray-200 dark:border-gray-800">
                  {editingTenant?.id === t.id ? (
                    <div className="p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold">Editing Tenant</h3>
                        <button onClick={()=>setEditingTenant(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Input label="First Name" value={editTenantForm.first_name} onChange={v=>setEditTenantForm(p=>({...p,first_name:v}))} />
                        <Input label="Last Name" value={editTenantForm.last_name} onChange={v=>setEditTenantForm(p=>({...p,last_name:v}))} />
                        <Input label="Phone" value={editTenantForm.phone} onChange={v=>setEditTenantForm(p=>({...p,phone:v}))} type="tel" />
                        <Input label="Email" value={editTenantForm.email} onChange={v=>setEditTenantForm(p=>({...p,email:v}))} type="email" />
                      </div>
                      <Input label="Notes" value={editTenantForm.notes} onChange={v=>setEditTenantForm(p=>({...p,notes:v}))} />
                      <button onClick={saveEditTenant} disabled={tenantSaving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                        {tenantSaving?'Saving…':'Save Changes'}
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between p-4">
                      <div>
                        <p className="font-medium">{t.first_name} {t.last_name}</p>
                        <p className="text-sm text-gray-500">Unit {t.unit_label}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <button onClick={()=>startEditTenant(t)} className="text-xs text-blue-600 hover:underline dark:text-blue-400">Edit</button>
                        <button onClick={()=>deleteTenant(t.id)} disabled={deletingTenantId===t.id} className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50">
                          {deletingTenantId===t.id?'Deleting…':'Delete'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            }
          </div>
        </div>
      )}

      {/* ── WORK ORDERS ── */}
      {tab==='work-orders' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Work Orders</h2>
            <div className="flex gap-2">
              <label className={`cursor-pointer rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800 ${uploadingWO?'opacity-50':''}`}>
                {uploadingWO?'Parsing…':'Upload PDF/Invoice'}
                <input type="file" accept=".pdf" className="hidden" disabled={uploadingWO} onChange={async e=>{const file=e.target.files?.[0];if(!file||uploadingWO)return;const extracted=await uploadPdf(file,'work_order',setUploadingWO);if(extracted)setWoExtracted(extracted);e.target.value='';}} />
              </label>
              <Link href={`/properties/${id}/work-orders/new`} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">+ New Work Order</Link>
            </div>
          </div>
          {woExtracted&&(
            <div className="rounded-xl border-2 border-blue-300 bg-blue-50 p-5 dark:border-blue-700 dark:bg-blue-950/20">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold text-blue-800 dark:text-blue-300">✦ AI Extracted</h3>
                <button onClick={()=>setWoExtracted(null)} className="text-xs text-gray-400 hover:text-gray-600">Discard</button>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field label="Vendor" value={woExtracted.vendor_name} />
                <Field label="Category" value={woExtracted.category} />
                <Field label="Date" value={woExtracted.date_received} />
                <Field label="Quoted Cost" value={woExtracted.quoted_cost?fmt$(woExtracted.quoted_cost):null} />
                <Field label="Actual Cost" value={woExtracted.actual_cost?fmt$(woExtracted.actual_cost):null} />
              </div>
              {woExtracted.description&&<p className="mt-3 text-sm text-gray-600 dark:text-gray-400">{woExtracted.description}</p>}
              <div className="mt-4">
                <Link href={`/properties/${id}/work-orders/new?prefill=${encodeURIComponent(JSON.stringify(woExtracted))}`} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Continue to Work Order Form →</Link>
              </div>
            </div>
          )}
          <div className="space-y-3">
            {workOrders.length===0&&!woExtracted?<div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-400 dark:border-gray-700">No work orders yet.</div>:workOrders.map(wo=>(
              <div key={wo.id} className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{wo.vendor_name}</span>
                      <span className="text-xs text-gray-400">{wo.vendor_trade}</span>
                      <StatusBadge status={wo.status} />
                      {wo.unit_label&&<span className="text-xs text-gray-400">Unit {wo.unit_label}</span>}
                    </div>
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{wo.description}</p>
                    <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-400">
                      <span>Received {wo.date_received}</span>
                      {wo.date_completed&&<span>Completed {wo.date_completed}</span>}
                      {wo.quoted_cost&&<span>Quote: {fmt$(wo.quoted_cost)}</span>}
                      {wo.actual_cost&&<span>Actual: {fmt$(wo.actual_cost)}</span>}
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
      {tab==='escrow' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Escrow</h2>
            <label className={`cursor-pointer rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 ${uploadingEscrow?'opacity-50':''}`}>
              {uploadingEscrow?'Parsing…':'Upload Escrow Statement'}
              <input type="file" accept=".pdf" className="hidden" disabled={uploadingEscrow} onChange={async e=>{const file=e.target.files?.[0];if(!file||uploadingEscrow)return;const extracted=await uploadPdf(file,'escrow',setUploadingEscrow);if(extracted){setEscrowExtracted(extracted);setEscrowLender('');}e.target.value='';}} />
            </label>
          </div>
          {escrowExtracted&&(
            <div className="rounded-xl border-2 border-blue-300 bg-blue-50 p-5 dark:border-blue-700 dark:bg-blue-950/20">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold text-blue-800 dark:text-blue-300">✦ AI Extracted — Review & Confirm</h3>
                <button onClick={()=>setEscrowExtracted(null)} className="text-xs text-gray-400 hover:text-gray-600">Discard</button>
              </div>
              {escrowExtracted.confidence_notes&&<p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">⚠ {escrowExtracted.confidence_notes}</p>}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Field label="Statement Date" value={escrowExtracted.statement_date} />
                <Field label="Period Start" value={escrowExtracted.analysis_period_start} />
                <Field label="Period End" value={escrowExtracted.analysis_period_end} />
                <Field label="New Monthly Escrow" value={escrowExtracted.new_monthly_escrow?fmt$(escrowExtracted.new_monthly_escrow):null} />
                <Field label="Projected" value={escrowExtracted.projected_requirement?fmt$(escrowExtracted.projected_requirement):null} />
                <Field label="Actual Disbursed" value={escrowExtracted.actual_disbursements?fmt$(escrowExtracted.actual_disbursements):null} />
                <Field label="Shortage/Surplus" value={escrowExtracted.shortage_surplus_amount!=null?`${escrowExtracted.shortage_surplus_amount<0?'-':'+'}${fmt$(escrowExtracted.shortage_surplus_amount)}`:null} />
              </div>
              <div className="mt-4"><Input label="Lender Name *" value={escrowLender} onChange={setEscrowLender} placeholder="e.g. Rocket Mortgage" /></div>
              <button onClick={confirmEscrow} disabled={escrowSaving||!escrowLender} className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{escrowSaving?'Saving…':'Confirm & Save'}</button>
            </div>
          )}
          <div className="space-y-3">
            {escrow.length===0&&!escrowExtracted?<div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-400 dark:border-gray-700">No escrow accounts yet. Upload an annual escrow statement to get started.</div>:escrow.map(e=>(
              <div key={e.id} className="rounded-xl border border-gray-200 p-5 dark:border-gray-800">
                <div className="flex items-start justify-between">
                  <div><p className="font-medium">{e.lender_name}</p>{e.loan_number&&<p className="text-sm text-gray-500">Loan #{e.loan_number}</p>}</div>
                  {e.new_monthly_escrow&&<div className="text-right"><p className="text-xs text-gray-500">New monthly escrow</p><p className="font-semibold tabular">{fmt$(e.new_monthly_escrow)}</p></div>}
                </div>
                {e.statement_date&&(
                  <div className="mt-4 grid grid-cols-3 gap-4 rounded-lg bg-gray-50 p-4 text-sm dark:bg-gray-900">
                    <div><p className="text-xs text-gray-500">Projected</p><p className="font-medium tabular">{fmt$(e.projected_requirement)}</p></div>
                    <div><p className="text-xs text-gray-500">Actual</p><p className="font-medium tabular">{fmt$(e.actual_disbursements)}</p></div>
                    <div><p className="text-xs text-gray-500">Shortage/Surplus</p><p className={`font-medium tabular ${(e.shortage_surplus_amount??0)<0?'text-red-600':'text-green-600'}`}>{e.shortage_surplus_amount!=null?`${e.shortage_surplus_amount<0?'-':'+'}${fmt$(e.shortage_surplus_amount)}`:'—'}</p></div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── INSURANCE ── */}
      {tab==='insurance' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Insurance Policies</h2>
            <label className={`cursor-pointer rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 ${uploadingInsurance?'opacity-50':''}`}>
              {uploadingInsurance?'Parsing…':'Upload Policy PDF'}
              <input type="file" accept=".pdf" className="hidden" disabled={uploadingInsurance} onChange={async e=>{const file=e.target.files?.[0];if(!file||uploadingInsurance)return;const extracted=await uploadPdf(file,'insurance',setUploadingInsurance);if(extracted)setInsuranceExtracted(extracted);e.target.value='';}} />
            </label>
          </div>
          {insuranceExtracted&&(
            <div className="rounded-xl border-2 border-blue-300 bg-blue-50 p-5 dark:border-blue-700 dark:bg-blue-950/20">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold text-blue-800 dark:text-blue-300">✦ AI Extracted — Review & Confirm</h3>
                <button onClick={()=>setInsuranceExtracted(null)} className="text-xs text-gray-400 hover:text-gray-600">Discard</button>
              </div>
              {insuranceExtracted.confidence_notes&&<p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">⚠ {insuranceExtracted.confidence_notes}</p>}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Field label="Carrier" value={insuranceExtracted.carrier} />
                <Field label="Policy Type" value={insuranceExtracted.policy_type} />
                <Field label="Policy #" value={insuranceExtracted.policy_number} />
                <Field label="Effective" value={insuranceExtracted.effective_date} />
                <Field label="Expiration" value={insuranceExtracted.expiration_date} />
                <Field label="Annual Premium" value={insuranceExtracted.annual_premium?fmt$(insuranceExtracted.annual_premium):null} />
                <Field label="Deductible" value={insuranceExtracted.deductible?fmt$(insuranceExtracted.deductible):null} />
                <Field label="Coverage Limit" value={insuranceExtracted.coverage_limit?fmt$(insuranceExtracted.coverage_limit):null} />
              </div>
              {insuranceExtracted.coverage_notes&&<p className="mt-3 text-sm text-gray-600 dark:text-gray-400">{insuranceExtracted.coverage_notes}</p>}
              <button onClick={confirmInsurance} disabled={insuranceSaving} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{insuranceSaving?'Saving…':'Confirm & Save Policy'}</button>
            </div>
          )}
          <div className="space-y-3">
            {insurance.length===0&&!insuranceExtracted?<div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-400 dark:border-gray-700">No insurance policies yet.</div>:insurance.map(p=>{
              const daysLeft=Math.ceil((new Date(p.expiration_date).getTime()-Date.now())/86400000);
              return(
                <div key={p.id} className="rounded-xl border border-gray-200 p-5 dark:border-gray-800">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{p.carrier}</p>
                        {p.policy_type&&<span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">{p.policy_type}</span>}
                        {p.extracted_by_ai&&<span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">AI parsed</span>}
                      </div>
                      <p className="mt-1 text-sm text-gray-500">{p.effective_date} → {p.expiration_date}</p>
                    </div>
                    <p className={`text-sm font-medium ${daysLeft<=60?'text-amber-600':'text-gray-500'}`}>{daysLeft<=0?'Expired':daysLeft<=60?`Expires in ${daysLeft}d`:`${daysLeft}d remaining`}</p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-6 text-sm">
                    {p.annual_premium&&<div><span className="text-xs text-gray-500">Premium</span><p className="font-medium tabular">{fmt$(p.annual_premium)}/yr</p></div>}
                    {p.deductible&&<div><span className="text-xs text-gray-500">Deductible</span><p className="font-medium tabular">{fmt$(p.deductible)}</p></div>}
                  </div>
                  {p.coverage_notes&&<p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{p.coverage_notes}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
