'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  gradeManualAction,
  INITIAL_GRADE_STATE,
  type GradeFormState,
} from '@/app/grade/actions';
import type { ManualComponent, ManualGradeResult } from '@/lib/grade-manual';
import {
  fmtMoney,
  fmtPct,
  fmtNum,
  fmtSignedMoney,
  GRADE_HEX,
  type Letter,
} from '@/lib/format';
import { GradeBadge } from './GradeBadge';

const INPUT =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm tabular ' +
  'focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ' +
  'dark:border-gray-700 dark:bg-gray-900';

const PROPERTY_TYPES = [
  { value: 'SFH', hint: 'Single-family' },
  { value: 'Duplex', hint: '2 units' },
  { value: 'Triplex', hint: '3 units' },
  { value: 'Quad', hint: '4 units' },
] as const;

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">{hint}</span>}
    </label>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
    >
      {pending ? 'Grading…' : 'Grade this property'}
    </button>
  );
}

export function GradeMeForm() {
  const [state, formAction] = useActionState<GradeFormState, FormData>(
    gradeManualAction,
    INITIAL_GRADE_STATE,
  );
  const v = state.values ?? {};

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-6 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <Field label="Property address" hint="For your reference — not used in scoring.">
          <input
            name="address"
            type="text"
            placeholder="123 NW 5th St"
            defaultValue={v.address ?? ''}
            className={INPUT}
          />
        </Field>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Zip code">
            <input
              name="zip"
              type="text"
              inputMode="numeric"
              placeholder="33126"
              defaultValue={v.zip ?? ''}
              className={INPUT}
              required
            />
          </Field>

          <Field label="List price">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
                $
              </span>
              <input
                name="price"
                type="number"
                min={0}
                step={1000}
                inputMode="numeric"
                placeholder="500000"
                defaultValue={v.price ?? ''}
                className={`${INPUT} pl-7`}
                required
              />
            </div>
          </Field>

          <Field label="Square footage">
            <input
              name="sqft"
              type="number"
              min={0}
              step={10}
              inputMode="numeric"
              placeholder="1500"
              defaultValue={v.sqft ?? ''}
              className={INPUT}
              required
            />
          </Field>

          <Field label="Bedrooms">
            <input
              name="beds"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              placeholder="3"
              defaultValue={v.beds ?? ''}
              className={INPUT}
              required
            />
          </Field>

          <Field label="Bathrooms">
            <input
              name="baths"
              type="number"
              min={0}
              step={0.5}
              inputMode="decimal"
              placeholder="2"
              defaultValue={v.baths ?? ''}
              className={INPUT}
              required
            />
          </Field>

          <Field label="HOA fees" hint="Monthly, optional.">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
                $
              </span>
              <input
                name="hoa"
                type="number"
                min={0}
                step={10}
                inputMode="numeric"
                placeholder="0"
                defaultValue={v.hoa ?? ''}
                className={`${INPUT} pl-7`}
              />
            </div>
          </Field>
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Property type</legend>
          <div className="flex flex-wrap gap-2">
            {PROPERTY_TYPES.map((t, i) => (
              <label
                key={t.value}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                <input
                  type="radio"
                  name="property_type"
                  value={t.value}
                  defaultChecked={v.property_type ? v.property_type === t.value : i === 0}
                  className="h-4 w-4 accent-blue-600"
                />
                <span className="font-medium">{t.value}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">{t.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex items-center gap-3 border-t border-gray-100 pt-4 dark:border-gray-800">
          <SubmitButton />
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Runs the full scoring engine using rental comps and listings in this zip.
          </span>
        </div>
      </form>

      {state.error && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          {state.error}
        </div>
      )}

      {state.result && <GradeResult result={state.result} />}
    </div>
  );
}

// --- result -----------------------------------------------------------------

const REC_STYLE: Record<string, string> = {
  Pursue: 'bg-green-100 text-green-800 ring-green-300 dark:bg-green-950/50 dark:text-green-300 dark:ring-green-800',
  Watch: 'bg-yellow-100 text-yellow-800 ring-yellow-300 dark:bg-yellow-950/50 dark:text-yellow-300 dark:ring-yellow-800',
  Pass: 'bg-red-100 text-red-800 ring-red-300 dark:bg-red-950/50 dark:text-red-300 dark:ring-red-800',
};

function GradeResult({ result }: { result: ManualGradeResult }) {
  const a = result.assumptions;
  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-bold">{result.input.address || `Property in ${result.input.zip}`}</h2>
          <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {result.input.zip} · {result.input.propertyType} · {fmtNum(result.input.beds)} bd /{' '}
            {fmtNum(result.input.baths)} ba · {fmtNum(result.input.sqft)} sqft · {fmtMoney(result.input.price)}
          </div>
          <div className="mt-3">
            <span
              className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ring-1 ${REC_STYLE[result.recommendation]}`}
            >
              {result.recommendation === 'Pursue'
                ? '✓ Pursue'
                : result.recommendation === 'Watch'
                  ? '◑ Watch'
                  : '✕ Pass'}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-center gap-2">
          <GradeBadge grade={result.overallGrade} size="lg" />
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Score {fmtNum(result.overallScore)} / 4
          </div>
        </div>
      </header>

      {/* Key returns */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric label="Cash-on-cash" value={fmtPct(result.cocReturn)} accent />
        <Metric
          label="Monthly cash flow"
          value={fmtSignedMoney(result.monthlyCashflow)}
          negative={result.monthlyCashflow < 0}
        />
        <Metric label="Est. monthly rent" value={fmtMoney(result.estRent)} />
        <Metric label="Rate used" value={fmtPct(result.rate.effectiveRate, 2)} />
      </div>

      {/* Scoring breakdown */}
      <Section title="Score breakdown by factor">
        <div className="space-y-3">
          {result.components.map((c) => (
            <ComponentBar key={c.key} c={c} />
          ))}
        </div>
      </Section>

      {/* CoC step by step */}
      <Section title="Cash-on-cash return — step by step">
        <table className="w-full text-sm">
          <tbody>
            <CalcRow label="Purchase price" value={fmtMoney(a.purchasePrice)} />
            <CalcRow label={`Down payment (${fmtNum(a.downPaymentPct)}%)`} value={fmtMoney(a.downPayment)} />
            <CalcRow label="Closing costs" value={fmtMoney(a.closingCosts)} />
            <CalcRow label="Total cash invested" value={fmtMoney(a.totalCashInvested)} strong />
            <CalcRow label={`Loan amount (${fmtPct(a.interestRatePct, 2)}, ${a.loanTermYears}yr)`} value={fmtMoney(a.loanAmount)} />
            <CalcRow label="— Gross annual rent" value={fmtMoney(a.monthlyRent * 12)} />
            <CalcRow label={`— Vacancy (${fmtPct(a.vacancyFactor * 100, 0)})`} value={`-${fmtMoney(a.monthlyRent * 12 * a.vacancyFactor)}`} />
            <CalcRow label="— Mortgage (annual P&I)" value={`-${fmtMoney(a.annualMortgage)}`} />
            <CalcRow label={`— Property tax (${fmtPct(a.propertyTaxPct, 0)})`} value={`-${fmtMoney(a.annualPropertyTax)}`} />
            <CalcRow label={`— Insurance (${fmtPct(a.insurancePct, 1)})`} value={`-${fmtMoney(a.annualInsurance)}`} />
            {a.annualHoa > 0 && <CalcRow label="— HOA (annual)" value={`-${fmtMoney(a.annualHoa)}`} />}
            <CalcRow label="Annual cash flow" value={fmtSignedMoney(a.annualCashFlow)} strong />
            <CalcRow
              label="CoC = annual cash flow ÷ cash invested"
              value={fmtPct(result.cocReturn)}
              strong
              accent
            />
          </tbody>
        </table>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Rent estimated from {fmtNum(result.rentComps)} comparable rental{result.rentComps === 1 ? '' : 's'} in {result.input.zip}.
        </p>
      </Section>

      {/* Neighborhood */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Section title="Price / sqft vs zip median">
          {result.pricePerSqft != null && result.zipMedianPerSqft != null ? (
            <div className="space-y-1 text-sm">
              <Row label="This property" value={fmtMoney(result.pricePerSqft)} />
              <Row label="Zip median" value={fmtMoney(result.zipMedianPerSqft)} />
              <div className="flex justify-between border-t border-gray-100 pt-1 dark:border-gray-800">
                <span className="text-gray-500 dark:text-gray-400">Difference</span>
                <span
                  className={`tabular font-semibold ${
                    result.pricePerSqft <= result.zipMedianPerSqft
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {fmtPct(
                    Math.abs(((result.pricePerSqft - result.zipMedianPerSqft) / result.zipMedianPerSqft) * 100),
                    1,
                  )}{' '}
                  {result.pricePerSqft <= result.zipMedianPerSqft ? 'below' : 'above'}
                </span>
              </div>
              <p className="pt-1 text-xs text-gray-400">Based on {result.sqftComps} comparable listings.</p>
            </div>
          ) : (
            <p className="text-sm text-gray-400">Not enough comps to compute a median.</p>
          )}
        </Section>

        <Section title="Neighborhood signals">
          <div className="space-y-1 text-sm">
            <Row
              label="Crime index (100 = national avg)"
              value={result.crimeIndex != null ? fmtNum(result.crimeIndex) : '—'}
            />
            <Row
              label="Rental prevalence"
              value={result.rentalPrevalence != null ? fmtPct(result.rentalPrevalence, 0) : '—'}
            />
          </div>
        </Section>
      </div>

      {/* Takeaway */}
      <Section title="The takeaway">
        <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-200">{result.takeaway}</p>
      </Section>
    </div>
  );
}

// --- shared presentational helpers (match property detail page) ------------

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
          negative ? 'text-red-600 dark:text-red-400' : accent ? 'text-green-600 dark:text-green-400' : ''
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="tabular font-medium">{value}</span>
    </div>
  );
}

function ComponentBar({ c }: { c: ManualComponent }) {
  const pts = c.grade ? { A: 4, B: 3, C: 2, D: 1, F: 0 }[c.grade] : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-48 shrink-0 text-sm">
        {c.label}
        <span className="ml-1 text-xs text-gray-400">({fmtPct(c.weight * 100, 0)})</span>
        <div className="text-xs text-gray-400">{c.detail}</div>
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
