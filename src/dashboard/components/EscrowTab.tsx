'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface EscrowStatement {
  id: number;
  statement_date: string;
  analysis_period_start: string;
  analysis_period_end: string;
  total_property_taxes: number | null;
  total_insurance: number | null;
  shortage_surplus_amount: number | null;
  new_monthly_escrow: number | null;
}

interface PITIRecord {
  id: number;
  statement_date: string;
  statement_year_month: string;
  principal: number;
  interest: number;
  property_taxes: number;
  escrow_insurance: number;
  total_payment: number;
}

interface PITIExtracted {
  statement_date: string | null;
  principal: number | null;
  interest: number | null;
  property_taxes: number | null;
  escrow_insurance: number | null;
  confidence_notes: string | null;
}

function fmt$(n: number | null | undefined) {
  if (n == null) return '—';
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function EscrowTab({ id }: { id: string }) {
  const [escrowStatements, setEscrowStatements] = useState<EscrowStatement[]>([]);
  const [pitiHistory, setPitiHistory] = useState<PITIRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // PITI upload state
  const [pitiFile, setPitiFile] = useState<File | null>(null);
  const [pitiParsing, setPitiParsing] = useState(false);
  const [pitiExtracted, setPitiExtracted] = useState<PITIExtracted | null>(null);
  const [pitiSaving, setPitiSaving] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        // Fetch escrow statements
        const escRes = await fetch(`/api/v2/escrow?propertyId=${id}`);
        if (escRes.ok) {
          setEscrowStatements(await escRes.json());
        }

        // Fetch PITI history
        const pitiRes = await fetch(`/api/v2/piti?propertyId=${id}`);
        if (pitiRes.ok) {
          setPitiHistory(await pitiRes.json());
        }
      } catch (err) {
        console.error('Failed to load escrow/PITI data:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [id]);

  // Handle PITI file upload and parsing
  async function handlePitiUpload() {
    if (!pitiFile) return;

    setPitiParsing(true);
    try {
      const formData = new FormData();
      formData.append('file', pitiFile);
      formData.append('property_id', id);

      const res = await fetch('/api/v2/piti', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        setPitiExtracted(data.extracted);
        setPitiFile(null);
      } else {
        alert('Failed to parse mortgage statement. Please try again.');
      }
    } catch (err) {
      console.error('PITI upload error:', err);
      alert('Error uploading file');
    } finally {
      setPitiParsing(false);
    }
  }

  // Handle PITI save after review
  async function handlePitiSave() {
    if (!pitiExtracted || !pitiExtracted.statement_date) return;

    setPitiSaving(true);
    try {
      const res = await fetch('/api/v2/piti/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: id,
          statement_date: pitiExtracted.statement_date,
          principal: pitiExtracted.principal,
          interest: pitiExtracted.interest,
          property_taxes: pitiExtracted.property_taxes,
          escrow_insurance: pitiExtracted.escrow_insurance,
          ai_confidence_notes: pitiExtracted.confidence_notes,
        }),
      });

      if (res.ok) {
        alert('PITI record saved successfully');
        setPitiExtracted(null);
        // Reload PITI history
        const pitiRes = await fetch(`/api/v2/piti?propertyId=${id}`);
        if (pitiRes.ok) {
          setPitiHistory(await pitiRes.json());
        }
      } else {
        alert('Failed to save PITI record');
      }
    } catch (err) {
      console.error('PITI save error:', err);
      alert('Error saving PITI record');
    } finally {
      setPitiSaving(false);
    }
  }

  if (loading) {
    return <div className="py-8 text-center text-gray-400">Loading escrow and PITI data...</div>;
  }

  return (
    <div className="space-y-8">
      {/* Section A: Escrow History */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Escrow History</h3>
          <Link 
            href={`/properties/${id}?tab=escrow&action=upload`}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            + Add Statement
          </Link>
        </div>

        {escrowStatements.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-8 text-center dark:border-gray-800 dark:bg-gray-900">
            <p className="text-sm text-gray-500 dark:text-gray-400">No escrow statements on file</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Statement Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Period</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Property Taxes</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Insurance</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Shortage/Surplus</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">New Monthly Escrow</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {escrowStatements.map(stmt => (
                  <tr key={stmt.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/50">
                    <td className="px-4 py-3 font-medium">
                      {new Date(stmt.statement_date).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {new Date(stmt.analysis_period_start).toLocaleDateString()} – {new Date(stmt.analysis_period_end).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular">{fmt$(stmt.total_property_taxes)}</td>
                    <td className="px-4 py-3 text-right tabular">{fmt$(stmt.total_insurance)}</td>
                    <td className={`px-4 py-3 text-right tabular font-medium ${(stmt.shortage_surplus_amount ?? 0) < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                      {fmt$(stmt.shortage_surplus_amount)}
                    </td>
                    <td className="px-4 py-3 text-right tabular">{fmt$(stmt.new_monthly_escrow)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Section B: PITI Breakdown */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Mortgage PITI Breakdown</h3>
        </div>

        {/* PITI Upload Form */}
        {!pitiExtracted ? (
          <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50 p-6 dark:border-gray-800 dark:bg-gray-900">
            <h4 className="mb-4 font-medium text-gray-700 dark:text-gray-300">Upload Mortgage Statement</h4>
            <div className="flex gap-3">
              <input
                type="file"
                accept=".pdf"
                onChange={e => setPitiFile(e.target.files?.[0] || null)}
                disabled={pitiParsing}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
                placeholder="Select PDF..."
              />
              <button
                onClick={handlePitiUpload}
                disabled={!pitiFile || pitiParsing}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {pitiParsing ? 'Parsing...' : 'Parse'}
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Upload a PDF mortgage statement. Claude will extract Principal, Interest, Taxes, and Insurance.
            </p>
          </div>
        ) : null}

        {/* PITI Review Form */}
        {pitiExtracted ? (
          <div className="mb-6 space-y-4 rounded-xl border border-amber-200 bg-amber-50 p-6 dark:border-amber-900/30 dark:bg-amber-900/20">
            <h4 className="font-medium text-amber-900 dark:text-amber-200">Review Extracted Data</h4>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Statement Date</label>
                <input
                  type="date"
                  value={pitiExtracted.statement_date || ''}
                  onChange={e => setPitiExtracted({ ...pitiExtracted, statement_date: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Principal</label>
                <input
                  type="number"
                  step="0.01"
                  value={pitiExtracted.principal || ''}
                  onChange={e => setPitiExtracted({ ...pitiExtracted, principal: e.target.value ? parseFloat(e.target.value) : null })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Interest</label>
                <input
                  type="number"
                  step="0.01"
                  value={pitiExtracted.interest || ''}
                  onChange={e => setPitiExtracted({ ...pitiExtracted, interest: e.target.value ? parseFloat(e.target.value) : null })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Property Taxes</label>
                <input
                  type="number"
                  step="0.01"
                  value={pitiExtracted.property_taxes || ''}
                  onChange={e => setPitiExtracted({ ...pitiExtracted, property_taxes: e.target.value ? parseFloat(e.target.value) : null })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Escrow Insurance</label>
                <input
                  type="number"
                  step="0.01"
                  value={pitiExtracted.escrow_insurance || ''}
                  onChange={e => setPitiExtracted({ ...pitiExtracted, escrow_insurance: e.target.value ? parseFloat(e.target.value) : null })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Confidence Notes</label>
                <input
                  type="text"
                  value={pitiExtracted.confidence_notes || ''}
                  onChange={e => setPitiExtracted({ ...pitiExtracted, confidence_notes: e.target.value || null })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800"
                  placeholder="Any ambiguities?"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={handlePitiSave}
                disabled={pitiSaving || !pitiExtracted.statement_date || !pitiExtracted.principal}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {pitiSaving ? 'Saving...' : '✓ Save PITI'}
              </button>
              <button
                onClick={() => setPitiExtracted(null)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {/* PITI History Table */}
        {pitiHistory.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-8 text-center dark:border-gray-800 dark:bg-gray-900">
            <p className="text-sm text-gray-500 dark:text-gray-400">No mortgage statements uploaded yet</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Month</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Principal</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Interest</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Taxes</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Insurance</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Total Payment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {pitiHistory.map(record => (
                  <tr key={record.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/50">
                    <td className="px-4 py-3 font-medium">{record.statement_year_month}</td>
                    <td className="px-4 py-3 text-right tabular">{fmt$(record.principal)}</td>
                    <td className="px-4 py-3 text-right tabular">{fmt$(record.interest)}</td>
                    <td className="px-4 py-3 text-right tabular">{fmt$(record.property_taxes)}</td>
                    <td className="px-4 py-3 text-right tabular">{fmt$(record.escrow_insurance)}</td>
                    <td className="px-4 py-3 text-right tabular font-bold">{fmt$(record.total_payment)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Summary Statistics */}
        {pitiHistory.length > 0 && (
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
              <p className="text-xs text-gray-500 dark:text-gray-400">Average Monthly PITI</p>
              <p className="mt-1 text-lg font-bold">
                {fmt$(pitiHistory.reduce((sum, r) => sum + r.total_payment, 0) / pitiHistory.length)}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
              <p className="text-xs text-gray-500 dark:text-gray-400">Latest Month</p>
              <p className="mt-1 text-lg font-bold">{pitiHistory[0]?.statement_year_month}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
              <p className="text-xs text-gray-500 dark:text-gray-400">Records</p>
              <p className="mt-1 text-lg font-bold">{pitiHistory.length}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
