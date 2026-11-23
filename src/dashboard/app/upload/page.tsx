'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
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

export default function UploadPage() {
  const input = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  async function upload() {
    setError(null);
    setResult(null);
    const files = input.current?.files;
    if (!files || !files.length) {
      setError('Please choose at least one file first.');
      return;
    }
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    if (source) fd.append('source', source);
    setBusy(true);
    try {
      const data = await financeApi.post<UploadResult>('/api/finance/upload', fd);
      setResult(data);
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
    <div className="mx-auto max-w-3xl space-y-4">
      <Card className="space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Upload statements</h1>
          <p className="mt-1 text-sm text-gray-500">
            CSV or Excel exports, up to 20 files at once. One upload feeds both your finances and rent: rent payments are
            recorded on the right unit automatically. Re-uploading overlapping statements never creates duplicates.
          </p>
        </div>

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
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
            Files (.csv, .xlsx)
            <input
              ref={input}
              type="file"
              aria-label="Statement files"
              accept=".csv,.xlsx,.xls"
              multiple
              className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-gray-200"
            />
          </label>
          <button className={btnPrimary} disabled={busy} onClick={() => void upload()}>
            {busy ? 'Uploading…' : 'Upload'}
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
