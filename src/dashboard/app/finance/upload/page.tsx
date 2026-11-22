'use client';

import { useRef, useState } from 'react';
import { financeApi } from '@/components/finance/api';
import { useFinance } from '@/components/finance/FinanceData';
import { Card, btnPrimary } from '@/components/finance/ui';

interface UploadResult {
  new_rows: number;
  skipped: number;
  total_rows: number;
  files_parsed: number;
  recategorized: number;
  by_source: { source: string; new_rows: number; skipped: number }[];
  errors: { filename: string; error: string }[];
}

export default function FinanceUploadPage() {
  const { reload } = useFinance();
  const input = useRef<HTMLInputElement>(null);
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
    setBusy(true);
    try {
      const data = await financeApi.post<UploadResult>('/api/finance/upload', fd);
      setResult(data);
      if (input.current) input.current.value = '';
      await reload(); // new rows, years and months show up everywhere
    } catch (err) {
      setError('Upload failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Upload transactions</h1>
        <p className="mt-1 text-sm text-gray-500">
          CSV or Excel exports, up to 20 files at once. The bank (Bank of America, Amex, SoFi, Capital One) is detected
          automatically from each file. Re-uploading overlapping statements never creates duplicates.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={input}
          type="file"
          aria-label="Statement files"
          accept=".csv,.xlsx,.xls"
          multiple
          className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-gray-200"
        />
        <button className={btnPrimary} disabled={busy} onClick={() => void upload()}>
          {busy ? 'Uploading…' : 'Upload'}
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {result && (
        <div data-testid="upload-result" className="space-y-1.5 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          <div>
            ✅ <strong>{result.new_rows}</strong> new transaction(s) added, <strong>{result.skipped}</strong> duplicate(s)
            skipped (of {result.total_rows} parsed across {result.files_parsed} file(s)).
          </div>
          {result.by_source.length > 0 && (
            <div className="text-xs opacity-85">
              {result.by_source.map((s, i) => (
                <span key={s.source}>
                  {i > 0 && ' · '}
                  {s.source}: <strong>{s.new_rows}</strong> new, {s.skipped} dup
                </span>
              ))}
            </div>
          )}
          {result.recategorized > 0 && (
            <div className="text-xs opacity-85">
              🔎 {result.recategorized} previously-uncategorized transaction(s) auto-categorized from history.
            </div>
          )}
          {result.errors.length > 0 && (
            <div className="text-xs text-red-700">
              ⚠️ {result.errors.length} file(s) skipped:
              {result.errors.map((e) => (
                <div key={e.filename}>
                  {e.filename}: {e.error}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
