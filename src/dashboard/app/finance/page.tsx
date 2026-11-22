'use client';

import { useMemo, useState } from 'react';
import { useFinance } from '@/components/finance/FinanceData';
import { FinanceChart, type ChartKind, type StackMode } from '@/components/finance/FinanceChart';
import { Card, Field, selectCls } from '@/components/finance/ui';
import { buildChart, type Granularity } from '@/lib/finance-ui/chart';
import { fmt } from '@/lib/finance-ui/format';
import { heroTotals } from '@/lib/finance-ui/transactions';

export default function FinanceOverviewPage() {
  const { filteredTxns, tax, filters } = useFinance();
  const [gran, setGran] = useState<Granularity>('monthly');
  const [kind, setKind] = useState<ChartKind>('line');
  const [stack, setStack] = useState<StackMode>('grouped');

  // Cards and chart both use the shared rows (period + global filters). The
  // Group / Category filters also pick the chart's shape: a group alone breaks
  // into one line per category; a property shows Rent / Costs / Net.
  const hero = heroTotals(filteredTxns);
  const model = useMemo(
    () => buildChart(filteredTxns, tax, filters.group, filters.category, gran),
    [filteredTxns, tax, filters.group, filters.category, gran],
  );

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <div className="text-sm text-gray-500">Income</div>
          <div data-testid="kpi-income" className="mt-1 text-3xl font-bold tabular text-green-700">{fmt(hero.income)}</div>
          <div className="mt-1 text-xs text-gray-500">{hero.paychecks} paycheck deposits</div>
        </Card>
        <Card>
          <div className="text-sm text-gray-500">Total Spending</div>
          <div data-testid="kpi-spend" className="mt-1 text-3xl font-bold tabular text-red-600">{fmt(-hero.spend)}</div>
          <div className="mt-1 text-xs text-gray-500">{hero.expenseCount} expense transactions</div>
        </Card>
        <Card>
          <div className="text-sm text-gray-500">Cash Flow</div>
          <div
            data-testid="kpi-flow"
            className={`mt-1 text-3xl font-bold tabular ${hero.flow >= 0 ? 'text-green-700' : 'text-red-600'}`}
          >
            {fmt(hero.flow)}
          </div>
          <div className="mt-1 text-xs text-gray-500">Net for period</div>
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
