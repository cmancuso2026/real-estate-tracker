'use client';

import Link from 'next/link';
import { Suspense, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PropertyDocsUpload } from '@/components/PropertyDocsUpload';
import { financeApi } from '@/components/finance/api';
import { Card, btnPrimary, selectCls } from '@/components/finance/ui';
import { QUEUE_EVENT } from '@/components/NavLinks';

interface UploadResult {
  new_rows: number;
  skipped: number;
  total_rows: number;
  files_parsed: number;
  recategorized: number;
  needs_property: number;
  rent: { matched: number; already_recorded: number; needs_unit: number };
  by_source: { source: string; new_rows: number; skipped: number }[];
  errors: { filename: string; error: string }[];
}

/** Values the API accepts for "source" (src/finance/parsers/index.js SOURCES). */
const SOURCES: [string, string][] = [
  ['', 'Detect from the file'],
  ['bankofamerica', 'Bank of America'],
  ['amex_gold', 'Amex Gold'],
  ['amex_blue', 'Amex Blue'],
  ['sofi', 'SoFi'],
  ['capitalone', 'Capital One'],
];

function Stat({ n, label, href, testId, tone = 'text-gray-900' }: { n: number; label: string; href?: string; testId: string; tone?: string }) {
  const body = (
    <>
      <div className={`text-2xl font-bold tabular ${tone}`}>{n.toLocaleString()}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </>
  );
  return href && n > 0 ? (
    <Link href={href} data-testid={testId} className="rounded-lg border border-gray-200 bg-white px-3 py-2 hover:border-blue-300 hover:bg-blue-50">
      {body}
      <div className="mt-0.5 text-xs font-medium text-blue-600">Open →</div>
    </Link>
  ) : (
    <div data-testid={testId} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      {body}
    </div>
  );
}

/** Bank statements → transactions (and rent), as before. */
function StatementsUpload() {
  const input = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  // Files picked or dropped so far (several at once; the list can be trimmed before uploading).
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const [skipped, setSkipped] = useState<string[]>([]);

  function addFiles(list: FileList | File[] | null | undefined) {
    if (!list) return;
    const ok: File[] = [];
    const notOk: string[] = [];
    for (const f of Array.from(list)) {
      if (/\.(csv|xlsx|xls)$/i.test(f.name)) ok.push(f);
      else notOk.push(f.name);
    }
    setSkipped(notOk);
    setResult(null);
    setError(null);
    setFiles((cur) => {
      const seen = new Set(cur.map((f) => `${f.name}|${f.size}`));
      return [...cur, ...ok.filter((f) => !seen.has(`${f.name}|${f.size}`))].slice(0, 20);
    });
  }

  async function upload() {
    setError(null);
    setResult(null);
    if (!files.length) {
      setError('Drop or choose at least one file first.');
      return;
    }
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    if (source) fd.append('source', source);
    setBusy(true);
    try {
      const data = await financeApi.post<UploadResult>('/api/finance/upload', fd);
      setResult(data);
      setFiles([]);
      setSkipped([]);
      if (input.current) input.current.value = '';
      // refresh the Needs Property badge in the header
      const c = await financeApi.get<{ count: number }>('/api/finance/attribution/count').catch(() => null);
      if (c) window.dispatchEvent(new CustomEvent(QUEUE_EVENT, { detail: c.count }));
    } catch (err) {
      setError('Upload failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Bank statements</h2>
          <p className="mt-1 text-sm text-gray-500">
            CSV or Excel exports, up to 20 files at once. One upload feeds both your finances and rent: rent payments are
            recorded on the right unit automatically. Re-uploading overlapping statements never creates duplicates.
          </p>
        </div>

        <div
          data-testid="statement-drop"
          role="button"
          tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            addFiles(e.dataTransfer.files);
          }}
          className={`flex h-32 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-sm transition-colors ${
            drag ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 bg-gray-50 text-gray-600 hover:border-gray-400'
          }`}
        >
          <svg aria-hidden viewBox="0 0 24 24" className="mb-2 h-7 w-7 fill-current opacity-70">
            <path d="M19 15v4H5v-4H3v4a2 2 0 002 2h14a2 2 0 002-2v-4h-2zM12 3l-5 5h3v6h4V8h3l-5-5z" />
          </svg>
          Drop statement files here (several at once), or click to choose
          <span className="mt-0.5 text-xs text-gray-400">CSV or Excel · up to 20 files</span>
          <input
            ref={input}
            type="file"
            aria-label="Statement files"
            accept=".csv,.xlsx,.xls"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        {skipped.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="statement-skipped">
            Not added: {skipped.join(', ')}. Bank statements need to be CSV or Excel exports (PDF statements can&apos;t be read
            yet). For a lease, insurance or escrow PDF, use{' '}
            <a href="/upload?kind=documents" className="font-medium underline">
              Property documents
            </a>
            .
          </div>
        )}

        {files.length > 0 && (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 text-sm" data-testid="statement-files">
            {files.map((f, i) => (
              <li key={`${f.name}|${f.size}`} className="flex items-center justify-between px-3 py-1.5">
                <span className="truncate">{f.name}</span>
                <span className="flex items-center gap-3 text-xs text-gray-400">
                  {(f.size / 1024).toFixed(0)} KB
                  <button type="button" className="text-gray-400 hover:text-red-600" aria-label={`Remove ${f.name}`} onClick={() => setFiles((cur) => cur.filter((_, k) => k !== i))}>
                    ✕
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
            Source
            <select aria-label="Source" className={selectCls} value={source} onChange={(e) => setSource(e.target.value)}>
              {SOURCES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <button className={btnPrimary} disabled={busy || files.length === 0} onClick={() => void upload()}>
            {busy ? 'Uploading…' : files.length ? `Upload ${files.length} file${files.length === 1 ? '' : 's'}` : 'Upload'}
          </button>
        </div>
        <p className="text-xs text-gray-400">
          &ldquo;Detect from the file&rdquo; recognizes each bank from its columns. Amex Gold and Amex Blue files look the
          same, so pick the card when uploading Amex Blue (detected Amex files are labeled Amex Gold).
        </p>

        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </Card>

      {result && (
        <Card className="space-y-3" data-testid="upload-result">
          <h2 className="text-base font-semibold">Upload finished</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat n={result.new_rows} label="new transactions" href="/finance/transactions" testId="upload-new" tone="text-green-700" />
            <Stat n={result.skipped} label="duplicates skipped" testId="upload-skipped" />
            <Stat n={result.needs_property} label="now need a property" href="/finance/attribution" testId="upload-needs-property" tone="text-orange-600" />
            <Stat n={result.rent.matched} label="rent payments matched" href="/properties" testId="upload-rent-matched" tone="text-green-700" />
            <Stat n={result.rent.needs_unit} label="rent payments need a unit" href="/finance/attribution#rent" testId="upload-rent-needs-unit" tone="text-orange-600" />
          </div>
          <div className="text-xs text-gray-500">
            {result.total_rows} rows read from {result.files_parsed} file(s)
            {result.by_source.length > 0 && ': '}
            {result.by_source.map((s, i) => (
              <span key={s.source}>
                {i > 0 && ' · '}
                {s.source} {s.new_rows} new, {s.skipped} duplicate
              </span>
            ))}
            {result.rent.already_recorded > 0 && ` · ${result.rent.already_recorded} rent payment(s) were already recorded by hand`}
            {result.recategorized > 0 && ` · ${result.recategorized} older uncategorized transaction(s) categorized from history`}
          </div>
          {result.errors.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {result.errors.length} file(s) skipped:
              {result.errors.map((e) => (
                <div key={e.filename}>
                  {e.filename}: {e.error}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

type Kind = 'statements' | 'documents';
const TILES: { kind: Kind; title: string; body: string; icon: string }[] = [
  {
    kind: 'statements',
    title: 'Bank statements',
    body: 'Expenses and income: CSV or Excel exports from Bank of America, Amex, SoFi or Capital One. Rent payments in them are recorded automatically.',
    icon: 'M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h12v2H3v-2z',
  },
  {
    kind: 'documents',
    title: 'Property documents',
    body: 'PDFs for a property: lease, insurance policy, escrow statement or mortgage statement. Read automatically, reviewed before saving.',
    icon: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm0 2.5L17.5 8H14V4.5z',
  },
];

/** Upload: choose what you're adding, then the matching uploader (?kind= keeps it on refresh / back). */
function UploadChooser() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const kind = (['statements', 'documents'] as const).find((k) => k === params.get('kind')) ?? null;
  const pick = (k: Kind | null) => router.push(k ? `${pathname}?kind=${k}` : pathname);

  if (!kind) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-lg font-semibold">What are you uploading?</h1>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {TILES.map((t) => (
            <button
              key={t.kind}
              type="button"
              data-testid={`upload-tile-${t.kind}`}
              onClick={() => pick(t.kind)}
              className="group flex flex-col items-start gap-3 rounded-xl border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:border-gray-900 hover:shadow"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-700 group-hover:bg-gray-900 group-hover:text-white">
                <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                  <path d={t.icon} />
                </svg>
              </span>
              <span className="text-base font-semibold text-gray-900">{t.title}</span>
              <span className="text-sm text-gray-500">{t.body}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <button type="button" onClick={() => pick(null)} className="text-sm font-medium text-gray-500 hover:text-gray-900" data-testid="upload-back">
        ← Upload something else
      </button>
      {kind === 'statements' ? (
        <StatementsUpload />
      ) : (
        <Card className="space-y-4">
          <h2 className="text-lg font-semibold">Property documents</h2>
          <PropertyDocsUpload />
        </Card>
      )}
    </div>
  );
}

export default function UploadPage() {
  return (
    <Suspense fallback={null}>
      <UploadChooser />
    </Suspense>
  );
}
