'use client';

import { useEffect, useRef, useState } from 'react';
import { TradePicker } from './TradePicker';
import { useTrades } from '@/lib/useTrades';

// Quotes from PDFs / emails: drop one or several at once. Each is read by the
// AI parser and gets its own card to check; saving creates each vendor (or
// uses the existing one with the same name) and adds the quotes to a project
// — the one you pick, the project you're in, or (new project) hands them back.

interface VendorQuoteExtracted {
  vendor_name: string | null; vendor_phone: string | null; vendor_email: string | null;
  trade: string | null; project_name: string | null; quoted_cost: number | null;
  scope_of_work: string | null; quote_date: string | null; confidence_notes: string | null;
}
interface WorkOrderOption { id: number; project_name: string | null; description: string | null; property_address: string | null }
/** A quote ready to add to a project: its vendor already exists. */
export interface CollectedQuote { vendor_id: number; vendor_name: string; quoted_cost: number | null; notes: string | null }

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

export function QuoteImport({ onCancel, onDone, projectId: fixedProjectId, collect, title = 'Import quotes from PDF or email' }: {
  onCancel: () => void;
  /** After saving (vendors created and, with a project, quotes added). */
  onDone?: () => void;
  /** Add the quotes to this project (the project picker is hidden). */
  projectId?: number;
  /** New project, not saved yet: vendors are saved now, quotes handed back to add once it exists. */
  collect?: (quotes: CollectedQuote[]) => void;
  title?: string;
}) {
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
  const [pickedProject, setProjectId] = useState('');
  const projectId = fixedProjectId ? String(fixedProjectId) : pickedProject;
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    vendorsLoaded.current = (async () => {
      const [v, w] = await Promise.all([
        fetch('/api/v2/vendors?activeOnly=false').then(r => (r.ok ? r.json() : [])).catch(() => []),
        fixedProjectId || collect ? Promise.resolve([]) : fetch('/api/v2/work-orders').then(r => (r.ok ? r.json() : [])).catch(() => []),
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
    const collected: CollectedQuote[] = [];
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
        if (collect) {
          collected.push({ vendor_id: vendorId!, vendor_name: i.data!.vendor_name ?? 'Vendor', quoted_cost: i.data!.quoted_cost ?? null, notes: i.data!.scope_of_work ?? null });
        } else if (projectId) {
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
    if (collect && collected.length) collect(collected);
    setSummary([made && `${made} new vendor${made === 1 ? '' : 's'}`, quoted && `${quoted} quote${quoted === 1 ? '' : 's'} added to the project`, collected.length && `${collected.length} quote${collected.length === 1 ? '' : 's'} ready for the new project`].filter(Boolean).join(', ') + (failed.length ? `. Not saved: ${failed.join('; ')}` : '') || 'Nothing to save.');
    if (!failed.length) onDone?.();
  }

  const inp = 'w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none';
  return (
    <div className="space-y-4 rounded-xl border-2 border-blue-300 bg-blue-50 p-5" data-testid="vendor-import">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-blue-800">{title}</h3>
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
          {!fixedProjectId && !collect && <label className="block text-xs text-gray-600">
            Add these quotes to a project <span className="text-gray-400">(optional — e.g. to compare bids)</span>
            <select aria-label="Project for the quotes" value={projectId} onChange={e => setProjectId(e.target.value)} className="mt-1 block w-full max-w-xl rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm">
              <option value="">Don’t add to a project — just save the vendors</option>
              {projects.map(w => <option key={w.id} value={w.id}>{w.project_name || w.description || `Project #${w.id}`}{w.property_address ? ` — ${w.property_address}` : ''}</option>)}
            </select>
          </label>}

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
