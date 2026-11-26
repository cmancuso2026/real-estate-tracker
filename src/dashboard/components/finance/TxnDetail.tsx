'use client';

import { useState } from 'react';
import { fmt } from '@/lib/finance-ui/format';
import { similarTxns, type Discrepancies, type Reason } from '@/lib/finance-ui/review';
import type { Txn } from '@/lib/finance-ui/types';
import { btnPrimary } from './ui';
import { TxnProjectAssign } from './TxnProjectAssign';

function ReasonText({ r }: { r: Reason }) {
  if (r.type === 'inconsistent') {
    return (
      <>
        Similar-named transactions are split across categories: <strong>{r.cats.join(', ')}</strong>.
      </>
    );
  }
  return (
    <>
      Name {r.label}, but it&apos;s filed under <strong>{r.actual}</strong> (expected {r.expected}).
    </>
  );
}

const K = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{children}</div>
);

/** The expanded panel under a transaction row (old txnDetailHTML). */
export function TxnDetail({
  t,
  group,
  disc,
  onSaveNote,
  onReview,
}: {
  t: Txn;
  group: string;
  disc: Discrepancies;
  onSaveNote: (note: string) => Promise<void>;
  onReview: (cleared: boolean) => Promise<void>;
}) {
  const [note, setNote] = useState(t.note);
  const [saving, setSaving] = useState(false);
  const reasons = disc.flags.get(t.id) || [];
  const inc = reasons.find((r): r is Extract<Reason, { type: 'inconsistent' }> => r.type === 'inconsistent');
  const related = inc ? similarTxns(disc, t, inc.key) : [];
  const fullDate = new Date(t.date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50/60 p-4" onClick={(e) => e.stopPropagation()}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="col-span-2 md:col-span-3">
          <K>Full description</K>
          <div className="break-all">{t.desc}</div>
        </div>
        <div>
          <K>Date</K>
          <div>{fullDate}</div>
        </div>
        <div>
          <K>Amount</K>
          <div className={`tabular font-semibold ${t.amt < 0 ? 'text-red-600' : 'text-green-700'}`}>{fmt(t.amt)}</div>
        </div>
        <div>
          <K>Source</K>
          <div>{t.src}</div>
        </div>
        <div>
          <K>Category</K>
          <div>
            {t.cat} <span className="text-gray-400">· {group}</span>
          </div>
        </div>
        <div>
          <K>Categorized</K>
          <div>{t.manual ? 'Manually (edited)' : 'Auto'}</div>
        </div>
      </div>

      <TxnProjectAssign t={t} />

      <div>
        <K>
          📝 Note <span className="normal-case tracking-normal text-gray-400">— shown on hover in the overview chart &amp; spending table</span>
        </K>
        <div className="mt-1 flex items-start gap-2">
          <textarea
            aria-label="Note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note (e.g. taxes to Wiley)…"
            className="flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
          />
          <button
            className={btnPrimary}
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSaveNote(note.trim());
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {reasons.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <K>⚠ Possible issues</K>
            <button
              className="rounded-full border border-green-300 bg-white px-3 py-1 text-xs font-medium text-green-700 hover:bg-green-50"
              onClick={() => void onReview(true)}
            >
              ✓ Looks fine — clear
            </button>
          </div>
          {reasons.map((r, i) => (
            <div key={i} className="mt-1 text-sm text-amber-900">
              <ReasonText r={r} />
            </div>
          ))}
          {related.length > 0 && (
            <div className="mt-3">
              <K>Similar transactions</K>
              <div className="mt-1 divide-y divide-amber-100 text-xs">
                {related.map((x) => (
                  <div
                    key={x.id}
                    className={`grid grid-cols-[5rem_1fr_9rem_7rem] gap-2 py-1 ${x.cat !== t.cat ? 'font-semibold text-amber-900' : 'text-gray-600'}`}
                  >
                    <span>
                      {new Date(x.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                    </span>
                    <span className="truncate">{x.desc}</span>
                    <span>{x.cat}</span>
                    <span>{x.src}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        t.cleared && (
          <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-green-700">✓ Cleared from review</span>
            <button
              className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
              onClick={() => void onReview(false)}
            >
              Restore to review
            </button>
          </div>
        )
      )}
    </div>
  );
}
