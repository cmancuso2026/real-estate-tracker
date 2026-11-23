'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useFinance } from '@/components/finance/FinanceData';
import { FinanceChart, type ChartKind, type StackMode } from '@/components/finance/FinanceChart';
import { Card, Field, selectCls } from '@/components/finance/ui';
import { buildChart, type Granularity } from '@/lib/finance-ui/chart';
import { fmt } from '@/lib/finance-ui/format';
import { heroTotals } from '@/lib/finance-ui/transactions';
import { InfoTip } from '@/components/finance/InfoTip';

export default function FinanceOverviewPage() {
  const { filteredTxns, tax, filters, unattributedCount, metricsCtx, definitions } = useFinance();
  const [gran, setGran] = useState<Granularity>('monthly');
  const [kind, setKind] = useState<ChartKind>('line');
  const [stack, setStack] = useState<StackMode>('grouped');

  // Cards and chart both use the shared rows (period + global filters). The
  // Group / Category filters also pick the chart's shape: a group alone breaks
  // into one line per category; a property shows Rent / Costs / Net.
  const hero = heroTotals(filteredTxns, metricsCtx);
  const model = useMemo(
    () => buildChart(filteredTxns, tax, filters.group, filters.category, gran, metricsCtx),
    [filteredTxns, tax, filters.group, filters.category, gran, metricsCtx],
  );

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
            <Link href="/finance/spending" className="font-medium text-blue-600 hover:underline">
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
          <h2 className="mr-auto font-semibold">Income vs. Spending Over Time</h2>
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
        </div>
        <div
          className="relative h-80"
          data-testid="finance-chart"
          // The plotted series, for automated checks (the canvas itself isn't inspectable).
          data-series={model ? JSON.stringify({ labels: model.labels, series: model.series.map((s) => [s.label, s.data]) }) : ''}
        >
          {model && <FinanceChart model={model} kind={kind} stack={stack} />}
        </div>
      </Card>
    </div>
  );
}
