'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { DOC_TYPES, setPendingDoc, type PropertyDocType } from '@/lib/pendingDoc';

interface Property {
  id: number;
  address: string;
}

/**
 * Upload → Property documents: pick the property and what the PDF is, drop it
 * in, and you land on that property's tab where it is read (Claude) and shown
 * for review before anything is saved — the same screens as on the property.
 */
export function PropertyDocsUpload() {
  const router = useRouter();
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const [type, setType] = useState<PropertyDocType | ''>('');
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/v2/properties')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Property[]) => {
        const list = Array.isArray(rows) ? rows : [];
        setProperties(list);
        if (list.length === 1) setPropertyId(String(list[0]!.id));
      })
      .catch(() => setProperties([]));
  }, []);

  const ready = !!propertyId && !!type;

  function take(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      setError('Please drop a PDF.');
      return;
    }
    if (!ready) {
      setError('Pick the property and what the document is first.');
      return;
    }
    const doc = DOC_TYPES.find((d) => d.type === type)!;
    setPendingDoc({ propertyId: Number(propertyId), type: type as PropertyDocType, file });
    router.push(`/properties/${propertyId}?tab=${doc.tab}`);
  }

  return (
    <div className="space-y-5" data-testid="property-docs">
      <div>
        <div className="mb-1.5 text-sm font-medium text-gray-700">1. Property</div>
        <select
          aria-label="Property"
          className="w-full max-w-md rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
        >
          <option value="">Choose a property…</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.address}
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="mb-1.5 text-sm font-medium text-gray-700">2. What is it?</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Document type">
          {DOC_TYPES.map((d) => (
            <button
              key={d.type}
              type="button"
              role="radio"
              aria-checked={type === d.type}
              onClick={() => setType(d.type)}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                type === d.type ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white hover:border-gray-400'
              }`}
            >
              <div className="text-sm font-medium">{d.label}</div>
              <div className={`text-xs ${type === d.type ? 'text-gray-300' : 'text-gray-500'}`}>{d.hint}</div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-sm font-medium text-gray-700">3. Drop the PDF</div>
        <div
          data-testid="doc-drop"
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
            take(e.dataTransfer.files?.[0]);
          }}
          className={`flex h-36 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-sm transition-colors ${
            drag ? 'border-blue-500 bg-blue-50 text-blue-700' : ready ? 'border-gray-300 bg-gray-50 text-gray-600 hover:border-gray-400' : 'border-gray-200 bg-gray-50 text-gray-400'
          }`}
        >
          <svg aria-hidden viewBox="0 0 24 24" className="mb-2 h-7 w-7 fill-current opacity-70">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm0 2.5L17.5 8H14V4.5zM8 13h8v2H8v-2zm0 4h5v2H8v-2z" />
          </svg>
          {ready ? 'Drop a PDF here, or click to choose one' : 'Pick the property and the document type, then drop the PDF'}
          <input
            ref={input}
            type="file"
            accept=".pdf,application/pdf"
            aria-label="Document PDF"
            className="hidden"
            onChange={(e) => {
              take(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
        <p className="mt-2 text-xs text-gray-500">
          The PDF is read automatically and you review what was found on the property&apos;s page before anything is saved.
          Vendor quotes are added from a property&apos;s Projects tab or the Vendors page.
        </p>
        {error && (
          <div role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
