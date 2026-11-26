'use client';

import { Fragment, Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { TradePicker, TradePills } from '@/components/TradePicker';
import { ProjectsOverview } from '@/components/ProjectsOverview';
import { useTrades } from '@/lib/useTrades';

interface Vendor {
  id: number; name: string; trade: string; trades?: string[]; phone: string | null; email: string | null;
  google_rating: number | null; google_review_count: number | null;
  manual_rating: number | null; manual_notes: string | null;
  total_jobs: number; completed_jobs: number; avg_internal_rating: number | null; total_spend: number | null;
  project_count: number | null;
  /** Average of "My rating" on the vendor's projects (null when none are rated). */
  avg_project_rating?: number | string | null;
  rated_projects?: number;
  /** Projects per trade (a project counts under each of its trades). */
  projects_by_trade?: Record<string, number>;
  /** Projects with no trade (listed under the vendor's first trade). */
  untagged_projects?: number;
  is_active: boolean;
}

interface VendorQuote {
  id: number; work_order_id: number; quoted_cost: number | null; final_cost: number | null;
  is_selected: boolean; notes: string | null;
  project_name: string | null; description: string | null; status: string | null;
  property_address: string | null; property_id?: number;
  rating?: number | null; review_notes?: string | null; quote_status?: string | null; trades?: string[];
}
interface WorkOrderOption { id: number; project_name: string | null; description: string | null; property_address: string | null; }

// total_spend = selected quotes (final, else quoted); actual_spend = finance transactions linked to those projects.
interface SpendVendor { vendor_id: number; vendor_name: string; trade: string; total_spend: number; last_90_days_spend: number; last_active_date: string | null; actual_spend: number; last_90_days_actual: number; actual_transaction_count: number; }
interface SpendByPropertyUnit { unit_id: number; unit_label: string; total_spend: number; actual_spend: number; }
interface SpendByProperty { property_id: number; address: string; total_spend: number; actual_spend: number; units: SpendByPropertyUnit[]; }
interface SpendResponse { vendors: SpendVendor[]; by_property: SpendByProperty[]; }

interface VendorQuoteExtracted {
  vendor_name: string | null; vendor_phone: string | null; vendor_email: string | null;
  trade: string | null; project_name: string | null; quoted_cost: number | null;
  scope_of_work: string | null; quote_date: string | null; confidence_notes: string | null;
}

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const vendorTrades = (v: { trade: string; trades?: string[] }) => (v.trades?.length ? v.trades : v.trade ? [v.trade] : ['other']);
function fmt$(n: number | null) { return n == null ? '—' : '$' + Number(n).toLocaleString(); }
function Stars({ rating, max = 5 }: { rating: number | null; max?: number }) {
  if (!rating) return <span className="text-xs text-gray-400">—</span>;
  return <span className="text-amber-500 text-sm">{'★'.repeat(Math.round(rating))}{'☆'.repeat(max - Math.round(rating))}</span>;
}

type AddMode = null | 'choice' | 'manual' | 'import';

export default function VendorsPage() {
  return (
    <Suspense fallback={null}>
      <VendorsPageInner />
    </Suspense>
  );
}

function VendorsPageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const view = params.get('view') === 'projects' ? 'projects' : 'vendors';
  const setView = (v: 'vendors' | 'projects') => router.replace(v === 'projects' ? '/vendors?view=projects' : '/vendors', { scroll: false });
  const { trades, label: tradeLabel } = useTrades();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [spend, setSpend] = useState<SpendResponse | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [addMode, setAddMode] = useState<AddMode>(null);
  // Which vendor row is open: "trade:vendorId" (a vendor can sit under several trades).
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [groupBy, setGroupByState] = useState<'trade' | 'vendor'>('trade');
  useEffect(() => {
    try { if (localStorage.getItem('vendors-group-by') === 'vendor') setGroupByState('vendor'); } catch { /* not remembered */ }
  }, []);
  const setGroupBy = (g: 'trade' | 'vendor') => {
    setGroupByState(g);
    setExpandedKey(null);
    try { localStorage.setItem('vendors-group-by', g); } catch { /* not remembered */ }
  };
  const [collapsedTrades, setCollapsedTrades] = useState<Set<string>>(new Set());

  const toggleTrade = (trade: string) =>
    setCollapsedTrades(prev => {
      const next = new Set(prev);
      next.has(trade) ? next.delete(trade) : next.add(trade);
      return next;
    });

  // Manual add form
  const [form, setForm] = useState({ name: '', trades: [] as string[], phone: '', email: '', website: '' });
  const [saving, setSaving] = useState(false);

  // Post-save "assign to project?" prompt
  const [justCreated, setJustCreated] = useState<{ id: number; name: string } | null>(null);
  const [promptCreateProject, setPromptCreateProject] = useState(false);

  // Only the first load shows "Loading…": later refreshes (after a save) keep
  // the table, and any open vendor / project panel, on screen.
  const load = async (q = '') => {
    if (!vendors.length) setLoading(true);
    try {
      const [vRes, sRes] = await Promise.all([
        fetch(`/api/v2/vendors${q ? `?search=${encodeURIComponent(q)}` : ''}`),
        fetch('/api/v2/vendors/spend'),
      ]);
      const vData = vRes.ok ? await vRes.json() : [];
      setVendors(Array.isArray(vData) ? vData : []);
      if (sRes.ok) setSpend(await sRes.json());
    } catch (e) {
      console.error('Failed to load vendors:', e);
      setVendors([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name || !form.trades.length) return;
    setSaving(true);
    const res = await fetch('/api/v2/vendors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    setSaving(false);
    setAddMode(null);
    setForm({ name: '', trades: [], phone: '', email: '', website: '' });
    load();
    if (res.ok) {
      try {
        const v = await res.json();
        if (v?.id) { setJustCreated({ id: v.id, name: v.name }); setPromptCreateProject(false); }
      } catch { /* ignore — vendor still created */ }
    }
  };

  const spend90 = spend ? spend.vendors.reduce((s, v) => s + Number(v.last_90_days_spend || 0), 0) : 0;
  const spendAll = spend ? spend.by_property.reduce((s, p) => s + Number(p.total_spend || 0), 0) : 0;
  const actual90 = spend ? spend.vendors.reduce((s, v) => s + Number(v.last_90_days_actual || 0), 0) : 0;
  const actualAll = spend ? spend.by_property.reduce((s, p) => s + Number(p.actual_spend || 0), 0) : 0;
  const actualByVendor = new Map((spend?.vendors ?? []).map(v => [v.vendor_id, v]));

  // Group vendors by trade (a vendor with several trades shows under each):
  // trades in Admin → Trades order first, then any others alphabetically.
  const vendorsByTrade = (() => {
    const map = new Map<string, Vendor[]>();
    for (const v of vendors) {
      for (const t of vendorTrades(v)) (map.get(t) ?? map.set(t, []).get(t)!).push(v);
    }
    const order = trades.map(t => t.key);
    const known = order.filter(t => map.has(t));
    const extras = [...map.keys()].filter(t => !order.includes(t)).sort();
    return [...known, ...extras].map(t => ({ trade: t, vendors: map.get(t)! }));
  })();

  // Projects shown for a vendor under a trade: those tagged with that trade,
  // plus untagged ones under the vendor's first trade. By vendor: all of them.
  const projectCount = (v: Vendor, trade: string | null) =>
    trade == null ? v.project_count ?? 0 : (v.projects_by_trade?.[trade] ?? 0) + (trade === vendorTrades(v)[0] ? v.untagged_projects ?? 0 : 0);

  // A render function (not a component), so rows aren't remounted on each render.
  const vendorRow = (v: Vendor, trade: string | null) => {
    const key = `${trade ?? 'all'}:${v.id}`;
    const open = expandedKey === key;
    return (
      <Fragment key={key}>
        <tr onClick={() => setExpandedKey(k => (k === key ? null : key))} className={`cursor-pointer hover:bg-gray-50 ${open ? 'bg-gray-50' : ''}`}>
          <td className={`px-5 py-3 font-medium ${trade ? 'pl-10' : ''}`}>
            <span className="mr-2 inline-block text-gray-400">{open ? '▾' : '▸'}</span>
            {v.name}
          </td>
          <td className="px-5 py-3 text-gray-500"><TradePills keys={vendorTrades(v)} label={tradeLabel} /></td>
          <td className="px-5 py-3">
            {v.google_rating
              ? <span><Stars rating={v.google_rating} /> <span className="text-xs text-gray-400">({v.google_review_count})</span></span>
              : <span className="text-xs text-gray-400">Not found</span>}
          </td>
          <td className="px-5 py-3" title={v.avg_project_rating != null ? `Average of ${v.rated_projects} rated project${v.rated_projects === 1 ? '' : 's'}` : 'Overall rating (no rated projects yet)'}>
            <Stars rating={v.avg_project_rating != null ? Number(v.avg_project_rating) : v.manual_rating} />
            {v.avg_project_rating != null && <span className="ml-1 text-xs text-gray-400">{Number(v.avg_project_rating).toFixed(1)}</span>}
          </td>
          <td className="px-5 py-3 tabular" title={trade ? `${tradeLabel(trade)} projects` : 'All projects'}>{projectCount(v, trade)}</td>
          <td className="px-5 py-3 tabular">{v.completed_jobs}/{v.total_jobs}</td>
          <td className="px-5 py-3 tabular">{fmt$(v.total_spend)}</td>
          <td className="px-5 py-3 tabular" data-testid={`vendor-actual-${v.id}`}>
            {actualByVendor.get(v.id)?.actual_transaction_count ? fmt$(actualByVendor.get(v.id)!.actual_spend) : <span className="text-gray-300">—</span>}
          </td>
          <td className="px-5 py-3 text-gray-400 text-xs">
            {v.phone && <p>{v.phone}</p>}
            {v.email && <p>{v.email}</p>}
          </td>
        </tr>
        {open && (
          <tr className="bg-gray-50">
            <td colSpan={9} className="px-5 py-4">
              <VendorDetail vendor={v} trade={trade} onSaved={() => load(search)} onDeleted={() => { setExpandedKey(null); load(search); }} />
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Vendors</h1>
          <p className="text-sm text-gray-500">Contractors and service providers</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex overflow-hidden rounded-lg border border-gray-300 text-sm" role="tablist" aria-label="Vendors view">
            {(['vendors', 'projects'] as const).map(v => (
              <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
                className={`px-3 py-1.5 ${view === v ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>
                {v === 'vendors' ? 'Vendors' : 'Projects'}
              </button>
            ))}
          </div>
          {view === 'vendors' && (
            <button onClick={() => setAddMode('choice')} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
              + Add Vendor
            </button>
          )}
        </div>
      </div>

      {view === 'projects' ? <ProjectsOverview /> : (<>

      {/* Spend summary */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500">Last 90 Days Spend</p>
          <p className="mt-1 text-2xl font-bold tabular text-blue-600">{fmt$(spend90)}</p>
          <p className="text-xs text-gray-500 tabular" data-testid="vendors-actual-90">Actual {fmt$(actual90)} <span className="text-gray-400">from linked transactions</span></p>
          <p className="text-xs text-gray-400">quotes across all properties</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500">All-Time Spend</p>
          <p className="mt-1 text-2xl font-bold tabular">{fmt$(spendAll)}</p>
          <p className="text-xs text-gray-500 tabular" data-testid="vendors-actual-all">Actual {fmt$(actualAll)} <span className="text-gray-400">from linked transactions</span></p>
          <p className="text-xs text-gray-400">quotes across all properties</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500">Spend by Property</p>
          {spend && spend.by_property.length > 0 ? (
            <div className="mt-1 space-y-1">
              {spend.by_property.map(p => (
                <div key={p.property_id}>
                  <p className="text-sm font-semibold tabular">{p.address}: {fmt$(p.total_spend)} <span className="font-normal text-gray-500">· actual {fmt$(p.actual_spend)}</span></p>
                  {p.units.length > 0 && (
                    <p className="text-xs text-gray-400">{p.units.map(u => `Unit ${u.unit_label}: ${fmt$(u.total_spend)} (actual ${fmt$(u.actual_spend)})`).join('   ')}</p>
                  )}
                </div>
              ))}
            </div>
          ) : <p className="mt-1 text-sm text-gray-400">No spend recorded</p>}
        </div>
      </div>

      {/* Add-vendor choice */}
      {addMode === 'choice' && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold">Add a Vendor</h3>
            <button onClick={() => setAddMode(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => setAddMode('import')} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Import quotes from PDF or email</button>
            <button onClick={() => setAddMode('manual')} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">Enter Manually</button>
          </div>
        </div>
      )}

      {/* Import flow */}
      {addMode === 'import' && (
        <VendorImportPanel onCancel={() => setAddMode(null)} onDone={() => { setAddMode(null); load(); }} />
      )}

      {/* Manual add vendor form */}
      {addMode === 'manual' && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="mb-4 font-semibold">New Vendor</h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Name *', key: 'name', type: 'text' },
              { label: 'Phone', key: 'phone', type: 'tel' },
              { label: 'Email', key: 'email', type: 'email' },
              { label: 'Website', key: 'website', type: 'url' },
            ].map(f => (
              <div key={f.key}>
                <label className="mb-1 block text-xs text-gray-500">{f.label}</label>
                <input type={f.type} value={(form as unknown as Record<string, string>)[f.key]}
                  onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
            ))}
          </div>
          <div className="mt-3">
            <label className="mb-1 block text-xs text-gray-500">Trades * <span className="text-gray-400">(pick all that apply)</span></label>
            <TradePicker trades={trades} value={form.trades} onChange={next => setForm(prev => ({ ...prev, trades: next }))} label={tradeLabel} />
          </div>
          <p className="mt-2 text-xs text-gray-400">Google rating will be looked up automatically if available.</p>
          <div className="mt-4 flex gap-2">
            <button onClick={save} disabled={saving || !form.name || !form.trades.length} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Vendor'}
            </button>
            <button onClick={() => setAddMode(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Post-save: assign to project prompt */}
      {justCreated && (
        <div className="mb-6 rounded-xl border border-green-200 bg-green-50 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-green-800">Vendor “{justCreated.name}” saved</h3>
            <button onClick={() => { setJustCreated(null); setPromptCreateProject(false); }} className="text-xs text-gray-400 hover:text-gray-600">Close</button>
          </div>
          {!promptCreateProject ? (
            <>
              <p className="mb-3 text-sm text-gray-600">Would you like to assign this vendor to a project?</p>
              <div className="flex flex-wrap gap-3">
                <button onClick={() => setPromptCreateProject(true)}
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700">Create New Project</button>
                <button onClick={() => { setJustCreated(null); setPromptCreateProject(false); }}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">Skip for now</button>
              </div>
            </>
          ) : (
            <div className="max-w-md">
              <CreateProjectInline
                vendorId={justCreated.id}
                onCreated={() => { setJustCreated(null); setPromptCreateProject(false); load(search); }}
                onCancel={() => { setJustCreated(null); setPromptCreateProject(false); }}
              />
            </div>
          )}
        </div>
      )}

      {/* Search + view by trade / vendor */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-lg border border-gray-300 text-sm" role="group" aria-label="View vendors">
          {(['trade', 'vendor'] as const).map(g => (
            <button key={g} aria-pressed={groupBy === g} onClick={() => setGroupBy(g)}
              className={`px-3 py-1.5 ${groupBy === g ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>
              {g === 'trade' ? 'By trade' : 'By vendor'}
            </button>
          ))}
        </div>
        <input
          type="text" placeholder="Search by name or trade…" value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load(search)}
          className="min-w-[14rem] flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
      </div>

      {loading ? (
        <div className="py-12 text-center text-gray-400">Loading…</div>
      ) : vendors.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center text-gray-400">
          <p className="text-lg font-medium">No vendors yet</p>
          <p className="mt-1 text-sm">Add your contractors to start tracking projects and ratings.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {['Vendor', 'Trade', 'Google Rating', 'My Rating', 'Projects', 'Jobs', 'Total Spend', 'Actual Spend', 'Contact'].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium text-gray-500"
                    title={h === 'Actual Spend' ? 'Finance transactions linked to projects where this vendor is the selected quote' : undefined}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {groupBy === 'vendor'
                ? [...vendors].sort((a, b) => a.name.localeCompare(b.name)).map(v => vendorRow(v, null))
                : vendorsByTrade.map(({ trade, vendors: tradeVendors }) => {
                    const collapsed = collapsedTrades.has(trade);
                    return (
                      <Fragment key={trade}>
                        <tr onClick={() => toggleTrade(trade)} className="cursor-pointer bg-gray-100 hover:bg-gray-200/70">
                          <td colSpan={9} className="px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
                            <span className="mr-2 inline-block text-gray-400">{collapsed ? '▸' : '▾'}</span>
                            {tradeLabel(trade)}
                            <span className="ml-2 font-normal normal-case text-gray-400">({tradeVendors.length})</span>
                          </td>
                        </tr>
                        {!collapsed && tradeVendors.map(v => vendorRow(v, trade))}
                      </Fragment>
                    );
                  })}
            </tbody>
          </table>
        </div>
      )}
      </>)}
    </>
  );
}

// ── Vendor import: one or more quotes (PDF / email) → AI extract → review → save ──
// Drop several files at once: each is read in turn and gets its own card to
// check. Saving creates each vendor (or uses the matching existing one) and,
// if you pick a project, adds every quote to it — handy for comparing bids.
interface ImportItem {
  key: string;
  file: string;
  previewUrl: string | null;
  text?: string;
  status: 'reading' | 'ready' | 'error' | 'saved';
  error?: string;
  data?: VendorQuoteExtracted;
  trades: string[];
  vendorId: string; // '' = create a new vendor
  showSource: boolean;
}
interface VendorLite { id: number; name: string }

function VendorImportPanel({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const { trades, label: tradeLabel } = useTrades();
  const [items, setItems] = useState<ImportItem[]>([]);
  const [pastedText, setPastedText] = useState('');
  const [vendors, setVendorsState] = useState<VendorLite[]>([]);
  // The latest list, for matching names inside async reads (state in a closure can be stale).
  const vendorsRef = useRef<VendorLite[]>([]);
  const setVendors = (next: VendorLite[] | ((prev: VendorLite[]) => VendorLite[])) => {
    setVendorsState(prev => {
      const v = typeof next === 'function' ? next(prev) : next;
      vendorsRef.current = v;
      return v;
    });
  };
  const vendorsLoaded = useRef<Promise<void> | null>(null);
  const [projects, setProjects] = useState<WorkOrderOption[]>([]);
  const [projectId, setProjectId] = useState('');
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    vendorsLoaded.current = (async () => {
      const [v, w] = await Promise.all([
        fetch('/api/v2/vendors?activeOnly=false').then(r => (r.ok ? r.json() : [])).catch(() => []),
        fetch('/api/v2/work-orders').then(r => (r.ok ? r.json() : [])).catch(() => []),
      ]);
      setVendors(Array.isArray(v) ? v.map((x: VendorLite) => ({ id: x.id, name: x.name })) : []);
      setProjects(Array.isArray(w) ? w : []);
    })();
  }, []);
  useEffect(() => () => { items.forEach(i => i.previewUrl && URL.revokeObjectURL(i.previewUrl)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const patch = (key: string, p: Partial<ImportItem>) => setItems(list => list.map(i => (i.key === key ? { ...i, ...p } : i)));
  const patchData = (key: string, p: Partial<VendorQuoteExtracted>) => setItems(list => list.map(i => (i.key === key && i.data ? { ...i, data: { ...i.data, ...p } } : i)));
  const matchVendor = (name: string | null) => (name ? vendorsRef.current.find(v => v.name.toLowerCase().trim() === name.toLowerCase().trim()) : undefined);

  /** Read one file or pasted text through the AI parser. */
  async function read(item: ImportItem, form: FormData) {
    try {
      const res = await fetch('/api/v2/upload', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Couldn’t read this one');
      const data = json.extracted as VendorQuoteExtracted;
      await vendorsLoaded.current; // match against the full vendor list
      const m = matchVendor(data.vendor_name);
      patch(item.key, { status: 'ready', data, trades: data.trade ? [data.trade] : [], vendorId: m ? String(m.id) : '' });
    } catch (e) {
      patch(item.key, { status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }
  async function addFiles(files: FileList | File[]) {
    const list = [...files];
    const fresh: ImportItem[] = list.map((f, n) => ({
      key: `${Date.now()}-${n}-${f.name}`, file: f.name, status: 'reading', trades: [], vendorId: '', showSource: false,
      previewUrl: f.type === 'application/pdf' ? URL.createObjectURL(f) : null,
    }));
    setItems(prev => [...prev, ...fresh]);
    setSummary(null);
    // One at a time: keeps the parser (and its rate limits) happy.
    for (let n = 0; n < list.length; n += 1) {
      const form = new FormData(); form.append('file', list[n]!); form.append('type', 'vendor_quote');
      await read(fresh[n]!, form);
    }
  }
  async function addText() {
    if (!pastedText.trim()) return;
    const item: ImportItem = { key: `${Date.now()}-text`, file: 'Pasted text', text: pastedText, previewUrl: null, status: 'reading', trades: [], vendorId: '', showSource: false };
    setItems(prev => [...prev, item]);
    setPastedText('');
    const form = new FormData(); form.append('text', item.text!); form.append('type', 'vendor_quote');
    await read(item, form);
  }

  const ready = items.filter(i => i.status === 'ready' && i.data);
  const reading = items.filter(i => i.status === 'reading').length;

  async function saveAll() {
    setSaving(true);
    let made = 0, quoted = 0;
    const failed: string[] = [];
    for (const i of ready) {
      try {
        // Same name as a vendor you already have (or one saved earlier in this batch): use it.
        let vendorId = i.vendorId ? Number(i.vendorId) : matchVendor(i.data!.vendor_name)?.id ?? null;
        if (!vendorId) {
          if (!i.data!.vendor_name?.trim()) throw new Error('needs a vendor name');
          const res = await fetch('/api/v2/vendors', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: i.data!.vendor_name, phone: i.data!.vendor_phone ?? null, email: i.data!.vendor_email ?? null, trades: i.trades.length ? i.trades : ['general'] }),
          });
          const v = await res.json();
          if (!res.ok || !v?.id) throw new Error(v?.error ?? 'vendor not saved');
          vendorId = v.id;
          made += 1;
          setVendors(list => [...list, { id: v.id, name: v.name }]);
        }
        if (projectId) {
          const res = await fetch('/api/v2/project-quotes', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ work_order_id: Number(projectId), vendor_id: vendorId, quoted_cost: i.data!.quoted_cost ?? null, notes: i.data!.scope_of_work ?? null }),
          });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'quote not saved');
          quoted += 1;
        }
        patch(i.key, { status: 'saved', vendorId: String(vendorId) });
      } catch (e) {
        failed.push(`${i.data?.vendor_name || i.file}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setSaving(false);
    setSummary([made && `${made} new vendor${made === 1 ? '' : 's'}`, quoted && `${quoted} quote${quoted === 1 ? '' : 's'} added to the project`].filter(Boolean).join(', ') + (failed.length ? `. Not saved: ${failed.join('; ')}` : '') || 'Nothing to save.');
    if (!failed.length) onDone();
  }

  const inp = 'w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none';
  return (
    <div className="mb-6 space-y-4 rounded-xl border-2 border-blue-300 bg-blue-50 p-5" data-testid="vendor-import">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-blue-800">Import quotes from PDF or email</h3>
        <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
      </div>

      <label
        className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-blue-300 bg-white/50 px-4 py-6 text-sm text-blue-600 hover:bg-blue-100/50"
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files); }}
      >
        Drop one or more quotes, invoices or emails here (PDF / .eml / .txt), or click to pick
        <input aria-label="Quote files" type="file" multiple accept=".pdf,.eml,.txt,image/*" className="hidden"
          onChange={e => { if (e.target.files?.length) void addFiles(e.target.files); e.target.value = ''; }} />
      </label>
      <div className="flex flex-wrap items-end gap-2">
        <textarea aria-label="Pasted quote text" value={pastedText} onChange={e => setPastedText(e.target.value)} rows={2} placeholder="…or paste the text of a quote or email"
          className="min-w-[16rem] flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
        <button onClick={() => void addText()} disabled={!pastedText.trim()} className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-50">Read text</button>
      </div>

      {items.length > 0 && (
        <>
          <label className="block text-xs text-gray-600">
            Add these quotes to a project <span className="text-gray-400">(optional — e.g. to compare bids)</span>
            <select aria-label="Project for the quotes" value={projectId} onChange={e => setProjectId(e.target.value)} className="mt-1 block w-full max-w-xl rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm">
              <option value="">Don’t add to a project — just save the vendors</option>
              {projects.map(w => <option key={w.id} value={w.id}>{w.project_name || w.description || `Project #${w.id}`}{w.property_address ? ` — ${w.property_address}` : ''}</option>)}
            </select>
          </label>

          <div className="space-y-3">
            {items.map((i, n) => (
              <div key={i.key} className={`rounded-lg border bg-white p-3 ${i.status === 'saved' ? 'border-green-300' : i.status === 'error' ? 'border-red-300' : 'border-gray-200'}`} data-testid={`import-item-${n}`}>
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-gray-700">Quote {n + 1}</span>
                  <span className="text-gray-400">{i.file}</span>
                  {i.status === 'reading' && <span className="text-blue-600">Reading…</span>}
                  {i.status === 'saved' && <span className="text-green-700">✓ Saved</span>}
                  {i.status === 'error' && <span className="text-red-600">{i.error}</span>}
                  <span className="ml-auto flex gap-2">
                    {(i.previewUrl || i.text) && <button onClick={() => patch(i.key, { showSource: !i.showSource })} className="text-blue-600 hover:underline">{i.showSource ? 'Hide source' : 'Show source'}</button>}
                    {i.status !== 'saved' && <button onClick={() => setItems(list => list.filter(x => x.key !== i.key))} className="text-gray-400 hover:text-red-600">Remove</button>}
                  </span>
                </div>
                {i.showSource && (i.previewUrl
                  ? <iframe src={i.previewUrl} className="mb-2 h-80 w-full rounded border" title={`Source ${n + 1}`} />
                  : <pre className="mb-2 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs text-gray-600">{i.text}</pre>)}
                {i.data && i.status !== 'saved' && (
                  <div className="space-y-2">
                    {i.data.confidence_notes && <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">⚠ {i.data.confidence_notes}</p>}
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                      <label className="text-xs text-gray-500">Vendor<input aria-label={`Vendor name ${n + 1}`} className={inp} value={i.data.vendor_name ?? ''}
                        onChange={e => { patchData(i.key, { vendor_name: e.target.value }); const m = matchVendor(e.target.value); patch(i.key, { vendorId: m ? String(m.id) : '' }); }} /></label>
                      <label className="text-xs text-gray-500">Phone<input className={inp} value={i.data.vendor_phone ?? ''} onChange={e => patchData(i.key, { vendor_phone: e.target.value })} /></label>
                      <label className="text-xs text-gray-500">Email<input className={inp} value={i.data.vendor_email ?? ''} onChange={e => patchData(i.key, { vendor_email: e.target.value })} /></label>
                      <label className="text-xs text-gray-500">Quoted ($)<input aria-label={`Quoted ${n + 1}`} type="number" className={inp} value={i.data.quoted_cost?.toString() ?? ''} onChange={e => patchData(i.key, { quoted_cost: e.target.value ? parseFloat(e.target.value) : null })} /></label>
                    </div>
                    <label className="block text-xs text-gray-500">Scope of work<textarea rows={2} className={inp} value={i.data.scope_of_work ?? ''} onChange={e => patchData(i.key, { scope_of_work: e.target.value })} /></label>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
                      <select aria-label={`Vendor record ${n + 1}`} value={i.vendorId} onChange={e => patch(i.key, { vendorId: e.target.value })} className="rounded-lg border border-gray-300 px-2 py-1 text-sm">
                        <option value="">Create a new vendor</option>
                        {vendors.map(v => <option key={v.id} value={v.id}>Use existing: {v.name}</option>)}
                      </select>
                      {!i.vendorId && <TradePicker trades={trades} value={i.trades} onChange={next => patch(i.key, { trades: next })} label={tradeLabel} ariaLabel={`Trades ${n + 1}`} />}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {summary && <p className="text-sm text-gray-700">{summary}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={onCancel} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm hover:bg-gray-50">Close</button>
            <button onClick={() => void saveAll()} disabled={saving || reading > 0 || !ready.length}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : reading ? `Reading ${reading}…` : `Save ${ready.length} quote${ready.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Expandable vendor detail ──────────────────────────────────────────────────────
// Top: name and trades, with phone, email and the vendor's rating (the average
// of your project ratings) at the top right. Middle: the vendor's projects,
// each with its own rating and notes. Bottom: the vendor's details, or, when
// you click a project, that project's editor (rating, notes, status, and this
// vendor's quote) with a Save button.
function VendorDetail({ vendor, trade = null, onSaved, onDeleted }: { vendor: Vendor; trade?: string | null; onSaved: () => void; onDeleted: () => void }) {
  const { trades, label: tradeLabel } = useTrades();
  // Opened under a trade: only that trade's projects (untagged ones go with the vendor's first trade).
  const [showAll, setShowAll] = useState(false);
  const [form, setForm] = useState({
    name: vendor.name ?? '', trades: vendorTrades(vendor),
    phone: vendor.phone ?? '', email: vendor.email ?? '',
    manual_notes: vendor.manual_notes ?? '', manual_rating: vendor.manual_rating ?? 0,
  });
  const [quotes, setQuotes] = useState<VendorQuote[]>([]);
  const [rating, setRating] = useState<{ avg: number | null; count: number }>({ avg: vendor.avg_project_rating != null ? Number(vendor.avg_project_rating) : null, count: vendor.rated_projects ?? 0 });
  const [loadingQuotes, setLoadingQuotes] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [openQuoteId, setOpenQuoteId] = useState<number | null>(null);

  // Assign-to-project UI
  const [assigning, setAssigning] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [workOrders, setWorkOrders] = useState<WorkOrderOption[]>([]);
  const [assignWoId, setAssignWoId] = useState('');
  const [assignCost, setAssignCost] = useState('');
  const [assignSaving, setAssignSaving] = useState(false);

  const loadDetail = async () => {
    setLoadingQuotes(true);
    try {
      const res = await fetch(`/api/v2/vendors/${vendor.id}`);
      if (res.ok) {
        const data = await res.json();
        setQuotes(Array.isArray(data.quotes) ? data.quotes : []);
        setRating({ avg: data.avg_project_rating != null ? Number(data.avg_project_rating) : null, count: data.rated_projects ?? 0 });
      }
    } catch (e) {
      console.error('Failed to load vendor detail:', e);
    } finally {
      setLoadingQuotes(false);
    }
  };
  useEffect(() => { loadDetail(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [vendor.id]);

  const save = async () => {
    setSaving(true);
    try {
      await fetch(`/api/v2/vendors/${vendor.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, manual_rating: form.manual_rating || null }),
      });
      onSaved();
    } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!confirm(`Delete vendor "${vendor.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await fetch(`/api/v2/vendors/${vendor.id}`, { method: 'DELETE' });
      onDeleted();
    } finally { setDeleting(false); }
  };

  const openAssign = async () => {
    setAssigning(true);
    setCreatingProject(false);
    try {
      const res = await fetch('/api/v2/work-orders');
      if (res.ok) {
        const data = await res.json();
        setWorkOrders(Array.isArray(data) ? data : []);
      }
    } catch (e) { console.error('Failed to load projects:', e); }
  };
  const closeAssign = () => { setAssigning(false); setCreatingProject(false); setAssignWoId(''); setAssignCost(''); };
  const submitAssign = async () => {
    if (!assignWoId) return;
    setAssignSaving(true);
    try {
      await fetch('/api/v2/project-quotes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_order_id: Number(assignWoId), vendor_id: vendor.id, quoted_cost: assignCost ? parseFloat(assignCost) : null }),
      });
      closeAssign();
      loadDetail();
      onSaved();
    } finally { setAssignSaving(false); }
  };

  const woLabel = (w: WorkOrderOption) => `${w.project_name || w.description || `Project #${w.id}`}${w.property_address ? ` — ${w.property_address}` : ''}`;
  const quoteLabel = (q: VendorQuote) => q.project_name || q.description || `Project #${q.work_order_id}`;
  const inTrade = (q: VendorQuote) => !trade || (q.trades?.length ? q.trades.includes(trade) : trade === vendorTrades(vendor)[0]);
  const shownQuotes = showAll ? quotes : quotes.filter(inTrade);
  const hiddenCount = quotes.length - shownQuotes.length;
  const open = shownQuotes.find((q) => q.id === openQuoteId) ?? null;
  const shownRating = rating.avg ?? (vendor.manual_rating || null);

  return (
    <div className="space-y-5" data-testid={`vendor-detail-${vendor.id}`}>
      {/* Header: name + trades; contact and rating top right */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold">{vendor.name}</div>
          <div className="mt-1"><TradePills keys={vendorTrades(vendor)} label={tradeLabel} /></div>
        </div>
        <div className="text-right text-sm" data-testid="vendor-contact">
          {vendor.phone && <div><a href={`tel:${vendor.phone}`} className="text-blue-600 hover:underline">📞 {vendor.phone}</a></div>}
          {vendor.email && <div><a href={`mailto:${vendor.email}`} className="text-blue-600 hover:underline">✉ {vendor.email}</a></div>}
          <div className="mt-1" data-testid="vendor-rating">
            <Stars rating={shownRating} />
            <span className="ml-1 text-xs text-gray-500">
              {rating.avg != null ? `${rating.avg.toFixed(1)} · average of ${rating.count} rated project${rating.count === 1 ? '' : 's'}` : vendor.manual_rating ? 'overall rating (no rated projects yet)' : 'no ratings yet'}
            </span>
          </div>
        </div>
      </div>

      {/* Projects */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {trade && !showAll ? `${tradeLabel(trade)} projects` : 'Projects'} <span className="font-normal normal-case text-gray-400">— click one to see and edit it</span>
            {trade && (hiddenCount > 0 || showAll) && (
              <button onClick={() => setShowAll(v => !v)} className="ml-2 font-normal normal-case text-blue-600 hover:underline">
                {showAll ? `Only ${tradeLabel(trade)}` : `Show all (${hiddenCount} more in other trades)`}
              </button>
            )}
          </h4>
          {!assigning && <button onClick={openAssign} className="text-xs font-medium text-blue-600 hover:text-blue-700">+ Assign to Project</button>}
        </div>
        {assigning && (
          creatingProject ? (
            <div className="mb-3 max-w-md">
              <CreateProjectInline vendorId={vendor.id} onCreated={() => { closeAssign(); loadDetail(); onSaved(); }} onCancel={() => setCreatingProject(false)} />
            </div>
          ) : (
            <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
              <label className="text-xs text-gray-500">Project
                <select value={assignWoId} onChange={e => setAssignWoId(e.target.value)} className="mt-1 block rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  <option value="">Select a project…</option>
                  {workOrders.map(w => <option key={w.id} value={w.id}>{woLabel(w)}</option>)}
                </select>
              </label>
              <label className="text-xs text-gray-500">Quoted Cost ($)
                <input type="number" value={assignCost} onChange={e => setAssignCost(e.target.value)} className="mt-1 block w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </label>
              <button onClick={submitAssign} disabled={assignSaving || !assignWoId} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">{assignSaving ? 'Saving…' : 'Assign'}</button>
              <button onClick={() => setCreatingProject(true)} className="rounded-lg border border-green-300 px-3 py-2 text-xs font-medium text-green-700 hover:bg-green-50">+ Create New Project</button>
              <button onClick={closeAssign} className="rounded-lg border border-gray-300 px-3 py-2 text-xs hover:bg-gray-50">Cancel</button>
            </div>
          )
        )}
        {loadingQuotes ? (
          <p className="text-sm text-gray-400">Loading projects…</p>
        ) : shownQuotes.length === 0 ? (
          <p className="text-sm text-gray-400">{quotes.length ? `No ${trade ? tradeLabel(trade) : ''} projects.` : 'No projects assigned yet.'}</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-gray-100">
                <tr>{['Project', 'Status', 'Quoted', 'Final', 'My rating', 'Notes'].map(h => <th key={h} className="px-3 py-2 text-left font-medium text-gray-500">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {shownQuotes.map(q => (
                  <tr key={q.id} onClick={() => setOpenQuoteId(id => (id === q.id ? null : q.id))}
                    className={`cursor-pointer hover:bg-blue-50/60 ${openQuoteId === q.id ? 'bg-blue-50' : ''}`} data-testid={`vendor-project-${q.work_order_id}`}>
                    <td className="px-3 py-2">
                      <span className="font-medium">{quoteLabel(q)}</span>
                      {q.is_selected && <span className="ml-1 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] text-green-700">did the work</span>}
                      {q.property_address && <span className="block text-gray-400">{q.property_address}</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-500">{q.status ? capitalize(q.status) : '—'}</td>
                    <td className="px-3 py-2 tabular">{fmt$(q.quoted_cost)}</td>
                    <td className="px-3 py-2 tabular">{fmt$(q.final_cost)}</td>
                    <td className="px-3 py-2"><Stars rating={q.rating ?? null} /></td>
                    <td className="max-w-[18rem] px-3 py-2 text-gray-500">
                      <span className="line-clamp-2" title={[q.review_notes, q.description].filter(Boolean).join(' — ')}>{q.review_notes || q.description || '—'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Lower half: the clicked project, or the vendor's details */}
      {open ? (
        <VendorProjectPanel key={open.id} quote={open} vendorName={vendor.name}
          onClose={() => setOpenQuoteId(null)}
          onSaved={() => { loadDetail(); onSaved(); }} />
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Vendor details</h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-gray-500">Name</label>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">Overall rating <span className="text-gray-400">(used until a project is rated)</span></label>
              <select value={form.manual_rating} onChange={e => setForm(p => ({ ...p, manual_rating: Number(e.target.value) }))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                <option value={0}>—</option>
                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{'★'.repeat(n)}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-gray-500">Trades <span className="text-gray-400">(pick all that apply)</span></label>
              <TradePicker trades={trades} value={form.trades} onChange={next => setForm(p => ({ ...p, trades: next }))} label={tradeLabel} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">Phone</label>
              <input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">Email</label>
              <input value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
            </div>
          </div>
          <div className="mt-3">
            <label className="mb-1 block text-xs text-gray-500">Notes about this vendor</label>
            <textarea value={form.manual_notes} onChange={e => setForm(p => ({ ...p, manual_notes: e.target.value }))} rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={save} disabled={saving || !form.trades.length} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            <button onClick={remove} disabled={deleting} className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">{deleting ? 'Deleting…' : 'Delete'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── One project, from the vendor's side: the project's rating, notes, status and
// description, and this vendor's quote. Everything saves together.
interface ProjectFull {
  id: number; project_name: string | null; description: string | null; status: string; property_id: number; property_address: string | null;
  rating: number | null; review_notes: string | null;
  quotes: { id: number; vendor_id: number; vendor_name: string; quoted_cost: number | null; final_cost: number | null; is_selected: boolean; status: string | null; notes: string | null }[];
}
function VendorProjectPanel({ quote, vendorName, onClose, onSaved }: { quote: VendorQuote; vendorName: string; onClose: () => void; onSaved: () => void }) {
  const [p, setP] = useState<ProjectFull | null>(null);
  const [edit, setEdit] = useState<null | {
    status: string; description: string; rating: number | null; review_notes: string;
    quoted: string; final: string; notes: string; quote_status: string; selected: boolean;
  }>(null);
  const [initial, setInitial] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch(`/api/v2/work-orders/${quote.work_order_id}`);
    if (!res.ok) { setMsg('Couldn’t load this project.'); return; }
    const data: ProjectFull = await res.json();
    setP(data);
    const mine = data.quotes.find((q) => q.id === quote.id);
    const e = {
      status: data.status, description: data.description ?? '', rating: data.rating ?? null, review_notes: data.review_notes ?? '',
      quoted: mine?.quoted_cost != null ? String(Number(mine.quoted_cost)) : '', final: mine?.final_cost != null ? String(Number(mine.final_cost)) : '',
      notes: mine?.notes ?? '', quote_status: mine?.status ?? 'received', selected: !!mine?.is_selected,
    };
    setEdit(e);
    setInitial(JSON.stringify(e));
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [quote.id]);

  if (!p || !edit) return <div className="rounded-lg border border-blue-200 bg-white p-4 text-sm text-gray-400">{msg ?? 'Loading project…'}</div>;
  const dirty = JSON.stringify(edit) !== initial;
  const set = (x: Partial<typeof edit>) => { setEdit({ ...edit, ...x }); setMsg(null); };
  const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none';

  async function save() {
    if (!edit) return;
    setSaving(true);
    setMsg(null);
    try {
      const a = await fetch(`/api/v2/work-orders/${p!.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: edit.status, description: edit.description, rating: edit.rating, review_notes: edit.review_notes }),
      });
      const b = await fetch(`/api/v2/project-quotes/${quote.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoted_cost: edit.quoted === '' ? null : Number(edit.quoted), final_cost: edit.final === '' ? null : Number(edit.final),
          notes: edit.notes, status: edit.quote_status, ...(edit.selected ? { is_selected: true } : { is_selected: false }),
        }),
      });
      if (!a.ok || !b.ok) throw new Error('Couldn’t save — try again.');
      await load();
      setMsg('Saved.');
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const others = p.quotes.filter((q) => q.id !== quote.id);
  return (
    <div className="space-y-4 rounded-lg border-2 border-blue-200 bg-white p-4" data-testid="vendor-project-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold">{p.project_name || p.description || `Project #${p.id}`}</div>
          <div className="text-xs text-gray-500">
            {p.property_address ?? ''} · <a href={`/properties/${p.property_id}?tab=projects&project=${p.id}`} className="text-blue-600 hover:underline">Open in the property’s Projects tab →</a>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs ${dirty ? 'font-medium text-amber-700' : msg === 'Saved.' ? 'text-green-700' : msg ? 'text-red-600' : 'text-gray-400'}`}>{dirty ? 'Unsaved changes' : msg ?? ''}</span>
          <button onClick={() => void save()} disabled={!dirty || saving} className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40">{saving ? 'Saving…' : 'Save'}</button>
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">{dirty ? 'Discard & close' : 'Close'}</button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">The project</h5>
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <span className="mb-1 block text-xs text-gray-500">My rating for this project</span>
              <span className="inline-flex" role="radiogroup" aria-label="Project rating">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={edit.rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`}
                    onClick={() => set({ rating: edit.rating === n ? null : n })}
                    className={`text-xl leading-none ${edit.rating && n <= edit.rating ? 'text-amber-500' : 'text-gray-300 hover:text-amber-300'}`}>★</button>
                ))}
              </span>
            </div>
            <label className="text-xs text-gray-500">Project status
              <select aria-label="Project status" value={edit.status} onChange={(e) => set({ status: e.target.value })} className="mt-1 block rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
                {PROJECT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
          </div>
          <label className="block text-xs text-gray-500">Rating notes
            <textarea aria-label="Rating notes" rows={2} value={edit.review_notes} onChange={(e) => set({ review_notes: e.target.value })} placeholder="How did the work go?" className={`${inp} mt-1`} />
          </label>
          <label className="block text-xs text-gray-500">Description
            <textarea aria-label="Project description" rows={2} value={edit.description} onChange={(e) => set({ description: e.target.value })} className={`${inp} mt-1`} />
          </label>
        </div>
        <div className="space-y-3">
          <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{vendorName}’s quote</h5>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-gray-500">Quoted ($)<input aria-label="Quoted" type="number" value={edit.quoted} onChange={(e) => set({ quoted: e.target.value })} className={`${inp} mt-1`} /></label>
            <label className="text-xs text-gray-500">Final ($)<input aria-label="Final" type="number" value={edit.final} onChange={(e) => set({ final: e.target.value })} className={`${inp} mt-1`} /></label>
            <label className="text-xs text-gray-500">Quote status
              <select aria-label="Quote status" value={edit.quote_status} onChange={(e) => set({ quote_status: e.target.value })} className={`${inp} mt-1`}>
                {PROJECT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={edit.selected} onChange={(e) => set({ selected: e.target.checked })} /> {vendorName} did the work (chosen quote)
            </label>
          </div>
          <label className="block text-xs text-gray-500">Quote notes
            <textarea aria-label="Quote notes" rows={2} value={edit.notes} onChange={(e) => set({ notes: e.target.value })} className={`${inp} mt-1`} />
          </label>
          {others.length > 0 && (
            <div className="text-xs text-gray-500">
              <span className="font-medium">Other quotes:</span>{' '}
              {others.map((o) => `${o.vendor_name} ${fmt$(o.quoted_cost)}${o.is_selected ? ' (chosen)' : ''}`).join(' · ')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Inline "create new project + assign this vendor" form (shared) ────────────────
interface PropertyOption { id: number; address: string }
const PROJECT_STATUSES = [
  { value: 'received', label: 'Received' },
  { value: 'open', label: 'Open' },
  { value: 'completed', label: 'Completed' },
];

function CreateProjectInline({ vendorId, onCreated, onCancel }: { vendorId: number; onCreated: () => void; onCancel: () => void }) {
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [projectName, setProjectName] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [status, setStatus] = useState('received');
  const [quotedCost, setQuotedCost] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/v2/properties');
        if (res.ok) {
          const data = await res.json();
          const list: PropertyOption[] = Array.isArray(data) ? data : [];
          setProperties(list);
          if (list.length === 1) setPropertyId(String(list[0].id));
        }
      } catch (e) { console.error('Failed to load properties:', e); }
    })();
  }, []);

  const create = async () => {
    if (!projectName.trim() || !propertyId) { setError('Project name and property are required.'); return; }
    setSaving(true); setError('');
    try {
      const woRes = await fetch('/api/v2/work-orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: Number(propertyId), project_name: projectName.trim(), status }),
      });
      if (!woRes.ok) { setError('Failed to create project.'); return; }
      const wo = await woRes.json();
      await fetch('/api/v2/project-quotes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_order_id: wo.id, vendor_id: vendorId, quoted_cost: quotedCost ? parseFloat(quotedCost) : null }),
      });
      onCreated();
    } finally { setSaving(false); }
  };

  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-3">
      <p className="mb-2 text-xs font-semibold text-green-800">Create New Project</p>
      <label className="mb-1 block text-xs text-gray-500">Project Name</label>
      <input value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="e.g. Roof replacement"
        className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
      <label className="mb-1 block text-xs text-gray-500">Property</label>
      <select value={propertyId} onChange={e => setPropertyId(e.target.value)}
        className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
        <option value="">Select a property…</option>
        {properties.map(p => <option key={p.id} value={p.id}>{p.address}</option>)}
      </select>
      <label className="mb-1 block text-xs text-gray-500">Status</label>
      <select value={status} onChange={e => setStatus(e.target.value)}
        className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
        {PROJECT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
      <label className="mb-1 block text-xs text-gray-500">Quoted Cost ($)</label>
      <input type="number" value={quotedCost} onChange={e => setQuotedCost(e.target.value)}
        className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button onClick={create} disabled={saving || !projectName.trim() || !propertyId}
          className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50">
          {saving ? 'Creating…' : 'Create & Assign'}
        </button>
        <button onClick={onCancel}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50">Cancel</button>
      </div>
    </div>
  );
}
