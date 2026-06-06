import Link from 'next/link';
import { GRADE_ORDER, GRADE_HEX, fmtMoney, fmtPct, fmtSignedMoney } from '@/lib/format';
import type { Summary } from '@/lib/queries';
import { GradeBadge } from './GradeBadge';

function Card({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 ${className}`}
    >
      {children}
    </div>
  );
}

/** Top-of-page summary: totals, grade distribution, avg CoC, best deal, rate. */
export function SummaryCards({ summary }: { summary: Summary }) {
  const { gradeCounts, best } = summary;
  const maxCount = Math.max(1, ...GRADE_ORDER.map((g) => gradeCounts[g]));

  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {/* Totals */}
      <Card>
        <div className="text-sm text-gray-500 dark:text-gray-400">Properties tracked</div>
        <div className="mt-1 text-3xl font-bold tabular">{summary.totalProperties}</div>
        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {summary.totalGraded} graded
        </div>
      </Card>

      {/* Grade distribution */}
      <Card>
        <div className="text-sm text-gray-500 dark:text-gray-400">Grade distribution</div>
        <div className="mt-2 space-y-1.5">
          {GRADE_ORDER.map((g) => (
            <div key={g} className="flex items-center gap-2">
              <span className="w-3 text-xs font-semibold" style={{ color: GRADE_HEX[g] }}>
                {g}
              </span>
              <div className="h-2.5 flex-1 overflow-hidden rounded bg-gray-100 dark:bg-gray-800">
                <div
                  className="h-full rounded"
                  style={{
                    width: `${(gradeCounts[g] / maxCount) * 100}%`,
                    backgroundColor: GRADE_HEX[g],
                  }}
                />
              </div>
              <span className="w-6 text-right text-xs tabular text-gray-600 dark:text-gray-300">
                {gradeCounts[g]}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* Avg CoC + rate */}
      <Card>
        <div className="text-sm text-gray-500 dark:text-gray-400">Average CoC return</div>
        <div className="mt-1 text-3xl font-bold tabular">{fmtPct(summary.avgCoc)}</div>
        <div className="mt-3 border-t border-gray-100 pt-2 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
          Interest rate in use:{' '}
          <span className="font-semibold text-gray-700 dark:text-gray-200">
            {summary.rate ? fmtPct(summary.rate.effectiveRate, 2) : '—'}
          </span>
          {summary.rate && (
            <>
              {' '}
              <span className="text-gray-400">
                ({fmtPct(summary.rate.baseRate, 2)} base + {fmtPct(summary.rate.premium, 2)}
                {summary.rate.weekDate ? ` · ${summary.rate.weekDate}` : ''})
              </span>
            </>
          )}
        </div>
      </Card>

      {/* Best opportunity */}
      <Card className="ring-1 ring-green-500/20">
        <div className="text-sm text-gray-500 dark:text-gray-400">Best opportunity</div>
        {best ? (
          <Link href={`/property/${best.listing_id}`} className="group mt-1 block">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-semibold group-hover:underline">
                  {best.address ?? `Listing ${best.listing_id}`}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {[best.city, best.state, best.zip_code].filter(Boolean).join(', ')}
                </div>
              </div>
              <GradeBadge grade={best.overall_grade} size="md" />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular text-gray-600 dark:text-gray-300">
              <span>{fmtMoney(best.price)}</span>
              <span>CoC {fmtPct(best.coc_return)}</span>
              <span>{fmtSignedMoney(best.monthly_cashflow)}/mo</span>
            </div>
          </Link>
        ) : (
          <div className="mt-2 text-sm text-gray-400">No graded properties yet.</div>
        )}
      </Card>
    </section>
  );
}
