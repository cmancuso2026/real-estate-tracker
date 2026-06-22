'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { OverviewTab } from '@/components/OverviewTab';

type Tab = 'overview' | 'tenants' | 'rent' | 'leases' | 'work-orders' | 'escrow' | 'insurance';

interface Property { id: number; address: string; city: string; state: string; property_type: string; unit_count: number; }
interface Unit { id: number; unit_label: string; tenant_name: string | null; tenant_id: number | null; rent_amount: number | null; lease_start_date: string | null; lease_end_date: string | null; first_lease_start_date: string | null; amount_due: number | null; amount_paid: number | null; is_late: boolean | null; is_owner_unit: boolean; }
interface RentRow { id: number; unit_label: string; tenant_name: string | null; due_date: string; amount_due: number; paid_date: string | null; amount_paid: number | null; is_partial: boolean; is_late: boolean; late_fee_charged: number | null; late_fee_applicable: boolean; source: string; notes: string | null; }
interface WorkOrder { id: number; vendor_name: string; vendor_trade: string; category: string; description: string; status: string; date_received: string; date_completed: string | null; quoted_cost: number | null; actual_cost: number | null; rating: number | null; unit_label: string | null; }
interface Lease { id: number; unit_label: string; tenant_name: string; start_date: string; end_date: string; rent_amount: number; security_deposit: number | null; late_fee_amount: number | null; late_fee_grace_days: number | null; utilities_landlord: string | null; utilities_tenant: string | null; equipment_included: string | null; extracted_by_ai: boolean; }
interface EscrowAccount { id: number; lender_name: string; loan_number: string | null; statement_id: number | null; statement_date: string | null; analysis_period_start: string | null; analysis_period_end: string | null; total_property_taxes: number | null; total_insurance: number | null; shortage_surplus_amount: number | null; new_monthly_escrow: number | null; }
interface InsurancePolicy {
  id: number; carrier: string; policy_number: string | null; policy_type: string | null;
  effective_date: string; expiration_date: string; annual_premium: number | null;
  deductible: number | null; coverage_limit: number | null; coverage_notes: string | null;
  dwelling_coverage: number | null; other_structures_coverage: number | null;
  personal_property_coverage: number | null; loss_of_use_coverage: number | null;
  liability_coverage: number | null; medical_payments_coverage: number | null;
  hurricane_deductible: number | null; wind_hail_deductible: number | null;
  flood_coverage: number | null; loss_of_rent_coverage: number | null; loss_of_rent_months: number | null;
  extracted_by_ai: boolean;
}
interface ExistingTenant { id: number; first_name: string; last_name: string; unit_id: number; unit_label: string; phone: string | null; email: string | null; is_active: boolean; notes: string | null; }

interface LeaseExtracted {
  tenant_first_name: string | null; tenant_last_name: string | null;
  start_date: string | null; end_date: string | null; rent_amount: number | null;
  security_deposit: number | null; late_fee_amount: number | null; late_fee_grace_days: number | null;
  utilities_landlord: string[]; utilities_tenant: string[]; equipment_included: string[];
  confidence_notes: string | null;
}
interface EscrowOption { label: string; new_monthly_escrow: number | null; total_payment: number | null; }
interface EscrowExtracted { statement_date: string | null; analysis_period_start: string | null; analysis_period_end: string | null; total_property_taxes: number | null; total_insurance: number | null; shortage_surplus_amount: number | null; new_monthly_escrow: number | null; options?: EscrowOption[]; confidence_notes: string | null; }
interface InsuranceExtracted {
  carrier: string | null; policy_number: string | null; policy_type: string | null;
  effective_date: string | null; expiration_date: string | null; renewal_period_days: number | null;
  annual_premium: number | null; deductible: number | null; coverage_limit: number | null;
  dwelling_coverage: number | null; other_structures_coverage: number | null;
  personal_property_coverage: number | null; loss_of_use_coverage: number | null;
  liability_coverage: number | null; medical_payments_coverage: number | null;
  hurricane_deductible: number | null; wind_hail_deductible: number | null;
  flood_coverage: number | null; loss_of_rent_coverage: number | null; loss_of_rent_months: number | null;
  coverage_notes: string | null; confidence_notes: string | null;
}
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

const TABS: {id:Tab;label:string}[] = [{id:'overview',label:'Overview'},{id:'tenants',label:'Tenants'},{id:'rent',label:'Rent'},{id:'leases',label:'Leases'},{id:'work-orders',label:'Work Orders'},{id:'escrow',label:'Escrow'},{id:'insurance',label:'Insurance'}];

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


// Reusable insurance form for both extraction review and editing
function InsuranceForm({
  data, onChange, onSave, onDiscard, saving, title
}: {
  data: Partial<InsuranceExtracted>;
  onChange: (patch: Partial<InsuranceExtracted>) => void;
  onSave: () => void;
  onDiscard: () => void;
  saving: boolean;
  title: string;
}) {
  const num = (key: keyof InsuranceExtracted) => (data[key] as number|null|undefined)?.toString() ?? '';
  const upd = (key: keyof InsuranceExtracted, v: string) => onChange({ [key]: v ? parseInt(v) : null });
  const str = (key: keyof InsuranceExtracted) => (data[key] as string|null|undefined) ?? '';
  const updStr = (key: keyof InsuranceExtracted, v: string) => onChange({ [key]: v || null });

  return (
    <div className="rounded-xl border-2 border-blue-300 bg-blue-50 p-5 space-y-4 dark:border-blue-700 dark:bg-blue-950/20">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-blue-800 dark:text-blue-300">{title}</h3>
        <button onClick={onDiscard} className="text-xs text-gray-400 hover:text-gray-600">Discard</button>
      </div>
      {data.confidence_notes && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">⚠ {data.confidence_notes}</p>
      )}

      {/* Policy info */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Policy Details</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Input label="Carrier *" value={str('carrier')} onChange={v=>updStr('carrier',v)} />
          <Input label="Policy Number" value={str('policy_number')} onChange={v=>updStr('policy_number',v)} />
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Policy Type</label>
            <select value={str('policy_type')} onChange={e=>updStr('policy_type',e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800">
              {['homeowners','landlord','liability','flood','umbrella','other'].map(t=><option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <Input label="Effective Date" type="date" value={str('effective_date')} onChange={v=>updStr('effective_date',v)} />
          <Input label="Expiration Date" type="date" value={str('expiration_date')} onChange={v=>updStr('expiration_date',v)} />
          <Input label="Annual Premium ($)" type="number" value={num('annual_premium')} onChange={v=>upd('annual_premium',v)} placeholder="0" />
        </div>
      </div>

      {/* Coverage limits */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Coverage Limits</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Input label="Dwelling ($)" type="number" value={num('dwelling_coverage')} onChange={v=>upd('dwelling_coverage',v)} placeholder="0" />
          <Input label="Other Structures ($)" type="number" value={num('other_structures_coverage')} onChange={v=>upd('other_structures_coverage',v)} placeholder="0" />
          <Input label="Personal Property ($)" type="number" value={num('personal_property_coverage')} onChange={v=>upd('personal_property_coverage',v)} placeholder="0" />
          <Input label="Loss of Use ($)" type="number" value={num('loss_of_use_coverage')} onChange={v=>upd('loss_of_use_coverage',v)} placeholder="0" />
          <Input label="Liability ($)" type="number" value={num('liability_coverage')} onChange={v=>upd('liability_coverage',v)} placeholder="0" />
          <Input label="Medical Payments ($)" type="number" value={num('medical_payments_coverage')} onChange={v=>upd('medical_payments_coverage',v)} placeholder="0" />
          <Input label="Loss of Rent ($)" type="number" value={num('loss_of_rent_coverage')} onChange={v=>upd('loss_of_rent_coverage',v)} placeholder="0" />
          <Input label="Loss of Rent (months)" type="number" value={num('loss_of_rent_months')} onChange={v=>upd('loss_of_rent_months',v)} placeholder="0" />
          <Input label="Flood Coverage ($)" type="number" value={num('flood_coverage')} onChange={v=>upd('flood_coverage',v)} placeholder="0" />
          <Input label="Total Coverage Limit ($)" type="number" value={num('coverage_limit')} onChange={v=>upd('coverage_limit',v)} placeholder="0" />
        </div>
      </div>

      {/* Deductibles */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Deductibles</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Input label="Standard Deductible ($)" type="number" value={num('deductible')} onChange={v=>upd('deductible',v)} placeholder="0" />
          <Input label="Hurricane Deductible ($)" type="number" value={num('hurricane_deductible')} onChange={v=>upd('hurricane_deductible',v)} placeholder="0" />
          <Input label="Wind/Hail Deductible ($)" type="number" value={num('wind_hail_deductible')} onChange={v=>upd('wind_hail_deductible',v)} placeholder="0" />
        </div>
      </div>

      {/* Coverage notes */}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-500">Additional Coverage Notes</label>
        <textarea value={str('coverage_notes')} onChange={e=>updStr('coverage_notes',e.target.value)} rows={3}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800" />
      </div>

      <button onClick={onSave} disabled={saving || !data.carrier || !data.effective_date || !data.expiration_date}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
        {saving ? 'Saving…' : 'Confirm & Save Policy'}
      </button>
    </div>
  );
}


// ── RENT TAB COMPONENT ──────────────────────────────────────────────────────
interface RentRowType {
  id: number; unit_label: string; due_date: string; amount_due: number;
  paid_date: string | null; amount_paid: number | null;
  is_partial: boolean; is_late: boolean;
  late_fee_charged: number | null; late_fee_applicable: boolean;
  source: string; notes: string | null;
}
interface UnitType {
  id: number; unit_label: string; is_owner_unit: boolean;
  rent_amount: number | null; lease_start_date: string | null; lease_end_date: string | null;
  amount_due: number | null; amount_paid: number | null; is_late: boolean | null;
}

type RentStatus = 'paid' | 'late' | 'partial' | 'unpaid';

interface MonthGroup {
  key: string; unit_label: string; month: string;        // month = 'YYYY-MM'
  expected: number; totalPaid: number; totalLateFee: number;
  anyLate: boolean; status: RentStatus; payments: RentRowType[];
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function monthLabel(ym: string) {
  const [y, m] = ym.split('-');
  return `${MONTH_NAMES[parseInt(m ?? '', 10) - 1] ?? m ?? ''} ${y ?? ''}`.trim();
}
function groupStatus(expected: number, totalPaid: number, anyLate: boolean): RentStatus {
  if (totalPaid <= 0) return 'unpaid';
  if (expected > 0 && totalPaid < expected) return 'partial';
  if (anyLate) return 'late';
  return 'paid';
}
const STATUS_CLASS: Record<RentStatus, string> = {
  paid:    'bg-green-100 text-green-700',
  late:    'bg-amber-100 text-amber-700',
  partial: 'bg-orange-100 text-orange-700',
  unpaid:  'bg-red-100 text-red-600',
};
function RentStatusBadge({ status }: { status: RentStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[status]}`}>{status.charAt(0).toUpperCase() + status.slice(1)}</span>;
}

function RentTab({ id, units, rent, onRefresh, unitFilter, setUnitFilter }: {
  id: string; units: UnitType[]; rent: RentRowType[]; onRefresh: () => void;
  unitFilter: string; setUnitFilter: (v: string) => void;
}) {
  const [editingRow, setEditingRow] = useState<RentRowType | null>(null);
  const [editForm, setEditForm] = useState<Partial<RentRowType>>({});
  const [editSaving, setEditSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<Set<RentStatus>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const thisMonth = new Date().toISOString().slice(0, 7);
  const today = new Date().toISOString().slice(0, 10);
  const currentYear = String(new Date().getFullYear());
  const rentalUnits = units.filter(u => !u.is_owner_unit);

  const sameUnit = (a: unknown, b: unknown) => String(a).trim() === String(b).trim();

  // ── Group every rent record by (unit, month) so multiple payments in one
  //    month collapse into a single combined row. ──
  const allGroups = useMemo<MonthGroup[]>(() => {
    const map = new Map<string, MonthGroup>();
    for (const r of rent) {
      const month = (r.due_date ?? '').slice(0, 7);
      const key = `${r.unit_label}::${month}`;
      let g = map.get(key);
      if (!g) {
        g = { key, unit_label: r.unit_label, month, expected: 0, totalPaid: 0, totalLateFee: 0, anyLate: false, status: 'unpaid', payments: [] };
        map.set(key, g);
      }
      g.payments.push(r);
      g.expected = Math.max(g.expected, r.amount_due ?? 0);   // month's expected rent (shared across rows)
      g.totalPaid += r.amount_paid ?? 0;
      g.totalLateFee += r.late_fee_charged ?? 0;
      if (r.is_late) g.anyLate = true;
    }
    const groups = Array.from(map.values());
    for (const g of groups) {
      g.status = groupStatus(g.expected, g.totalPaid, g.anyLate);
      g.payments.sort((a, b) => (a.paid_date ?? a.due_date).localeCompare(b.paid_date ?? b.due_date));
    }
    groups.sort((a, b) => b.month.localeCompare(a.month) || a.unit_label.localeCompare(b.unit_label));
    return groups;
  }, [rent]);

  // ── YTD stats — current calendar year only, measured over months (not raw payments) ──
  const ytdByUnit: Record<string, { paid: number; onTime: number; late: number; months: number }> = {};
  for (const g of allGroups) {
    if (!g.month.startsWith(currentYear)) continue;
    if (!ytdByUnit[g.unit_label]) ytdByUnit[g.unit_label] = { paid: 0, onTime: 0, late: 0, months: 0 };
    const u = ytdByUnit[g.unit_label]!;
    u.paid += g.totalPaid;
    u.months++;
    if (g.status === 'paid') u.onTime++;
    else if (g.status === 'late') u.late++;
  }
  const totalYTD = Object.values(ytdByUnit).reduce((s, u) => s + u.paid, 0);
  const totalOnTime = Object.values(ytdByUnit).reduce((s, u) => s + u.onTime, 0);
  const totalMonths = Object.values(ytdByUnit).reduce((s, u) => s + u.months, 0);

  // Outstanding this month
  const paidThisMonth = new Set(allGroups.filter(g => g.month === thisMonth && g.totalPaid > 0).map(g => g.unit_label));
  const outstandingUnits = rentalUnits.filter(u =>
    u.rent_amount && u.lease_start_date && u.lease_end_date &&
    u.lease_start_date <= today && u.lease_end_date >= today &&
    !paidThisMonth.has(u.unit_label)
  );
  const totalOutstanding = outstandingUnits.reduce((s, u) => s + (u.rent_amount ?? 0), 0);

  // Apply unit filter, then derive status counts, then apply status filter
  const unitGroups = unitFilter === 'all' ? allGroups : allGroups.filter(g => sameUnit(g.unit_label, unitFilter));
  const statusCounts: Record<RentStatus, number> = { paid: 0, late: 0, partial: 0, unpaid: 0 };
  for (const g of unitGroups) statusCounts[g.status]++;
  const visibleGroups = statusFilter.size === 0 ? unitGroups : unitGroups.filter(g => statusFilter.has(g.status));

  function toggleStatus(s: RentStatus) {
    setStatusFilter(prev => { const next = new Set(prev); next.has(s) ? next.delete(s) : next.add(s); return next; });
  }
  function toggleExpand(key: string) {
    setExpanded(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });
  }

  function startEdit(r: RentRowType) {
    setEditingRow(r);
    setEditForm({
      paid_date: r.paid_date ?? '',
      amount_paid: r.amount_paid,
      amount_due: r.amount_due,
      is_late: r.is_late,
      late_fee_charged: r.late_fee_charged,
      notes: r.notes ?? '',
    });
  }
  async function saveEdit() {
    if (!editingRow || editSaving) return;
    setEditSaving(true);
    const amountPaid = editForm.amount_paid;
    const amountDue = editForm.amount_due ?? editingRow.amount_due;
    const isPartial = amountPaid != null && amountPaid < amountDue;
    await fetch(`/api/v2/rent/${editingRow.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...editForm, is_partial: isPartial }),
    });
    setEditingRow(null); setEditSaving(false);
    onRefresh();
  }
  async function deleteRow(rowId: number) {
    if (!confirm('Delete this payment record?')) return;
    setDeletingId(rowId);
    await fetch(`/api/v2/rent/${rowId}`, { method: 'DELETE' });
    setDeletingId(null);
    onRefresh();
  }
  function exportCsv() {
    const headers = ['Unit','Due Date','Expected','Paid','Status','Late Fee','Source'];
    const rows = rent.map(r => [r.unit_label, r.due_date, r.amount_due, r.amount_paid ?? '', r.amount_paid ? (r.is_partial ? 'Partial' : r.is_late ? 'Late' : 'Paid') : 'Unpaid', r.late_fee_charged ?? '', r.source]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `rent-${thisMonth}.csv`;
    a.click();
  }

  const COLS = 8;

  // Inline editor row (shared by single-payment rows and expanded child payments)
  function editRowJsx(r: RentRowType) {
    return (
      <tr key={`edit-${r.id}`} className="bg-blue-50 dark:bg-blue-950/20">
        <td className="px-2 py-2" />
        <td className="px-4 py-2 font-medium">{r.unit_label}</td>
        <td className="px-4 py-2 text-gray-500 text-xs">{r.due_date}</td>
        <td className="px-4 py-2">
          <input type="number" value={editForm.amount_due ?? ''} onChange={e => setEditForm(p => ({ ...p, amount_due: parseFloat(e.target.value) }))}
            className="w-24 rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-800" />
        </td>
        <td className="px-4 py-2">
          <input type="number" value={editForm.amount_paid ?? ''} onChange={e => setEditForm(p => ({ ...p, amount_paid: e.target.value ? parseFloat(e.target.value) : null }))}
            className="w-24 rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-800" />
        </td>
        <td className="px-4 py-2">
          <select value={editForm.is_late ? 'late' : 'ontime'} onChange={e => setEditForm(p => ({ ...p, is_late: e.target.value === 'late' }))}
            className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-800">
            <option value="ontime">On time</option>
            <option value="late">Late</option>
          </select>
        </td>
        <td className="px-4 py-2">
          <input type="number" value={editForm.late_fee_charged ?? ''} onChange={e => setEditForm(p => ({ ...p, late_fee_charged: e.target.value ? parseFloat(e.target.value) : null }))}
            placeholder="0" className="w-20 rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-800" />
        </td>
        <td className="px-4 py-2">
          <div className="flex gap-2">
            <button onClick={saveEdit} disabled={editSaving} className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50">{editSaving ? '…' : 'Save'}</button>
            <button onClick={() => setEditingRow(null)} className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100 dark:border-gray-700">Cancel</button>
          </div>
        </td>
      </tr>
    );
  }

  // A single payment rendered as a nested child row under a combined month
  function childRowJsx(r: RentRowType) {
    if (editingRow?.id === r.id) return editRowJsx(r);
    return (
      <tr key={`child-${r.id}`} className="bg-gray-50/60 dark:bg-gray-900/30">
        <td className="px-2 py-2" />
        <td className="px-4 py-2" />
        <td className="px-4 py-2 pl-8 text-xs text-gray-500 tabular">↳ {r.paid_date ?? r.due_date}</td>
        <td className="px-4 py-2 text-gray-300 dark:text-gray-600">—</td>
        <td className="px-4 py-2 tabular">{r.amount_paid != null ? '$' + r.amount_paid.toLocaleString() : '—'}</td>
        <td className="px-4 py-2">{r.is_late && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Late</span>}</td>
        <td className="px-4 py-2 tabular">{r.late_fee_charged ? '$' + r.late_fee_charged.toLocaleString() : '—'}</td>
        <td className="px-4 py-2">
          <div className="flex gap-2">
            <button onClick={() => startEdit(r)} className="text-xs text-blue-600 hover:underline dark:text-blue-400">Edit</button>
            <button onClick={() => deleteRow(r.id)} disabled={deletingId === r.id} className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50">{deletingId === r.id ? '…' : 'Delete'}</button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-700 dark:text-gray-300">Rent Collection</h2>
        <div className="flex gap-2">
          <Link href={`/properties/${id}/rent/new`} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">+ Add Payment</Link>
          <Link href="/rent" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">Import CSV</Link>
          <button onClick={exportCsv} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">Export CSV</button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {rentalUnits.map(u => {
          const stats = ytdByUnit[u.unit_label];
          const pct = stats && stats.months > 0 ? Math.round((stats.onTime / stats.months) * 100) : null;
          const tmGroup = allGroups.find(g => sameUnit(g.unit_label, u.unit_label) && g.month === thisMonth);
          return (
            <div key={u.id} className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-medium text-gray-500">Unit {u.unit_label} · {currentYear}</p>
                {tmGroup && <RentStatusBadge status={tmGroup.status} />}
              </div>
              <p className="text-xl font-bold tabular">{stats ? '$' + stats.paid.toLocaleString() : '—'}</p>
              {pct !== null && <p className="text-xs text-gray-400">{pct}% on time · {stats?.late ?? 0} late · {stats?.months ?? 0} mo</p>}
            </div>
          );
        })}
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs font-medium text-gray-500">Total YTD ({currentYear})</p>
          <p className="text-xl font-bold tabular text-green-600">${totalYTD.toLocaleString()}</p>
          {totalMonths > 0 && <p className="text-xs text-gray-400">{Math.round((totalOnTime / totalMonths) * 100)}% on time</p>}
        </div>
        <div className={`rounded-xl border p-4 ${totalOutstanding > 0 ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20' : 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20'}`}>
          <p className={`text-xs font-medium ${totalOutstanding > 0 ? 'text-red-500' : 'text-green-600'}`}>Outstanding {thisMonth}</p>
          <p className={`text-xl font-bold tabular ${totalOutstanding > 0 ? 'text-red-600' : 'text-green-600'}`}>${totalOutstanding.toLocaleString()}</p>
          <p className="text-xs text-gray-400">{outstandingUnits.length > 0 ? outstandingUnits.map(u => `Unit ${u.unit_label}`).join(', ') : 'All units paid'}</p>
        </div>
      </div>

      {/* Unit slicers */}
      <div className="flex flex-wrap gap-2">
        {(['all', ...rentalUnits.map(u => u.unit_label)] as string[]).map(label => (
          <button key={label} onClick={() => setUnitFilter(label)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${sameUnit(unitFilter, label) || (label === 'all' && unitFilter === 'all') ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400'}`}>
            {label === 'all' ? 'All Units' : `Unit ${label}`}
          </button>
        ))}
      </div>

      {/* Status slicers */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-400 mr-1">Status</span>
        {(['paid','late','partial','unpaid'] as RentStatus[]).map(s => {
          const active = statusFilter.has(s);
          return (
            <button key={s} onClick={() => toggleStatus(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400'}`}>
              {s.charAt(0).toUpperCase() + s.slice(1)} ({statusCounts[s]})
            </button>
          );
        })}
        {statusFilter.size > 0 && <button onClick={() => setStatusFilter(new Set())} className="text-xs text-blue-600 hover:underline">Clear</button>}
        <span className="ml-auto text-xs text-gray-400">{visibleGroups.length} month{visibleGroups.length === 1 ? '' : 's'}</span>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th className="w-8 px-2 py-3" />
              {['Unit','Month','Expected','Paid','Status','Late Fee',''].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {visibleGroups.length === 0
              ? <tr><td colSpan={COLS} className="px-4 py-8 text-center text-gray-400">No rent records match the current filters</td></tr>
              : visibleGroups.flatMap(g => {
                  const multi = g.payments.length > 1;
                  const single = g.payments[0]!;

                  // Single payment in the month → edit it directly inline
                  if (!multi) {
                    if (editingRow?.id === single.id) return [editRowJsx(single)];
                    return [(
                      <tr key={g.key} className="hover:bg-gray-50 dark:hover:bg-gray-900/30">
                        <td className="px-2 py-3" />
                        <td className="px-4 py-3 font-medium">{g.unit_label}</td>
                        <td className="px-4 py-3 tabular">{monthLabel(g.month)}</td>
                        <td className="px-4 py-3 tabular">${g.expected.toLocaleString()}</td>
                        <td className="px-4 py-3 tabular">{g.totalPaid > 0 ? '$' + g.totalPaid.toLocaleString() : '—'}</td>
                        <td className="px-4 py-3"><RentStatusBadge status={g.status} /></td>
                        <td className="px-4 py-3 tabular">{g.totalLateFee ? '$' + g.totalLateFee.toLocaleString() : '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button onClick={() => startEdit(single)} className="text-xs text-blue-600 hover:underline dark:text-blue-400">Edit</button>
                            <button onClick={() => deleteRow(single.id)} disabled={deletingId === single.id} className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50">{deletingId === single.id ? '…' : 'Delete'}</button>
                          </div>
                        </td>
                      </tr>
                    )];
                  }

                  // Multiple payments in the month → combined summary row + expandable children
                  const isOpen = expanded.has(g.key);
                  const rows = [(
                    <tr key={g.key} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900/30" onClick={() => toggleExpand(g.key)}>
                      <td className="px-2 py-3 text-center text-gray-400 select-none">{isOpen ? '▼' : '▶'}</td>
                      <td className="px-4 py-3 font-medium">{g.unit_label}</td>
                      <td className="px-4 py-3 tabular">{monthLabel(g.month)}</td>
                      <td className="px-4 py-3 tabular">${g.expected.toLocaleString()}</td>
                      <td className="px-4 py-3 tabular font-semibold">${g.totalPaid.toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <RentStatusBadge status={g.status} />
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">{g.payments.length} payments</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 tabular">{g.totalLateFee ? '$' + g.totalLateFee.toLocaleString() : '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{isOpen ? 'Hide' : 'Show'}</td>
                    </tr>
                  )];
                  if (isOpen) for (const p of g.payments) rows.push(childRowJsx(p));
                  return rows;
                })
            }
          </tbody>
        </table>
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
  const [expandedTenantId, setExpandedTenantId] = useState<number|null>(null);
  const [tenantUnitFilter, setTenantUnitFilter] = useState<string>('all');
  const [leaseUnitFilter, setLeaseUnitFilter] = useState<string>('all');
  const [rentUnitFilter, setRentUnitFilter] = useState<string>('all');
  const [editTenantForm, setEditTenantForm] = useState({first_name:"",last_name:"",email:"",phone:"",notes:""});
  const [loading, setLoading] = useState(true);
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
  const [deletingEscrowId, setDeletingEscrowId] = useState<number|null>(null);
  const [editingEscrow, setEditingEscrow] = useState<EscrowAccount|null>(null);
  const [editEscrowData, setEditEscrowData] = useState<Partial<EscrowExtracted & {lender_name:string}>>({});
  const [editEscrowSaving, setEditEscrowSaving] = useState(false);

  // Insurance state
  const [insuranceExtracted, setInsuranceExtracted] = useState<InsuranceExtracted | null>(null);
  const [insuranceSaving, setInsuranceSaving] = useState(false);
  const [deletingInsuranceId, setDeletingInsuranceId] = useState<number|null>(null);
  const [editingInsurance, setEditingInsurance] = useState<InsurancePolicy|null>(null);
  const [editInsuranceData, setEditInsuranceData] = useState<Partial<InsuranceExtracted>>({});
  const [editInsuranceSaving, setEditInsuranceSaving] = useState(false);

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
      body: JSON.stringify({
        escrow_account_id: acc.id, extracted_by_ai: true,
        statement_date: escrowExtracted.statement_date,
        analysis_period_start: escrowExtracted.analysis_period_start,
        analysis_period_end: escrowExtracted.analysis_period_end,
        total_property_taxes: escrowExtracted.total_property_taxes,
        total_insurance: escrowExtracted.total_insurance,
        shortage_surplus_amount: escrowExtracted.shortage_surplus_amount,
        new_monthly_escrow: escrowExtracted.new_monthly_escrow,
        projected_requirement: (escrowExtracted.total_property_taxes??0) + (escrowExtracted.total_insurance??0),
        actual_disbursements: (escrowExtracted.total_property_taxes??0) + (escrowExtracted.total_insurance??0),
      }),
    });
    setEscrowExtracted(null); setEscrowSaving(false);
    setTimeout(() => loadTab('escrow'), 300);
  }

  async function deleteInsurance(policyId: number) {
    if (!confirm('Delete this insurance policy?')) return;
    setDeletingInsuranceId(policyId);
    await fetch(`/api/v2/insurance/${policyId}`, { method: 'DELETE' });
    setDeletingInsuranceId(null);
    loadTab('insurance');
  }

  function startEditInsurance(p: InsurancePolicy) {
    setEditingInsurance(p);
    setEditInsuranceData({
      carrier: p.carrier, policy_number: p.policy_number, policy_type: p.policy_type,
      effective_date: p.effective_date, expiration_date: p.expiration_date,
      annual_premium: p.annual_premium, deductible: p.deductible, coverage_limit: p.coverage_limit,
      dwelling_coverage: p.dwelling_coverage, other_structures_coverage: p.other_structures_coverage,
      personal_property_coverage: p.personal_property_coverage, loss_of_use_coverage: p.loss_of_use_coverage,
      liability_coverage: p.liability_coverage, medical_payments_coverage: p.medical_payments_coverage,
      hurricane_deductible: p.hurricane_deductible, wind_hail_deductible: p.wind_hail_deductible,
      flood_coverage: p.flood_coverage, loss_of_rent_coverage: p.loss_of_rent_coverage,
      loss_of_rent_months: p.loss_of_rent_months, coverage_notes: p.coverage_notes ?? '',
    });
  }

  async function saveEditInsurance() {
    if (!editingInsurance || editInsuranceSaving) return;
    setEditInsuranceSaving(true);
    await fetch(`/api/v2/insurance/${editingInsurance.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editInsuranceData),
    });
    setEditingInsurance(null); setEditInsuranceSaving(false);
    loadTab('insurance');
  }

  async function deleteEscrow(escrowId: number) {
    if (!confirm('Delete this escrow account and all its statements?')) return;
    setDeletingEscrowId(escrowId);
    await fetch(`/api/v2/escrow/${escrowId}`, { method: 'DELETE' });
    setDeletingEscrowId(null);
    loadTab('escrow');
  }

  function startEditEscrow(e: EscrowAccount) {
    setEditingEscrow(e);
    setEditEscrowData({
      lender_name: e.lender_name,
      statement_date: e.statement_date ?? '',
      analysis_period_start: e.analysis_period_start ?? '',
      analysis_period_end: e.analysis_period_end ?? '',
      total_property_taxes: e.total_property_taxes,
      total_insurance: e.total_insurance,
      shortage_surplus_amount: e.shortage_surplus_amount,
      new_monthly_escrow: e.new_monthly_escrow,
    });
  }

  async function saveEditEscrow() {
    if (!editingEscrow || editEscrowSaving) return;
    setEditEscrowSaving(true);
    if (editingEscrow.statement_id) {
      await fetch(`/api/v2/escrow/statement/${editingEscrow.statement_id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editEscrowData),
      });
    }
    // Update lender name on account
    await fetch(`/api/v2/escrow`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ property_id: parseInt(id), lender_name: editEscrowData.lender_name ?? editingEscrow.lender_name }),
    });
    setEditingEscrow(null); setEditEscrowSaving(false);
    loadTab('escrow');
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
        <OverviewTab id={id} units={units} onRefresh={load} />
      )}

      {/* ── RENT ── */}
      {tab==='rent' && (
        <RentTab id={id} units={units} rent={rent} onRefresh={()=>loadTab('rent')} unitFilter={rentUnitFilter} setUnitFilter={setRentUnitFilter} />
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

          {/* Unit filter bubbles */}
          <div className="flex flex-wrap gap-2">
            <button onClick={()=>setLeaseUnitFilter('all')} className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${leaseUnitFilter==='all'?'bg-blue-600 text-white':'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400'}`}>All Units</button>
            {units.map(u=>(
              <button key={u.id} onClick={()=>setLeaseUnitFilter(u.unit_label)} className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${leaseUnitFilter===u.unit_label?'bg-blue-600 text-white':'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400'}`}>
                Unit {u.unit_label}
              </button>
            ))}
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
              :(leaseUnitFilter==='all'?leases:leases.filter(l=>l.unit_label===leaseUnitFilter)).map(l=>(
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
          {/* Unit filter */}
          <div className="flex flex-wrap gap-2">
            <button onClick={()=>setTenantUnitFilter('all')} className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${tenantUnitFilter==='all'?'bg-blue-600 text-white':'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400'}`}>All Units</button>
            {units.filter(u=>!u.is_owner_unit).map(u=>(
              <button key={u.id} onClick={()=>setTenantUnitFilter(u.unit_label)} className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${tenantUnitFilter===u.unit_label?'bg-blue-600 text-white':'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400'}`}>
                Unit {u.unit_label}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {existingTenants.length === 0
              ? <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-400 dark:border-gray-700">No tenants yet.</div>
              : existingTenants.filter(t => tenantUnitFilter === 'all' || t.unit_label === tenantUnitFilter).map(t => (
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
                    <div>
                      {/* Clickable header */}
                      <button
                        onClick={()=>setExpandedTenantId(expandedTenantId===t.id?null:t.id)}
                        className="flex w-full items-center justify-between p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50"
                      >
                        <div>
                          <p className="font-medium">{t.first_name} {t.last_name}</p>
                          <p className="text-sm text-gray-500">Unit {t.unit_label}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <button onClick={e=>{e.stopPropagation();startEditTenant(t);}} className="text-xs text-blue-600 hover:underline dark:text-blue-400">Edit</button>
                          <button onClick={e=>{e.stopPropagation();deleteTenant(t.id);}} disabled={deletingTenantId===t.id} className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50">
                            {deletingTenantId===t.id?'Deleting…':'Delete'}
                          </button>
                          <span className="text-gray-400 text-xs">{expandedTenantId===t.id?'▲':'▼'}</span>
                        </div>
                      </button>
                      {/* Expanded detail */}
                      {expandedTenantId===t.id && (
                        <div className="border-t border-gray-100 px-4 py-4 dark:border-gray-800">
                          <Link href={`/properties/${id}/units/${units.find(u=>u.unit_label===t.unit_label)?.id??''}`}
                            className="inline-block mb-3 text-xs text-blue-600 hover:underline dark:text-blue-400">
                            View full unit detail →
                          </Link>
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
                            <div><p className="text-xs text-gray-500">Rent/mo</p><p className="font-semibold tabular">{units.find(u=>u.unit_label===t.unit_label)?.rent_amount!=null?'$'+units.find(u=>u.unit_label===t.unit_label)!.rent_amount!.toLocaleString():'—'}</p></div>
                            <div><p className="text-xs text-gray-500">Years in Unit</p><p className="font-semibold">{(()=>{const u=units.find(u=>u.unit_label===t.unit_label);if(!u?.first_lease_start_date)return'—';const yrs=(Date.now()-new Date(u.first_lease_start_date).getTime())/(1000*60*60*24*365.25);return yrs<0?'—':yrs.toFixed(1)+' yrs';})()}</p></div>
                            <div><p className="text-xs text-gray-500">Lease Expires</p><p className="font-medium">{units.find(u=>u.unit_label===t.unit_label)?.lease_end_date??'—'}</p></div>
                            <div><p className="text-xs text-gray-500">Days Until Exp.</p><p className={`font-semibold tabular ${(()=>{const d=Math.ceil((new Date(units.find(u=>u.unit_label===t.unit_label)?.lease_end_date??'').getTime()-Date.now())/86400000);return d<0?'text-red-500':d<=60?'text-amber-600':'text-gray-700 dark:text-gray-300';})()}`}>{(()=>{const end=units.find(u=>u.unit_label===t.unit_label)?.lease_end_date;if(!end)return'—';const d=Math.ceil((new Date(end).getTime()-Date.now())/86400000);return Math.abs(d)+'d'+(d<0?' ago':'');})()}</p></div>
                          </div>
                        </div>
                      )}
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
            <div className="rounded-xl border-2 border-blue-300 bg-blue-50 p-5 space-y-4 dark:border-blue-700 dark:bg-blue-950/20">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-blue-800 dark:text-blue-300">✦ AI Extracted — Review & Edit Before Saving</h3>
                <button onClick={()=>setEscrowExtracted(null)} className="text-xs text-gray-400 hover:text-gray-600">Discard</button>
              </div>
              {escrowExtracted.confidence_notes&&<p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">⚠ {escrowExtracted.confidence_notes}</p>}

              {/* Payment option selector */}
              {escrowExtracted.options && escrowExtracted.options.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-400">Which option did you choose?</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {escrowExtracted.options.map((opt, i) => (
                      <button
                        key={i}
                        onClick={()=>setEscrowExtracted(prev=>prev?{...prev, new_monthly_escrow: opt.new_monthly_escrow}:prev)}
                        className={`rounded-lg border-2 p-3 text-left transition-colors ${escrowExtracted.new_monthly_escrow===opt.new_monthly_escrow?'border-blue-500 bg-blue-100 dark:bg-blue-900/30':'border-gray-200 bg-white hover:border-blue-300 dark:border-gray-700 dark:bg-gray-800'}`}
                      >
                        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{opt.label}</p>
                        <p className="mt-1 text-sm">New escrow: <span className="font-bold tabular">{fmt$(opt.new_monthly_escrow)}/mo</span></p>
                        {opt.total_payment && <p className="text-xs text-gray-500">Total payment: {fmt$(opt.total_payment)}/mo</p>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Editable fields */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Input label="Property Taxes ($)" type="number" value={escrowExtracted.total_property_taxes?.toString()??''} onChange={v=>setEscrowExtracted(p=>p?{...p,total_property_taxes:v?parseFloat(v):null}:p)} placeholder="9984.03" />
                <Input label="Insurance ($)" type="number" value={escrowExtracted.total_insurance?.toString()??''} onChange={v=>setEscrowExtracted(p=>p?{...p,total_insurance:v?parseFloat(v):null}:p)} placeholder="8018.39" />
                <Input label="Shortage (−) / Surplus (+) ($)" type="number" value={escrowExtracted.shortage_surplus_amount?.toString()??''} onChange={v=>setEscrowExtracted(p=>p?{...p,shortage_surplus_amount:v?parseFloat(v):null}:p)} placeholder="-930.96" />
                <Input label="New Monthly Escrow ($)" type="number" value={escrowExtracted.new_monthly_escrow?.toString()??''} onChange={v=>setEscrowExtracted(p=>p?{...p,new_monthly_escrow:v?parseFloat(v):null}:p)} placeholder="1577.78" />
                <Input label="Statement Date" type="date" value={escrowExtracted.statement_date??''} onChange={v=>setEscrowExtracted(p=>p?{...p,statement_date:v}:p)} />
                <div className="sm:col-span-2">
                  <Input label="Lender Name *" value={escrowLender} onChange={setEscrowLender} placeholder="e.g. Wells Fargo" />
                </div>
              </div>

              <button onClick={confirmEscrow} disabled={escrowSaving||!escrowLender} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {escrowSaving?'Saving…':'Confirm & Save'}
              </button>
            </div>
          )}
          <div className="space-y-4">
            {escrow.length===0&&!escrowExtracted ? (
              <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-400 dark:border-gray-700">No escrow accounts yet. Upload an annual escrow statement to get started.</div>
            ) : escrow.filter(e=>!editingEscrow||editingEscrow.id!==e.id).map(e=>(
              <div key={e.id} className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
                {/* Header */}
                <div className="flex items-center justify-between bg-gray-50 px-5 py-3 dark:bg-gray-900">
                  <div>
                    <p className="font-semibold">{e.lender_name}</p>
                    {e.loan_number&&<p className="text-xs text-gray-400">Loan #{e.loan_number}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={()=>startEditEscrow(e)} className="text-xs text-blue-600 hover:underline dark:text-blue-400">Edit</button>
                    <button onClick={()=>deleteEscrow(e.id)} disabled={deletingEscrowId===e.id} className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50">{deletingEscrowId===e.id?'Deleting…':'Delete'}</button>
                  </div>
                </div>
                {/* Body */}
                <div className="p-5">
                  {(e.analysis_period_start||e.analysis_period_end)&&(
                    <p className="mb-4 text-xs text-gray-400">Analysis period: {e.analysis_period_start} → {e.analysis_period_end}</p>
                  )}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900">
                      <p className="text-xs text-gray-500">Property Taxes</p>
                      <p className="mt-1 text-lg font-bold tabular">{e.total_property_taxes!=null?'$'+e.total_property_taxes.toLocaleString(undefined,{minimumFractionDigits:2}):'—'}</p>
                      <p className="text-xs text-gray-400">paid this year</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900">
                      <p className="text-xs text-gray-500">Insurance</p>
                      <p className="mt-1 text-lg font-bold tabular">{e.total_insurance!=null?'$'+e.total_insurance.toLocaleString(undefined,{minimumFractionDigits:2}):'—'}</p>
                      <p className="text-xs text-gray-400">paid this year</p>
                    </div>
                    <div className={`rounded-lg p-3 ${(e.shortage_surplus_amount??0)<0?'bg-red-50 dark:bg-red-950/20':'bg-green-50 dark:bg-green-950/20'}`}>
                      <p className={`text-xs ${(e.shortage_surplus_amount??0)<0?'text-red-500':'text-green-600'}`}>{(e.shortage_surplus_amount??0)<0?'Escrow Shortage':'Escrow Surplus'}</p>
                      <p className={`mt-1 text-lg font-bold tabular ${(e.shortage_surplus_amount??0)<0?'text-red-600':'text-green-600'}`}>
                        {e.shortage_surplus_amount!=null?`${e.shortage_surplus_amount<0?'-':'+'}$${Math.abs(e.shortage_surplus_amount).toLocaleString(undefined,{minimumFractionDigits:2})}`:'—'}
                      </p>
                      <p className="text-xs text-gray-400">{(e.shortage_surplus_amount??0)<0?'owed to lender':'returned to you'}</p>
                    </div>
                    <div className="rounded-lg bg-blue-50 p-3 dark:bg-blue-950/20">
                      <p className="text-xs text-blue-600 dark:text-blue-400">New Monthly Payment</p>
                      <p className="mt-1 text-lg font-bold tabular text-blue-700 dark:text-blue-300">{e.new_monthly_escrow!=null?'$'+e.new_monthly_escrow.toLocaleString(undefined,{minimumFractionDigits:2}):'—'}</p>
                      <p className="text-xs text-gray-400">escrow portion</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {/* Edit panel */}
            {editingEscrow&&(
              <div className="rounded-xl border-2 border-blue-300 bg-blue-50 p-5 space-y-4 dark:border-blue-700 dark:bg-blue-950/20">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-blue-800 dark:text-blue-300">Editing — {editingEscrow.lender_name}</h3>
                  <button onClick={()=>setEditingEscrow(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Input label="Lender Name" value={editEscrowData.lender_name??''} onChange={v=>setEditEscrowData(p=>({...p,lender_name:v}))} />
                  <Input label="Statement Date" type="date" value={editEscrowData.statement_date??''} onChange={v=>setEditEscrowData(p=>({...p,statement_date:v}))} />
                  <Input label="Period Start" type="date" value={editEscrowData.analysis_period_start??''} onChange={v=>setEditEscrowData(p=>({...p,analysis_period_start:v}))} />
                  <Input label="Period End" type="date" value={editEscrowData.analysis_period_end??''} onChange={v=>setEditEscrowData(p=>({...p,analysis_period_end:v}))} />
                  <Input label="Property Taxes ($)" type="number" value={editEscrowData.total_property_taxes?.toString()??''} onChange={v=>setEditEscrowData(p=>({...p,total_property_taxes:v?parseFloat(v):null}))} placeholder="9984.03" />
                  <Input label="Insurance ($)" type="number" value={editEscrowData.total_insurance?.toString()??''} onChange={v=>setEditEscrowData(p=>({...p,total_insurance:v?parseFloat(v):null}))} placeholder="8018.39" />
                  <Input label="Shortage (−) / Surplus (+) ($)" type="number" value={editEscrowData.shortage_surplus_amount?.toString()??''} onChange={v=>setEditEscrowData(p=>({...p,shortage_surplus_amount:v?parseFloat(v):null}))} placeholder="-930.96" />
                  <Input label="New Monthly Escrow ($)" type="number" value={editEscrowData.new_monthly_escrow?.toString()??''} onChange={v=>setEditEscrowData(p=>({...p,new_monthly_escrow:v?parseFloat(v):null}))} placeholder="1577.78" />
                </div>
                <button onClick={saveEditEscrow} disabled={editEscrowSaving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {editEscrowSaving?'Saving…':'Save Changes'}
                </button>
              </div>
            )}
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

          {/* Extraction review panel */}
          {insuranceExtracted&&(
            <InsuranceForm
              data={insuranceExtracted}
              onChange={patch=>setInsuranceExtracted(prev=>prev?{...prev,...patch}:prev)}
              onSave={confirmInsurance}
              onDiscard={()=>setInsuranceExtracted(null)}
              saving={insuranceSaving}
              title="✦ AI Extracted — Review & Edit Before Saving"
            />
          )}

          {/* Edit panel */}
          {editingInsurance&&(
            <InsuranceForm
              data={editInsuranceData}
              onChange={patch=>setEditInsuranceData(prev=>({...prev,...patch}))}
              onSave={saveEditInsurance}
              onDiscard={()=>setEditingInsurance(null)}
              saving={editInsuranceSaving}
              title={`Editing — ${editingInsurance.carrier}`}
            />
          )}

          <div className="space-y-3">
            {insurance.length===0&&!insuranceExtracted?<div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-400 dark:border-gray-700">No insurance policies yet.</div>:insurance.filter(p=>!editingInsurance||editingInsurance.id!==p.id).map(p=>{
              const daysLeft=Math.ceil((new Date(p.expiration_date).getTime()-Date.now())/86400000);
              const coverageFields = [
                {label:'Dwelling', val:p.dwelling_coverage},
                {label:'Other Structures', val:p.other_structures_coverage},
                {label:'Personal Property', val:p.personal_property_coverage},
                {label:'Loss of Use', val:p.loss_of_use_coverage},
                {label:'Liability', val:p.liability_coverage},
                {label:'Medical Payments', val:p.medical_payments_coverage},
                {label:'Loss of Rent', val:p.loss_of_rent_coverage},
                {label:'Flood', val:p.flood_coverage},
              ].filter(f=>f.val!=null);
              const deductibleFields = [
                {label:'Standard Deductible', val:p.deductible},
                {label:'Hurricane Deductible', val:p.hurricane_deductible},
                {label:'Wind/Hail Deductible', val:p.wind_hail_deductible},
              ].filter(f=>f.val!=null);
              return(
                <div key={p.id} className="rounded-xl border border-gray-200 p-5 dark:border-gray-800">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium">{p.carrier}</p>
                        {p.policy_type&&<span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">{p.policy_type}</span>}
                        {p.policy_number&&<span className="text-xs text-gray-400">#{p.policy_number}</span>}
                        {p.extracted_by_ai&&<span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">AI parsed</span>}
                      </div>
                      <p className="mt-1 text-sm text-gray-500">{p.effective_date} → {p.expiration_date}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className={`text-sm font-medium ${daysLeft<=60?'text-amber-600':'text-gray-500'}`}>{daysLeft<=0?'Expired':daysLeft<=60?`Expires in ${daysLeft}d`:`${daysLeft}d remaining`}</p>
                      <button onClick={()=>startEditInsurance(p)} className="text-xs text-blue-600 hover:underline dark:text-blue-400">Edit</button>
                      <button onClick={()=>deleteInsurance(p.id)} disabled={deletingInsuranceId===p.id} className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50">{deletingInsuranceId===p.id?'Deleting…':'Delete'}</button>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {p.annual_premium!=null&&<div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900"><p className="text-xs text-gray-500">Annual Premium</p><p className="font-semibold tabular">{fmt$(p.annual_premium)}/yr</p></div>}
                    {coverageFields.map(f=>(
                      <div key={f.label} className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900">
                        <p className="text-xs text-gray-500">{f.label}</p>
                        <p className="font-medium tabular">{fmt$(f.val)}</p>
                      </div>
                    ))}
                    {deductibleFields.map(f=>(
                      <div key={f.label} className="rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20">
                        <p className="text-xs text-amber-600 dark:text-amber-400">{f.label}</p>
                        <p className="font-medium tabular text-amber-700 dark:text-amber-300">{fmt$(f.val)}</p>
                      </div>
                    ))}
                    {p.loss_of_rent_months!=null&&<div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900"><p className="text-xs text-gray-500">Loss of Rent Period</p><p className="font-medium">{p.loss_of_rent_months} months</p></div>}
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
