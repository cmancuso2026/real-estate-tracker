'use client';

import { CategoryScale, Chart as ChartJS, Filler, Legend, LinearScale, LineController, LineElement, PointElement, Tooltip, type ChartOptions } from 'chart.js';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Chart } from 'react-chartjs-2';
import { balancesByBucket, daysCovering, on } from '@/lib/finance-ui/cash';
import type { Granularity } from '@/lib/finance-ui/chart';
import { financeApi } from './api';
import { Card } from './ui';

ChartJS.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip, Legend);

interface Series {
  points: { date: string; balance: number }[];
  latest: { date: string; balance: number } | null;
}
interface Account extends Series {
  account: string;
}
interface Balances {
  accounts: Account[];
  total: Series | null;
}

const usd = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
const ACCOUNT_COLORS = ['#2f9e44', '#f08c00', '#7048e8', '#0c8599', '#c2255c'];

/**
 * Cash position: total cash (every Bank of America checking / savings account)
 * over the selected period, with a line per account. Accounts can be renamed.
 * Given the income / spending chart's buckets, it plots the balance for every
 * day of that chart's date range, so the two cover the same dates.
 */
export function CashPosition({
  years,
  months,
  buckets,
  gran = 'daily',
}: {
  years: Set<string>;
  months: Set<string>;
  buckets?: string[];
  gran?: Granularity;
}) {
  const [data, setData] = useState<Balances | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    financeApi
      .get<Balances>('/api/finance/balances')
      .then(setData)
      .catch(() => setData({ accounts: [], total: null }));
  }, []);
  useEffect(load, [load]);

  const inPeriod = useCallback((d: string) => years.has(d.slice(0, 4)) && months.has(String(Number(d.slice(5, 7)))), [years, months]);
  const total = data?.total ?? null;
  const pts = useMemo(() => (total ? total.points.filter((p) => inPeriod(p.date)) : []), [total, inPeriod]);
  const days = useMemo(() => (buckets?.length ? daysCovering(buckets, gran) : []), [buckets, gran]);

  async function rename(from: string) {
    setError(null);
    try {
      await financeApi.patch('/api/finance/balances', { from, to: name.trim() });
      setEditing(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (data === null) return null;
  if (!total || !data.accounts.length) {
    return (
      <Card data-testid="cash-position">
        <h2 className="font-semibold">Cash position</h2>
        <p className="mt-1 text-sm text-gray-500">
          Upload Bank of America <strong>checking and savings</strong> statements (CSV) to see your cash over time. Re-uploading
          older statements is safe: duplicate transactions are skipped and their balances are recorded.{' '}
          <Link href="/upload?kind=statements" className="font-medium text-blue-600 hover:underline">
            Upload statements →
          </Link>
        </p>
      </Card>
    );
  }

  const first = pts[0];
  const last = pts[pts.length - 1];
  const low = pts.reduce<(typeof pts)[number] | null>((m, p) => (!m || p.balance < m.balance ? p : m), null);
  const change = first && last ? last.balance - first.balance : 0;
  const multi = data.accounts.length > 1;

  // X axis: every day across the chart above's date range (its buckets), so
  // the balance shows day by day even when that chart groups by week or month.
  // Without buckets, each recorded balance.
  const aligned = days.length > 0;
  const labels = aligned ? days.map(short) : pts.map((p) => short(p.date));
  const totalSeries = aligned ? balancesByBucket(total.points, days, 'daily') : pts.map((p) => p.balance);
  const accountSeries = (a: Account) => (aligned ? balancesByBucket(a.points, days, 'daily') : pts.map((p) => on(a.points, p.date)));
  const plotted = aligned ? totalSeries.some((v) => v != null) : pts.length > 0;

  const chartData = {
    labels,
    datasets: [
      {
        label: multi ? 'Total cash' : data.accounts[0]!.account,
        data: totalSeries,
        borderColor: '#3b5bdb',
        backgroundColor: 'rgba(59,91,219,.08)',
        fill: true,
        borderWidth: 2.5,
        pointRadius: labels.length > 60 ? 0 : 2,
        stepped: 'after' as const,
      },
      ...(multi
        ? data.accounts.map((a, i) => ({
            label: a.account,
            data: accountSeries(a),
            borderColor: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length],
            backgroundColor: 'transparent',
            fill: false,
            borderWidth: 1.5,
            borderDash: [5, 4],
            pointRadius: 0,
            stepped: 'after' as const,
          }))
        : []),
    ],
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: multi, position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
      datalabels: { display: false },
      tooltip: { callbacks: { label: (c: { dataset: { label: string }; parsed: { y: number } }) => `${c.dataset.label}: ${usd(c.parsed.y)}` } },
    },
    scales: {
      x: { ticks: { maxTicksLimit: 8, font: { size: 11 } }, grid: { display: false } },
      y: {
        ticks: {
          callback: (v: number | string) => {
            const k = Number(v) / 1000;
            return '$' + (Number.isInteger(k) ? k : k.toFixed(1)) + 'k';
          },
          font: { size: 11 },
        },
      },
    },
  } as unknown as ChartOptions<'line'>;

  return (
    <Card data-testid="cash-position">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <h2 className="mr-auto font-semibold">Cash position</h2>
        <div className="text-sm text-gray-500">
          {multi ? 'Total now' : 'Now'} <strong className="text-base text-gray-900 tabular" data-testid="cash-latest">{usd(total.latest!.balance)}</strong>{' '}
          <span className="text-xs">({short(total.latest!.date)})</span>
        </div>
        {first && last && (
          <div className="text-sm text-gray-500">
            Over this period <strong className={`tabular ${change >= 0 ? 'text-green-700' : 'text-red-600'}`}>{(change >= 0 ? '+' : '') + usd(change)}</strong>
          </div>
        )}
        {low && (
          <div className="text-sm text-gray-500">
            Low <strong className="tabular text-gray-900">{usd(low.balance)}</strong> <span className="text-xs">({short(low.date)})</span>
          </div>
        )}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs" data-testid="cash-accounts">
        {data.accounts.map((a) =>
          editing === a.account ? (
            <span key={a.account} className="flex items-center gap-1">
              <input
                aria-label={`New name for ${a.account}`}
                className="w-36 rounded border border-gray-300 px-1.5 py-0.5"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void rename(a.account);
                  if (e.key === 'Escape') setEditing(null);
                }}
              />
              <button className="font-medium text-blue-600" onClick={() => void rename(a.account)}>
                Save
              </button>
              <button className="text-gray-400" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </span>
          ) : (
            <button
              key={a.account}
              title="Rename (to another account's name to merge them)"
              onClick={() => {
                setEditing(a.account);
                setName(a.account);
              }}
              className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-700 hover:bg-gray-200"
            >
              {a.account} <strong className="tabular">{a.latest ? usd(a.latest.balance) : '—'}</strong>
              {a.latest && <span className="text-gray-400"> · {short(a.latest.date)}</span>} ✎
            </button>
          ),
        )}
        {error && <span className="text-red-600">{error}</span>}
      </div>
      {plotted ? (
        <div className="relative h-56" data-testid="cash-chart" data-series={JSON.stringify({ labels, total: totalSeries })}>
          <Chart type="line" data={chartData} options={options} />
        </div>
      ) : (
        <p className="text-sm text-gray-500">No balances recorded for the selected months. Pick other months above, or upload those statements.</p>
      )}
    </Card>
  );
}
