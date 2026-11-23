'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useFinance } from '@/components/finance/FinanceData';
import { FinanceChart, type ChartKind, type StackMode } from '@/components/finance/FinanceChart';
import { Card, Field, selectCls } from '@/components/finance/ui';
import { buildChart, type Granularity } from '@/lib/finance-ui/chart';
import { fmt } from '@/lib/finance-ui/format';
import { heroTotals } from '@/lib/finance-ui/transactions';
import { InfoTip } from '@/components/finance/InfoTip';
import { SankeyChart } from '@/components/finance/SankeyChart';
import { buildGroupSankey, buildSankey, transfersLeftOut } from '@/lib/finance-ui/sankey';

type ChartView = 'bar' | 'sankey';
// v2: earlier saved choices are ignored so everyone starts on Sankey once.
const VIEW_KEY = 'mancuso.finance.overviewChart.v2';

export default function FinanceOverviewPage() {
  const { filteredTxns, tax, filters, unattributedCount, metricsCtx, definitions } = useFinance();
  const [gran, setGran] = useState<Granularity>('monthly');
  const [kind, setKind] = useState<ChartKind>('line');
  const [stack, setStack] = useState<StackMode>('grouped');
  const [view, setView] = useState<ChartView>('sankey'); // default: Sankey (Bar is remembered if you pick it)
  // Remember Bar / Sankey per browser (storage can be unavailable: private mode).
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(VIEW_KEY);
      if (v === 'bar' || v === 'sankey') setView(v);
    } catch {
      /* default view */
    }
  }, []);
  function pickView(v: ChartView) {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* not remembered, still switches */
    }
  }

  // Cards and chart both use the shared rows (period + global filters). The
  // Group / Category filters also pick the chart's shape: a group alone breaks
  // into one line per category; a property shows Rent / Costs / Net.
  const hero = heroTotals(filteredTxns, metricsCtx);
  const model = useMemo(
    () => buildChart(filteredTxns, tax, filters.group, filters.category, gran, metricsCtx),
    [filteredTxns, tax, filters.group, filters.category, gran, metricsCtx],
  );
  const [focus, setFocus] = useState(''); // a spending group to zoom into
  const sankey = useMemo(
    () => (view !== 'sankey' ? null : focus ? buildGroupSankey(filteredTxns, tax, metricsCtx, focus) : buildSankey(filteredTxns, tax, metricsCtx)),
    [view, focus, filteredTxns, tax, metricsCtx],
  );
  const transfers = useMemo(() => (view === 'sankey' ? transfersLeftOut(filteredTxns, metricsCtx) : []), [view, filteredTxns, metricsCtx]);
  const spendGroups = useMemo(
    () => (view === 'sankey' ? (buildSankey(filteredTxns, tax, metricsCtx)?.flows ?? []).filter((f) => f.from === 'total' && f.to.startsWith('grp:')).map((f) => f.to.slice(4)) : []),
    [view, filteredTxns, tax, metricsCtx],
  );
  useEffect(() => {
    if (focus && spendGroups.length && !spendGroups.includes(focus)) setFocus('');
  }, [focus, spendGroups]);

  return (
    <div className="space-y-5">
      {unattributedCount > 0 && (
        <Link
          href="/finance/attribution"
          data-testid="attribution-callout"
          className="flex items-center justify-between gap-4 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm hover:bg-orange-100"
        >
          <span>
            <strong className="text-orange-800">
              {unattributedCount} transaction{unattributedCount === 1 ? '' : 's'} need{unattributedCount === 1 ? 's' : ''} a property.
            </strong>{' '}
            <span className="text-orange-900/80">Repairs and other property costs count toward a property once they're assigned.</span>
          </span>
          <span className="shrink-0 font-medium text-orange-800">Review queue →</span>
        </Link>
      )}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <div className="text-sm text-gray-500">
            Income
            <InfoTip text={definitions.income} testId="def-income" />
          </div>
          <div data-testid="kpi-income" className="mt-1 text-3xl font-bold tabular text-green-700">{fmt(hero.income)}</div>
          <div className="mt-1 text-xs text-gray-500">{hero.paychecks} paycheck deposits</div>
        </Card>
        <Card>
          <div className="text-sm text-gray-500">
            Total Spending
            <InfoTip text={definitions.spending} testId="def-spending" />
          </div>
          <div data-testid="kpi-spend" className="mt-1 text-3xl font-bold tabular text-red-600">{fmt(-hero.spend)}</div>
          <div className="mt-1 flex justify-between text-xs text-gray-500">
            <span>{hero.expenseCount} expense transactions</span>
            <Link href="/finance/categories" className="font-medium text-blue-600 hover:underline">
              By category →
            </Link>
          </div>
        </Card>
        <Card>
          <div className="text-sm text-gray-500">
            Cash Flow
            <InfoTip text={definitions.cash_flow} testId="def-cashflow" />
          </div>
          <div
            data-testid="kpi-flow"
            className={`mt-1 text-3xl font-bold tabular ${hero.flow >= 0 ? 'text-green-700' : 'text-red-600'}`}
          >
            {fmt(hero.flow)}
          </div>
          <div className="mt-1 text-xs text-gray-500" data-testid="kpi-transfers">
            Net for period
            {hero.transferCount > 0 && ` · ${hero.transferCount} transfer${hero.transferCount === 1 ? '' : 's'} between your accounts left out`}
          </div>
        </Card>
      </section>

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <h2 className="mr-auto font-semibold">{view === 'sankey' ? 'Where the money went' : 'Income vs. Spending Over Time'}</h2>
          <div role="group" aria-label="Chart view" className="inline-flex overflow-hidden rounded-lg border border-gray-300 text-xs font-medium">
            {(
              [
                ['bar', 'Bar'],
                ['sankey', 'Sankey'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                data-testid={`view-${v}`}
                onClick={() => pickView(v)}
                className={`px-3 py-1.5 ${view === v ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {view === 'bar' && (
          <>
          <Field label="View:">
            <select aria-label="Chart granularity" className={selectCls} value={gran} onChange={(e) => setGran(e.target.value as Granularity)}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </Field>
          <Field label="Chart:">
            <select aria-label="Chart type" className={selectCls} value={kind} onChange={(e) => setKind(e.target.value as ChartKind)}>
              <option value="line">Line</option>
              <option value="bar">Bar</option>
            </select>
          </Field>
          <Field label="Bars:">
            <select aria-label="Bar stacking" className={selectCls} value={stack} onChange={(e) => setStack(e.target.value as StackMode)}>
              <option value="grouped">Separate</option>
              <option value="stacked">Stacked</option>
            </select>
          </Field>
          </>
          )}
        </div>
        {view === 'sankey' && (
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm" data-testid="sankey-focus">
            {focus ? (
              <>
                <button className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium hover:bg-gray-50" onClick={() => setFocus('')}>
                  ← All money
                </button>
                <span className="text-gray-600">
                  <strong>{focus}</strong>: each category and its biggest merchants
                </span>
              </>
            ) : (
              <span className="text-gray-500">Click a group (or pick one) to see its categories and merchants:</span>
            )}
            <select aria-label="Zoom into group" className={selectCls} value={focus} onChange={(e) => setFocus(e.target.value)}>
              <option value="">All groups</option>
              {spendGroups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
        )}
        {view === 'sankey' ? (
          <div
            className="relative h-[32rem]"
            data-testid="finance-sankey"
            data-flows={sankey ? JSON.stringify({ income: sankey.income, spending: sankey.spending, flows: sankey.flows }) : ''}
          >
            {sankey ? (
              <SankeyChart model={sankey} onPickGroup={setFocus} />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-gray-400">No income or spending in this period.</div>
            )}
          </div>
        ) : (
        <div
          className="relative h-80"
          data-testid="finance-chart"
          // The plotted series, for automated checks (the canvas itself isn't inspectable).
          data-series={model ? JSON.stringify({ labels: model.labels, series: model.series.map((s) => [s.label, s.data]) }) : ''}
        >
          {model && <FinanceChart model={model} kind={kind} stack={stack} />}
        </div>
        )}
        {view === 'sankey' && transfers.length > 0 && (
          <p className="mt-3 border-t border-gray-100 pt-2 text-xs text-gray-500" data-testid="transfers-note">
            <strong className="font-medium text-gray-700">Not shown: transfers between your own accounts</strong> —{' '}
            {transfers.map((t, i) => (
              <span key={t.cat}>
                {i > 0 && ', '}
                {t.cat} ({t.count}: {t.out > 0 && `$${Math.round(t.out).toLocaleString()} out`}
                {t.out > 0 && t.in > 0 && ' / '}
                {t.in > 0 && `$${Math.round(t.in).toLocaleString()} in`})
              </span>
            ))}
            . Paying a credit card from checking, or moving money to Venmo, isn&apos;t new spending: the purchases themselves
            are already counted. That&apos;s the Financials group; it&apos;s left out of income, spending and cash flow.
          </p>
        )}
      </Card>
    </div>
  );
}
