import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPropertyDetail, type ComponentBreakdown } from '@/lib/queries';
import {
  fmtMoney,
  fmtPct,
  fmtNum,
  fmtSqft,
  fmtSignedMoney,
  fmtBedsBaths,
  fmtDate,
  propertyTypeLabel,
  GRADE_HEX,
  type Letter,
} from '@/lib/format';
import { GradeBadge } from '@/components/GradeBadge';
import { GradeHistoryChart } from '@/components/GradeHistoryChart';

export const dynamic = 'force-dynamic';

export default async function PropertyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const p = getPropertyDetail(Number(id));
  if (!p) notFound();

  const a = p.assumptions;

  return (
    <div className="space-y-6">
      <Link
        href="/"
        className="inline-block text-sm text-blue-600 hover:underline dark:text-blue-400"
      >
        ← Back to all properties
      </Link>

      {/* Header */}
      <header className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{p.address ?? `Listing ${p.listing_id}`}</h1>
          <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {[p.city, p.state, p.zip_code].filter(Boolean).join(', ')}
          </div>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Stat label="List price" value={fmtMoney(p.price)} />
            <Stat label="Type" value={propertyTypeLabel(p.property_type)} />
            <Stat label="Bed / Bath" value={fmtBedsBaths(p.bedrooms, p.bathrooms)} />
            <Stat label="SqFt" value={fmtSqft(p.living_area)} />
            <Stat label="Price/SqFt" value={fmtMoney(p.price_per_sqft)} />
            {p.year_built != null && <Stat label="Year built" value={String(p.year_built)} />}
            {p.days_on_market != null && (
              <Stat label="Days on market" value={String(p.days_on_market)} />
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            {p.zillowUrl && (
              <a
                href={p.zillowUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700"
              >
                🔗 View on Zillow
              </a>
            )}
            {p.realtorUrl && (
              <a
                href={p.realtorUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-rose-600 px-3 py-1.5 font-medium text-white hover:bg-rose-700"
              >
                🔗 View on Realtor.com
              </a>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-center gap-2">
          <GradeBadge grade={p.overall_grade} size="lg" />
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Score {fmtNum(p.overall_score)} / 4
          </div>
          <div className="text-xs text-gray-400">Graded {fmtDate(p.graded_at)}</div>
        </div>
      </header>

      {/* Key returns */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric label="Cash-on-cash" value={fmtPct(p.coc_return)} accent />
        <Metric
          label="Monthly cash flow"
          value={fmtSignedMoney(p.monthly_cashflow)}
          negative={(p.monthly_cashflow ?? 0) < 0}
        />
        <Metric label="Est. monthly rent" value={fmtMoney(p.est_rent)} />
        <Metric
          label="Rate used"
          value={p.interest_rate_used != null ? fmtPct(p.interest_rate_used, 2) : '—'}
        />
      </div>

      {/* Scoring breakdown */}
      <Section title="Scoring breakdown">
        <div className="space-y-3">
          {p.components.map((c) => (
            <ComponentBar key={c.key} c={c} />
          ))}
        </div>
        {p.reasoning && (
          <p className="mt-4 border-t border-gray-100 pt-3 text-sm text-gray-600 dark:border-gray-800 dark:text-gray-300">
            {p.reasoning}
          </p>
        )}
      </Section>

      {/* CoC step by step */}
      {a && (
        <Section title="Cash-on-cash return — step by step">
          <table className="w-full text-sm">
            <tbody>
              <CalcRow label="Purchase price" value={fmtMoney(a.purchasePrice)} />
              <CalcRow
                label={`Down payment (${fmtNum(a.downPaymentPct)}%)`}
                value={fmtMoney(a.downPayment)}
              />
              <CalcRow label="Closing costs" value={fmtMoney(a.closingCosts)} />
              <CalcRow
                label="Total cash invested"
                value={fmtMoney(a.totalCashInvested)}
                strong
              />
              <CalcRow label="Loan amount" value={fmtMoney(a.loanAmount)} />
              <CalcRow
                label={`Annual cash flow (${fmtSignedMoney(p.monthly_cashflow)}/mo × 12)`}
                value={fmtSignedMoney(a.annualCashFlow)}
              />
              <CalcRow
                label="CoC = annual cash flow ÷ cash invested"
                value={fmtPct(p.coc_return)}
                strong
                accent
              />
            </tbody>
          </table>
        </Section>
      )}

      {/* Rent vs buy */}
      {a && (
        <Section title="Rent vs. carrying cost (monthly)">
          <table className="w-full text-sm">
            <tbody>
              <CalcRow label="Gross rent" value={fmtMoney(a.monthlyRent)} />
              <CalcRow
                label={`Vacancy allowance (${fmtPct(a.vacancyFactor * 100, 0)})`}
                value={`-${fmtMoney(a.monthlyRent * a.vacancyFactor)}`}
              />
              <CalcRow label="Mortgage (P&I)" value={`-${fmtMoney(a.monthlyMortgage)}`} />
              <CalcRow label="Property tax" value={`-${fmtMoney(a.annualPropertyTax / 12)}`} />
              <CalcRow label="Insurance" value={`-${fmtMoney(a.annualInsurance / 12)}`} />
              <CalcRow
                label="Net monthly cash flow"
                value={fmtSignedMoney(p.monthly_cashflow)}
                strong
                accent
              />
            </tbody>
          </table>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Rent estimated from {fmtNum(a.rentComps)} comparable rentals in this zip.
          </p>
        </Section>
      )}

      {/* Neighborhood */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Section title="Price / sqft vs zip median">
          {p.priceVsMedian ? (
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">This property</span>
                <span className="tabular font-medium">{fmtMoney(p.priceVsMedian.pricePerSqft)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Zip median</span>
                <span className="tabular font-medium">{fmtMoney(p.priceVsMedian.zipMedian)}</span>
              </div>
              <div className="flex justify-between border-t border-gray-100 pt-1 dark:border-gray-800">
                <span className="text-gray-500 dark:text-gray-400">Difference</span>
                <span
                  className={`tabular font-semibold ${
                    p.priceVsMedian.belowMedianPct >= 0
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {fmtPct(Math.abs(p.priceVsMedian.belowMedianPct), 1)}{' '}
                  {p.priceVsMedian.belowMedianPct >= 0 ? 'below' : 'above'}
                </span>
              </div>
              <p className="pt-1 text-xs text-gray-400">
                Based on {p.priceVsMedian.comps} comparable listings.
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-400">Not enough comps to compute a median.</p>
          )}
        </Section>

        <Section title="Neighborhood signals">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Crime index (state rate /100k)</span>
              <span className="tabular font-medium">{fmtNum(p.crime_index)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Rental prevalence</span>
              <span className="tabular font-medium">
                {p.rental_prevalence != null ? fmtPct(p.rental_prevalence, 0) : '—'}
              </span>
            </div>
          </div>
        </Section>
      </div>

      {/* History */}
      {p.history.length >= 2 && (
        <Section title="Grade history">
          <GradeHistoryChart history={p.history} />
        </Section>
      )}
    </div>
  );
}

// --- small presentational helpers -----------------------------------------

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-gray-400">{label}</div>
      <div className="font-medium tabular">{value}</div>
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
  negative,
}: {
  label: string;
  value: string;
  accent?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div
        className={`mt-1 text-xl font-bold tabular ${
          negative
            ? 'text-red-600 dark:text-red-400'
            : accent
              ? 'text-green-600 dark:text-green-400'
              : ''
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ComponentBar({ c }: { c: ComponentBreakdown }) {
  const pts = c.grade ? { A: 4, B: 3, C: 2, D: 1, F: 0 }[c.grade] : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-48 shrink-0 text-sm">
        {c.label}
        <span className="ml-1 text-xs text-gray-400">({fmtPct(c.weight * 100, 0)})</span>
      </div>
      <div className="h-2.5 flex-1 overflow-hidden rounded bg-gray-100 dark:bg-gray-800">
        {c.grade && (
          <div
            className="h-full rounded"
            style={{ width: `${(pts / 4) * 100}%`, backgroundColor: GRADE_HEX[c.grade as Letter] }}
          />
        )}
      </div>
      <div className="w-8 shrink-0 text-right">
        <GradeBadge grade={c.grade} size="sm" />
      </div>
    </div>
  );
}

function CalcRow({
  label,
  value,
  strong,
  accent,
}: {
  label: string;
  value: string;
  strong?: boolean;
  accent?: boolean;
}) {
  return (
    <tr className="border-t border-gray-100 first:border-t-0 dark:border-gray-800">
      <td className={`py-1.5 pr-4 ${strong ? 'font-semibold' : 'text-gray-600 dark:text-gray-300'}`}>
        {label}
      </td>
      <td
        className={`py-1.5 text-right tabular ${strong ? 'font-bold' : ''} ${
          accent ? 'text-green-600 dark:text-green-400' : ''
        }`}
      >
        {value}
      </td>
    </tr>
  );
}
