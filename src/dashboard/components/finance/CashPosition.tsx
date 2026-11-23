'use client';

import { CategoryScale, Chart as ChartJS, Filler, LinearScale, LineController, LineElement, PointElement, Tooltip, type ChartOptions } from 'chart.js';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Chart } from 'react-chartjs-2';
import { financeApi } from './api';
import { Card } from './ui';

ChartJS.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip);

interface Account {
  account: string;
  points: { date: string; balance: number }[];
  latest: { date: string; balance: number } | null;
}

const usd = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });

/**
 * Cash position: the Bank of America checking balance over the selected
 * period (daily closing balances from the uploaded statements).
 */
export function CashPosition({ years, months }: { years: Set<string>; months: Set<string> }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  useEffect(() => {
    financeApi
      .get<{ accounts: Account[] }>('/api/finance/balances')
      .then((r) => setAccounts(r.accounts))
      .catch(() => setAccounts([]));
  }, []);

  const acct = accounts?.[0] ?? null;
  // Points in the selected years × months (the same period as the cards above).
  const pts = useMemo(
    () => (acct ? acct.points.filter((p) => years.has(p.date.slice(0, 4)) && months.has(String(Number(p.date.slice(5, 7))))) : []),
    [acct, years, months],
  );

  if (accounts === null) return null;
  if (!acct) {
    return (
      <Card data-testid="cash-position">
        <h2 className="font-semibold">Cash position</h2>
        <p className="mt-1 text-sm text-gray-500">
          Upload Bank of America <strong>checking</strong> statements (CSV) to see your balance over time. Re-uploading older
          statements is safe: duplicate transactions are skipped and their balances are recorded.{' '}
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

  const data = {
    labels: pts.map((p) => short(p.date)),
    datasets: [
      {
        label: 'Balance',
        data: pts.map((p) => p.balance),
        borderColor: '#3b5bdb',
        backgroundColor: 'rgba(59,91,219,.08)',
        fill: true,
        tension: 0.2,
        borderWidth: 2,
        pointRadius: pts.length > 60 ? 0 : 2,
        stepped: 'after' as const,
      },
    ],
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      datalabels: { display: false },
      tooltip: { callbacks: { label: (c: { parsed: { y: number } }) => usd(c.parsed.y) } },
    },
    scales: {
      x: { ticks: { maxTicksLimit: 8, font: { size: 11 } }, grid: { display: false } },
      y: { ticks: { callback: (v: number | string) => { const k = Number(v) / 1000; return '$' + (Number.isInteger(k) ? k : k.toFixed(1)) + 'k'; }, font: { size: 11 } } },
    },
  } as unknown as ChartOptions<'line'>;

  return (
    <Card data-testid="cash-position">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <h2 className="mr-auto font-semibold">
          Cash position <span className="text-sm font-normal text-gray-500">· {acct.account}</span>
        </h2>
        <div className="text-sm text-gray-500">
          Now <strong className="text-base text-gray-900 tabular" data-testid="cash-latest">{usd(acct.latest!.balance)}</strong>{' '}
          <span className="text-xs">({short(acct.latest!.date)})</span>
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
      {pts.length ? (
        <div className="relative h-56" data-testid="cash-chart">
          <Chart type="line" data={data} options={options} />
        </div>
      ) : (
        <p className="text-sm text-gray-500">No balances recorded for the selected months. Pick other months above, or upload those checking statements.</p>
      )}
    </Card>
  );
}
